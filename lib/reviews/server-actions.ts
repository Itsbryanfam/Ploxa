"use server";

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { generate } from "@/lib/ai/router";
import {
  DAILY_REVIEW_CAP,
  getUserDailyReviewCount,
  incrementUserDailyReviews,
} from "@/lib/ai/rate-limit";
import { RateLimitExceededError, AIProvidersExhaustedError } from "@/lib/ai/errors";
import { revalidatePath } from "next/cache";
import {
  createSession,
  getSession,
  appendAnswer,
  appendQuestion,
  destroySession,
} from "./session";
import {
  SYSTEM_PROMPT,
  openerQuestion,
  followUpPrompt,
  draftPrompt,
  regenerateSectionPrompt,
  type SectionTarget,
  type GameContext,
} from "./prompts";

// ---------------------------------------------------------------------------
// Minimal createStreamableValue shim
// ---------------------------------------------------------------------------
// ai/rsc (the RSC streaming helpers) was removed from the Vercel AI SDK in v6.
// We implement an identical surface — { value, update, done, error } — backed
// by a native ReadableStream that Next.js 16 can serialize across the server
// action wire protocol.
// ---------------------------------------------------------------------------

interface StreamableValue<T> {
  /** The ReadableStream that the client reads token-by-token. */
  value: ReadableStream<T>;
  /** Push an intermediate value to the stream. */
  update: (v: T) => void;
  /** Close the stream with a final value. */
  done: (v: T) => void;
  /** Close the stream with an error. */
  error: (err: Error) => void;
}

function createStreamableValue<T>(initial: T): StreamableValue<T> {
  let controller!: ReadableStreamDefaultController<T>;
  const stream = new ReadableStream<T>({
    start(ctrl) {
      controller = ctrl;
      // Enqueue the seed value so the consumer gets *something* immediately.
      controller.enqueue(initial);
    },
  });

  return {
    value: stream,
    update(v: T) {
      controller.enqueue(v);
    },
    done(v: T) {
      controller.enqueue(v);
      controller.close();
    },
    error(err: Error) {
      controller.error(err);
    },
  };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const startInterviewInput = z.object({ logId: z.string().uuid() });
const submitAnswerInput = z.object({
  interviewId: z.string().uuid(),
  turn: z.number().int().min(1).max(4),
  text: z.string().trim().min(1).max(2000),
});

const SECTION_BY_TURN: Record<2 | 3 | 4, SectionTarget> = {
  2: "Highs",
  3: "Lows",
  4: "Verdict",
};

// ---------------------------------------------------------------------------
// startInterview
// ---------------------------------------------------------------------------

type StartResult =
  | { ok: true; interviewId: string; q1: string }
  | { ok: false; error: string };

export async function startInterview(input: unknown): Promise<StartResult> {
  const parsed = startInterviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const count = await getUserDailyReviewCount(user.id);
  if (count >= DAILY_REVIEW_CAP) {
    return { ok: false, error: "I need a nap — back at midnight UTC." };
  }

  const log = await db.query.logs.findFirst({
    where: and(eq(schema.logs.id, parsed.data.logId), eq(schema.logs.userId, user.id)),
    columns: { id: true, userId: true, gameId: true },
  });
  if (!log) return { ok: false, error: "Log not found" };

  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, log.gameId),
    columns: { id: true, title: true, genres: true, themes: true, released: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  try {
    await incrementUserDailyReviews(user.id);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return { ok: false, error: "I need a nap — back at midnight UTC." };
    }
    throw err;
  }

  const q1 = openerQuestion({
    title: game.title,
    genres: game.genres,
    themes: game.themes,
    releasedYear: game.released?.getFullYear(),
  });

  const session = await createSession({
    userId: user.id,
    logId: log.id,
    gameId: game.id,
    openerQuestion: q1,
  });

  return { ok: true, interviewId: session.interviewId, q1 };
}

// ---------------------------------------------------------------------------
// submitAnswer
// ---------------------------------------------------------------------------

type SubmitAnswerResult =
  | { ok: true; ready: true } // After Q4, client should call generateDraft
  | { ok: true; ready: false; stream: ReadableStream<string> }
  | { ok: false; error: string };

