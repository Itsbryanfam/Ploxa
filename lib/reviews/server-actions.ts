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
import {
  createSession,
  getSession,
  appendAnswer,
  appendQuestion,
} from "./session";
import {
  SYSTEM_PROMPT,
  openerQuestion,
  followUpPrompt,
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

// Future tasks (T8/T9/T10) will append: generateDraft, regenerateSection,
// publishReview, updateReview, deleteReview, likeReview, unlikeReview.

// Re-export destroySession for T8's generateDraft so it can either import
// from here or directly from session.ts.
export { destroySession as _destroyInterviewSession } from "./session";
