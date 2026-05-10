import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mascot } from "@/components/mascot/mascot";

import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Sign up",
};

export default function SignupPage() {
  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Mascot size="lg" mood="celebrating" silent />
        <h1 className="text-2xl font-semibold">Start tracking</h1>
        <p className="text-sm text-[var(--text-dim)]">It takes about ten seconds. Promise.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Free forever for personal use. No credit card.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-[var(--text-dim)]">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--accent)] hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
