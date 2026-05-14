import "server-only";
import { SignJWT, jwtVerify } from "jose";

import { requireEnv } from "@/lib/env";

/**
 * Unsubscribe token helpers — HS256 JWT with no expiry. The "no expiry"
 * choice is deliberate: one-click unsubscribe should keep working
 * indefinitely (a user clicking a digest from two years ago must still
 * succeed). The token is single-purpose (audience='digest-unsubscribe')
 * so a leaked token cannot authorize anything else.
 *
 * Secret rotation invalidates all outstanding links — accept the tradeoff
 * and document it. Run:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * to generate the secret; store in env as UNSUBSCRIBE_SECRET.
 */

const ISSUER = "ploxa";
const AUDIENCE = "digest-unsubscribe";

function getKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("UNSUBSCRIBE_SECRET"));
}

export async function signUnsubscribeToken(userId: string): Promise<string> {
  return await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(getKey());
}

export async function verifyUnsubscribeToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}