export async function submitAnswer(input: unknown): Promise<SubmitAnswerResult> {
  const parsed = submitAnswerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const session = await getSession(parsed.data.interviewId);
  if (!session || session.userId !== user.id) {
    return { ok: false, error: "Session expired" };
  }

  const updated = await appendAnswer(parsed.data.interviewId, parsed.data.turn, parsed.data.text);
  if (!updated) return { ok: false, error: "Session expired" };

  // After Q4, signal client to call generateDraft.
  if (parsed.data.turn === 4) {
    return { ok: true, ready: true };
  }

  const nextTurn = (parsed.data.turn + 1) as 2 | 3 | 4;
  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, session.gameId),
    columns: { title: true, genres: true, themes: true, released: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  const ctx: GameContext = {
    title: game.title,
    genres: game.genres,
    themes: game.themes,
    releasedYear: game.released?.getFullYear(),
  };
  const prompt = followUpPrompt({
    game: ctx,
    priorAnswers: updated.answers,
    sectionTarget: SECTION_BY_TURN[nextTurn],
  });

  const streamable = createStreamableValue<string>("");
  void (async () => {
    try {
      const { textStream } = await generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        feature: "interview_question",
        userId: user.id,
        maxTokens: 120,
        temperature: 0.8,
      });
      let acc = "";
      for await (const chunk of textStream) {
        acc += chunk;
        streamable.update(acc);
      }
      // Persist the AI question to the session so generateDraft can write
      // real text (not a placeholder) into review_questions later.
      await appendQuestion(parsed.data.interviewId, nextTurn, acc.trim());
      streamable.done(acc);
    } catch (err) {
      const message =
        err instanceof AIProvidersExhaustedError
          ? "Let me catch my breath — your answers are saved. Try again?"
          : "Something glitched. Try again?";
      streamable.error(new Error(message));
    }
  })();

  return { ok: true, ready: false, stream: streamable.value };
}

// ---------------------------------------------------------------------------
// generateDraft
// ---------------------------------------------------------------------------

const generateDraftInput = z.object({ interviewId: z.string().uuid() });

type GenerateDraftResult =
  | { ok: true; reviewId: string; stream: ReadableStream<string> }
  | { ok: false; error: string; existingReviewId?: string };

export async function generateDraft(input: unknown): Promise<GenerateDraftResult> {
  const parsed = generateDraftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const session = await getSession(parsed.data.interviewId);
  if (!session || session.userId !== user.id) {
    return { ok: false, error: "Session expired" };
  }
  if (session.answers.length === 0) {
    return { ok: false, error: "No answers to draft from" };
  }

  // One-per-game cardinality enforcement (app-side; no DB unique index).
  const existing = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, user.id),
      eq(schema.reviews.gameId, session.gameId),
    ),
    columns: { id: true },
  });
  if (existing) {
    return { ok: false, error: "You've already reviewed this game", existingReviewId: existing.id };
  }

  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, session.gameId),
    columns: { title: true, genres: true, themes: true, released: true, slug: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  // Insert the empty draft row up front so the client can navigate to
  // /games/{slug}/review?reviewId={id} and start rendering streamed sections.
  const [inserted] = await db
    .insert(schema.reviews)
    .values({
      userId: user.id,
      gameId: session.gameId,
      logId: session.logId,
      body: "",
      isAiAssisted: true,
      isPublic: true,
    })
    .returning({ id: schema.reviews.id });
  if (!inserted) return { ok: false, error: "Could not create draft" };
  const reviewId = inserted.id;

  // Insert 4 review_questions rows. Padding both arrays with empty strings
  // for Skip-the-rest scenarios so position is preserved and questions[i]
  // is paired with answers[i].
  const paddedQuestions: string[] = [
    session.questions[0] ?? "",
    session.questions[1] ?? "",
    session.questions[2] ?? "",
    session.questions[3] ?? "",
  ];
  const paddedAnswers: string[] = [
    session.answers[0] ?? "",
    session.answers[1] ?? "",
    session.answers[2] ?? "",
    session.answers[3] ?? "",
  ];
  await db.insert(schema.reviewQuestions).values(
    paddedAnswers.map((answer, idx) => ({
      reviewId,
      position: idx + 1,
      question: paddedQuestions[idx] || `Turn ${idx + 1}`,
      answer,
    })),
  );

  const prompt = draftPrompt({
    game: {
      title: game.title,
      genres: game.genres,
      themes: game.themes,
      releasedYear: game.released?.getFullYear(),
    },
    answers: paddedAnswers.filter((a) => a.length > 0),
  });

  const streamable = createStreamableValue<string>("");
  void (async () => {
    try {
      const { textStream } = await generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        feature: "review_draft",
        userId: user.id,
        maxTokens: 700,
        temperature: 0.7,
      });
      let acc = "";
      for await (const chunk of textStream) {
        acc += chunk;
        streamable.update(acc);
      }
      // Persist the final body
      await db
        .update(schema.reviews)
        .set({ body: acc, updatedAt: new Date() })
        .where(eq(schema.reviews.id, reviewId));
      await destroySession(parsed.data.interviewId);
      streamable.done(acc);
    } catch (err) {
      const message =
        err instanceof AIProvidersExhaustedError
          ? "Let me catch my breath — your draft will be saved. Try again?"
          : "Something glitched while drafting. Try again?";
      streamable.error(new Error(message));
    }
  })();

  return { ok: true, reviewId, stream: streamable.value };
}

