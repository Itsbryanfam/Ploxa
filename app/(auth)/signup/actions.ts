"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

const signupSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type ActionResult = { error?: string; success?: string } | undefined;

export async function signup(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // If email confirmation is required (default in Supabase), surface a notice.
  if (data.user && !data.session) {
    return {
      success:
        "Check your inbox to confirm your email — once you click the link, you'll be signed in.",
    };
  }

  redirect("/dashboard");
}
