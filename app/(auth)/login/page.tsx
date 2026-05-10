import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mascot } from "@/components/mascot/mascot";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Log in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Mascot size="lg" mood="waving" silent />
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-sm text-[var(--text-dim)]">Log in to keep tracking your gaming life.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Email and password, or a magic link to your inbox.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-[var(--text-dim)]">
        New here?{" "}
        <Link href="/signup" className="text-[var(--accent)] hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
