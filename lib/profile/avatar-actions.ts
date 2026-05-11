"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  AVATAR_ALLOWED_MIMES,
  AVATAR_MAX_BYTES,
  type AllowedMime,
  extFromMime,
  extractGifFirstFrame,
  uploadAvatarFiles,
  deleteUploadedAvatar,
} from "@/lib/storage/avatar";

export type UploadAvatarResult =
  | { ok: true; url: string; posterUrl: string | null; kind: "static" | "gif" }
  | { ok: false; error: string };

function isAllowedMime(t: string): t is AllowedMime {
  return (AVATAR_ALLOWED_MIMES as readonly string[]).includes(t);
}

export async function uploadAvatar(
  formData: FormData,
): Promise<UploadAvatarResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Missing file." };
  if (!isAllowedMime(file.type))
    return { ok: false, error: "Upload a JPG, PNG, WebP, or GIF." };
  if (file.size > AVATAR_MAX_BYTES)
    return { ok: false, error: "File is over 5 MB." };

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = extFromMime(file.type);
  const isGif = file.type === "image/gif";

  let urls: { url: string; posterUrl: string | null };
  try {
    if (isGif) {
      const poster = await extractGifFirstFrame(buf);
      urls = await uploadAvatarFiles(
        user.id,
        { ext, mime: file.type, bytes: buf },
        { ext: "png", bytes: poster },
      );
    } else {
      urls = await uploadAvatarFiles(user.id, {
        ext,
        mime: file.type,
        bytes: buf,
      });
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Upload failed.",
    };
  }

  try {
    await db
      .update(schema.profiles)
      .set({
        profilePictureUrl: urls.url,
        profilePictureKind: isGif ? "gif" : "static",
        // updated_at has DEFAULT now() but that only fires on INSERT — UPDATEs
        // must set it explicitly or queries that order/cache by updatedAt see
        // a stale timestamp after an avatar change.
        updatedAt: new Date(),
      })
      .where(eq(schema.profiles.userId, user.id)); // ← userId, NOT id (plan defect corrected)
  } catch {
    // Roll back the upload so disk and DB don't drift.
    await deleteUploadedAvatar(user.id, ext, isGif);
    return { ok: false, error: "Could not save avatar reference." };
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    url: urls.url,
    posterUrl: urls.posterUrl,
    kind: isGif ? "gif" : "static",
  };
}