// ---------------------------------------------------------------------------
// regenerateSection
// ---------------------------------------------------------------------------

const regenerateSectionInput = z.object({
  reviewId: z.string().uuid(),
  sectionIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

type RegenerateSectionResult =
  | { ok: true; stream: ReadableStream<string> }
  | { ok: false; error: string };

export async function regenerateSection(input: unknown): Promise<RegenerateSectionResult> {
  const parsed = regenerateSectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.id, parsed.data.reviewId),
      eq(schema.reviews.userId, user.id),
    ),
    columns: { id: true, body: true, gameId: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, review.gameId),
    columns: { title: true, released: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  const questions = await db.query.reviewQuestions.findMany({
    where: eq(schema.reviewQuestions.reviewId, review.id),
    orderBy: (q, { asc }) => asc(q.position),
    columns: { position: true, answer: true },
  });
  // Build a 4-length answers array indexed 0..3
  const answers: string[] = [0, 1, 2, 3].map(
    (i) => questions.find((q) => q.position === i + 1)?.answer ?? "",
  );

  const prompt = regenerateSectionPrompt({
    game: { title: game.title, releasedYear: game.released?.getFullYear() },
    answers,
    sectionIndex: parsed.data.sectionIndex,
  });

  const streamable = createStreamableValue<string>("");
  void (async () => {
    try {
      const { textStream } = await generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        feature: "review_draft",
        userId: user.id,
        maxTokens: 250,
        temperature: 0.7,
      });
      let acc = "";
      for await (const chunk of textStream) {
        acc += chunk;
        streamable.update(acc);
      }
      // Split current body on \n\n, pad to 4, replace target, rejoin.
      const sections = (review.body ?? "").split("\n\n");
      while (sections.length < 4) sections.push("");
      sections[parsed.data.sectionIndex] = acc.trim();
      const newBody = sections.slice(0, 4).join("\n\n");
      await db
        .update(schema.reviews)
        .set({ body: newBody, updatedAt: new Date() })
        .where(eq(schema.reviews.id, review.id));
      streamable.done(acc);
    } catch (err) {
      const message =
        err instanceof AIProvidersExhaustedError
          ? "Let me catch my breath. Try again?"
          : "Couldn't rewrite that one. Try again?";
      streamable.error(new Error(message));
    }
  })();

  return { ok: true, stream: streamable.value };
}

// ---------------------------------------------------------------------------
// publishReview
// ---------------------------------------------------------------------------

const publishInput = z.object({
  reviewId: z.string().uuid(),
  rating: z.number().min(0).max(10),
  isPublic: z.boolean(),
});

type PublishResult =
  | { ok: true; username: string; gameSlug: string }
  | { ok: false; error: string };

