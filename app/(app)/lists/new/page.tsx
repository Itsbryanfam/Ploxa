import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { createList } from "@/lib/social/lists/server-actions";

/**
 * /lists/new — creates a draft list named "Untitled list" and redirects to
 * the editor. Server component; no UI rendered.
 */
export default async function NewListPage() {
  const user = await getCachedUser();
  if (!user) {
    redirect("/login");
  }

  const result = await createList({ title: "Untitled list", isPublic: true });

  if (!result.ok) {
    // If not-authenticated (race), redirect to login. For invalid-input just
    // send to /home — shouldn't happen with a hardcoded title.
    if (result.reason === "not-authenticated") {
      redirect("/login");
    }
    redirect("/home");
  }

  redirect(`/lists/${result.listId}/edit`);
}
