import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

export default async function MeRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: { username: true },
  });
  if (!profile) redirect("/");
  redirect(`/u/${profile.username}/reviews/${slug}`);
}