export async function publishReview(input: unknown): Promise<PublishResult> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, parsed.data.reviewId), eq(schema.reviews.userId, user.id)),
    columns: { id: true, gameId: true, publishedAt: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const [game, profile] = await Promise.all([
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { slug: true },
    }),
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, user.id),
      columns: { username: true },
    }),
  ]);
  if (!game || !profile) return { ok: false, error: "Lookup failed" };

  await db
    .update(schema.reviews)
    .set({
      publishedAt: review.publishedAt ?? new Date(),
      rating: String(parsed.data.rating),
      isPublic: parsed.data.isPublic,
      updatedAt: new Date(),
    })
    .where(eq(schema.reviews.id, review.id));

  revalidatePath(`/u/${profile.username}`);
  revalidatePath(`/u/${profile.username}/reviews`);
  revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  revalidatePath(`/games/${game.slug}`);

  return { ok: true, username: profile.username, gameSlug: game.slug };
}

// ---------------------------------------------------------------------------
// updateReview
// ---------------------------------------------------------------------------

const updateInput = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000),
  rating: z.number().min(0).max(10),
  isPublic: z.boolean(),
});

type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateReview(input: unknown): Promise<UpdateResult> {
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, parsed.data.reviewId), eq(schema.reviews.userId, user.id)),
    columns: { id: true, gameId: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const [game, profile] = await Promise.all([
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { slug: true },
    }),
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, user.id),
      columns: { username: true },
    }),
  ]);
  if (!game || !profile) return { ok: false, error: "Lookup failed" };

  await db
    .update(schema.reviews)
    .set({
      body: parsed.data.body,
      rating: String(parsed.data.rating),
      isPublic: parsed.data.isPublic,
      updatedAt: new Date(),
    })
    .where(eq(schema.reviews.id, review.id));

  revalidatePath(`/u/${profile.username}/reviews`);
  revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  revalidatePath(`/games/${game.slug}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// deleteReview
// ---------------------------------------------------------------------------

const deleteInput = z.object({ reviewId: z.string().uuid() });

export async function deleteReview(input: unknown): Promise<UpdateResult> {
  const parsed = deleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, parsed.data.reviewId), eq(schema.reviews.userId, user.id)),
    columns: { id: true, gameId: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const [game, profile] = await Promise.all([
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { slug: true },
    }),
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, user.id),
      columns: { username: true },
    }),
  ]);

  await db.delete(schema.reviews).where(eq(schema.reviews.id, review.id));

  if (profile) {
    revalidatePath(`/u/${profile.username}/reviews`);
    if (game) revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  }
  if (game) revalidatePath(`/games/${game.slug}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// likeReview / unlikeReview
// ---------------------------------------------------------------------------

const likeInput = z.object({ reviewId: z.string().uuid() });

export async function likeReview(input: unknown): Promise<UpdateResult> {
  const parsed = likeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  await db
    .insert(schema.likes)
    .values({ userId: user.id, reviewId: parsed.data.reviewId })
    .onConflictDoNothing();

  const ctx = await reviewLookupForRevalidate(parsed.data.reviewId);
  if (ctx) revalidatePath(`/u/${ctx.username}/reviews/${ctx.gameSlug}`);
  return { ok: true };
}

export async function unlikeReview(input: unknown): Promise<UpdateResult> {
  const parsed = likeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  await db
    .delete(schema.likes)
    .where(
      and(eq(schema.likes.userId, user.id), eq(schema.likes.reviewId, parsed.data.reviewId)),
    );

  const ctx = await reviewLookupForRevalidate(parsed.data.reviewId);
  if (ctx) revalidatePath(`/u/${ctx.username}/reviews/${ctx.gameSlug}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// reviewLookupForRevalidate (internal helper)
// ---------------------------------------------------------------------------

async function reviewLookupForRevalidate(
  reviewId: string,
): Promise<{ username: string; gameSlug: string } | null> {
  const r = await db.query.reviews.findFirst({
    where: eq(schema.reviews.id, reviewId),
    columns: { userId: true, gameId: true },
  });
  if (!r) return null;
  const [profile, game] = await Promise.all([
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, r.userId),
      columns: { username: true },
    }),
    db.query.games.findFirst({
      where: eq(schema.games.id, r.gameId),
      columns: { slug: true },
    }),
  ]);
  if (!profile || !game) return null;
  return { username: profile.username, gameSlug: game.slug };
}
