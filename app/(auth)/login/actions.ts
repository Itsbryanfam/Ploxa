"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ensureMyProfile } from "@/lib/profile/server-actions";
import { safeRedirectPath } from "@/lib/auth/safe-next";
import {
  enforceRateLimit,
  clientIpForRateLimit,
  RateLimitedError,
} from "@/lib/security/rate-limit";

const passwordSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

const magicLinkSchema = z.object({
  email: z.string().email("Enter a valid email"),
  next: z.string().optional(),
});

export type ActionResult = { error?: string; success?: string } | undefined;

export async function loginWithPassword(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 10 password attempts per IP per 5 minutes — caps credential-stuffing
  // without locking out legitimate users typo'ing their own password.
  try {
    const ip = await clientIpForRateLimit();
    await enforceRateLimit({
      scope: "auth:login",
      identifier: ip,
      limit: 10,
      windowSeconds: 300,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return { error: `Too many login attempts. Try again in ${Math.ceil(err.retryAfterSeconds / 60)} minute(s).` };
    }
    throw err;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  await ensureMyProfile();
  redirect(safeRedirectPath(parsed.data.next));
}

export async function sendMagicLink(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 3 magic links per email per hour — emails are expensive (Resend
  // free-tier cap) and the request-as-someone-else abuse case is real.
  try {
    await enforceRateLimit({
      scope: "auth:magic-link",
      identifier: parsed.data.email.toLowerCase(),
      limit: 3,
      windowSeconds: 3600,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return { error: "Too many magic-link requests. Try again later." };
    }
    throw err;
  }

  const supabase = await createSupabaseServerClient();
  // Validate `next` BEFORE passing it through the email redirect so the
  // generated link can't be hijacked into an open-redirect either.
  const validatedNext = safeRedirectPath(parsed.data.next);
  const next = validatedNext !== "/home" ? `?next=${encodeURIComponent(validatedNext)}` : "";

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback${next}`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { success: "Check your inbox for a sign-in link." };
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
