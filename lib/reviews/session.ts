import "server-only";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/cache/redis";

const ONE_HOUR_SECONDS = 60 * 60;

export interface InterviewSession {
  interviewId: string;
  userId: string;
  logId: string;
  gameId: number;
  /** questions[0] = Q1, questions[1] = Q2, etc. Q1 is set on session create; Q2-Q4 are
   *  written via appendQuestion after each AI stream completes. */
  questions: string[];
  /** answers[i] is the user's answer to questions[i]. Length grows from 0 to 4. */
  answers: string[];
  createdAt: number;
}

function key(interviewId: string): string {
  return `ai:interview:${interviewId}`;
}

export async function createSession(args: {
  userId: string;
  logId: string;
  gameId: number;
  /** The fixed Q1 opener — written into questions[0] at session-create time. */
  openerQuestion: string;
}): Promise<InterviewSession> {
  const session: InterviewSession = {
    interviewId: randomUUID(),
    userId: args.userId,
    logId: args.logId,
    gameId: args.gameId,
    questions: [args.openerQuestion],
    answers: [],
    createdAt: Date.now(),
  };
  await redis.set(key(session.interviewId), session, { ex: ONE_HOUR_SECONDS });
  return session;
}

export async function getSession(interviewId: string): Promise<InterviewSession | null> {
  const value = await redis.get<InterviewSession>(key(interviewId));
  return value ?? null;
}

/**
 * Append (or replace) the answer for the given 1-based turn number. If a
 * later answer already exists, it's discarded — editing answer N invalidates
 * answers N+1..4.
 */
export async function appendAnswer(
  interviewId: string,
  turn: number,
  text: string,
): Promise<InterviewSession | null> {
  const session = await getSession(interviewId);
  if (!session) return null;
  const next = { ...session };
  next.answers = next.answers.slice(0, turn - 1);
  next.answers[turn - 1] = text;
  await redis.set(key(interviewId), next, { ex: ONE_HOUR_SECONDS });
  return next;
}

/**
 * Save the AI-generated question for the given 1-based turn. Called by
 * submitAnswer once the next-question stream completes so review_questions
 * rows can later carry the real text (not a placeholder).
 */
export async function appendQuestion(
  interviewId: string,
  turn: number,
  text: string,
): Promise<InterviewSession | null> {
  const session = await getSession(interviewId);
  if (!session) return null;
  const next = { ...session, questions: [...session.questions] };
  next.questions[turn - 1] = text;
  await redis.set(key(interviewId), next, { ex: ONE_HOUR_SECONDS });
  return next;
}

export async function destroySession(interviewId: string): Promise<void> {
  await redis.del(key(interviewId));
}
