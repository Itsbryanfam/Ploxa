"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  ensureMyProfile,
  suggestUsernames,
  checkUsernameAvailability,
} from "@/lib/profile/server-actions";
import { UsernameCollisionError } from "@/lib/profile/errors";
import { usernameSchema } from "@/lib/profile/username-schema";

const signupSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: usernameSchema,
});

export type ActionResult = { error?: string; success?: string; suggestions?: string[] } | undefined;

export async function signup(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    username: formData.get("username"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Server-side availability check — fast path before hitting auth.signUp.
  // This tightens (but doesn't eliminate) the TOCTOU race window.
  const availability = await checkUsernameAvailability(parsed.data.username);
  if (!availability.ok) {
    if (availability.reason === "taken" || availability.reason === "reserved") {
      const suggestions = await suggestUsernames(parsed.data.username);
      return {
        error:
          availability.reason === "taken"
            ? "That username is already taken. Try one of these:"
            : "That username is reserved. Try one of these:",
        suggestions,
      };
    }
    return { error: "Username is invalid." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      // Store chosen username in user metadata so auth/callback can pick it up
      // after email-confirmation if no immediate session is created.
      data: { username: parsed.data.username },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is required (default in Supabase), surface a notice.
  // The auth/callback route will call ensureMyProfile({ username }) once the
  // user clicks the confirmation link.
  if (data.user && !data.session) {
    return {
      success:
        "Check your inbox to confirm your email — once you click the link, you'll be signed in.",
    };
  }

  // Immediate session (email confirmation disabled) — insert profile now.
  try {
    await ensureMyProfile({ username: parsed.data.username });
  } catch (err) {
    if (err instanceof UsernameCollisionError) {
      const suggestions = await suggestUsernames(parsed.data.username);
      return {
        error: "That username was just taken. Try one of these:",
        suggestions,
      };
    }
    throw err;
  }

  redirect("/home");
}
