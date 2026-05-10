"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ensureMyProfile } from "@/lib/profile/server-actions";

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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  await ensureMyProfile();
  // Only honor relative paths — prevents open-redirect via crafted `next=`.
  const safeNext = parsed.data.next?.startsWith("/") ? parsed.data.next : "/home";
  redirect(safeNext);
}

export async function sendMagicLink(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const next = parsed.data.next ? `?next=${encodeURIComponent(parsed.data.next)}` : "";

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
