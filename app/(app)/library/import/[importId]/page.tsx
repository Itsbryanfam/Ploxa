import { eq, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";
import { ImportSummary } from "@/components/imports/import-summary";

interface PageProps {
  params: Promise<{ importId: string }>;
}

export default async function ImportSummaryPage({ params }: PageProps) {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const { importId } = await params;

  const [row] = await db.select().from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, user.id)))
    .limit(1);
  if (!row || (row.platform !== "steam" && row.platform !== "xbox")) notFound();

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <ImportSummary importId={importId} platform={row.platform} />
    </div>
  );
}
