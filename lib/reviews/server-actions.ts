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
import { triggerOnLogWrite } from "@/lib/taste/triggers";
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
  // Two cases:
  //   1. Published review exists → block, bounce client to its editor URL.
  //   2. Unpublished draft exists → it's stale (the previous interview
  //      either failed or was abandoned). Delete it so we can write a
  //      fresh one from the current interview's answers. The cascade on
  //      review_questions.reviewId removes the old Q&A rows too.
  const existing = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, user.id),
      eq(schema.reviews.gameId, session.gameId),
    ),
    columns: { id: true, publishedAt: true },
  });
  if (existing && existing.publishedAt != null) {
    return { ok: false, error: "You've already reviewed this game", existingReviewId: existing.id };
  }
  if (existing) {
    // Defense-in-depth: redundant userId filter (findFirst above scoped it).
    await db
      .delete(schema.reviews)
      .where(and(eq(schema.reviews.id, existing.id), eq(schema.reviews.userId, user.id)));
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
    // updatedAt is snapshotted here and used as an optimistic-lock token
    // on the final UPDATE — without it, a concurrent manual edit between
    // this read and the AI-stream completion would be clobbered.
    columns: { id: true, body: true, gameId: true, updatedAt: true },
  });
  if (!review) return { ok: false, error: "Review not found" };
  const lockToken = review.updatedAt;

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
      // Preserve any paragraphs beyond the 4-section structure — users
      // who've added extra paragraphs in the editor shouldn't lose them
      // when regenerating one section.
      const sections = (review.body ?? "").split("\n\n");
      while (sections.length < 4) sections.push("");
      sections[parsed.data.sectionIndex] = acc.trim();
      const newBody = sections.join("\n\n");
      // Optimistic lock: only write if updatedAt hasn't moved. A concurrent
      // manual edit advances updatedAt; in that case we discard the AI
      // output rather than overwrite the user's edits. The client streams
      // the AI output through `streamable` already so the user can copy it
      // by hand if they want it.
      const updated = await db
        .update(schema.reviews)
        .set({ body: newBody, updatedAt: new Date() })
        .where(
          and(
            eq(schema.reviews.id, review.id),
            eq(schema.reviews.updatedAt, lockToken),
          ),
        )
        .returning({ id: schema.reviews.id });
      if (updated.length === 0) {
        // Lost the race; complete the stream so the UI doesn't hang, but
        // don't persist. Caller can detect this via the missing DB change.
        streamable.done(acc);
        return;
      }
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
  // Rating in [0, 10] in 0.5 steps — matches the half-heart UI control and
  // the numeric(3,1) DB column. Without the step refine, the action would
  // accept e.g. 7.3 and store it, breaking heart-rating render alignment.
  rating: z
    .number()
    .min(0)
    .max(10)
    .refine((v) => v * 2 === Math.round(v * 2), "Rating must be in 0.5 steps"),
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

  await triggerOnLogWrite(user.id);
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

  // Defense-in-depth: redundant userId filter (the findFirst above scoped
  // it to the authenticated user).
  await db
    .delete(schema.reviews)
    .where(and(eq(schema.reviews.id, review.id), eq(schema.reviews.userId, user.id)));

  if (profile) {
    revalidatePath(`/u/${profile.username}/reviews`);
    if (game) revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  }
  if (game) revalidatePath(`/games/${game.slug}`);
  // Deleting a *published* review removes the hasPublishedReview ×1.15
  // weight bonus → vector signal shifts. Draft deletes are a cheap
  // no-op here (DELETE-recs hits the partial index for an empty bucket).
  await triggerOnLogWrite(user.id);
  return { ok: true };
}

// likeReview / unlikeReview moved to lib/social/reactions/server-actions.ts in
// Phase 5 (T16). The new path adds block-check, self-like silent-success, and
// emit() notification side-effects. The pre-Phase-5 stub here was unused by
// any UI that wasn't also being migrated; it lived only to satisfy the
// LikeButton's import. Deleted with T17.
