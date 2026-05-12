"use server";

import sharp from "sharp";
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
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";

// sharp's `format` strings → our allowed MIMEs. Used to confirm the
// declared Content-Type matches what the bytes actually are.
const SHARP_FORMAT_TO_MIME: Record<string, AllowedMime> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

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

  // 10 avatar uploads per user per hour — generous for legitimate
  // cropping/iteration, but caps Sharp CPU + storage bandwidth abuse.
  try {
    await enforceRateLimit({
      scope: "avatar:upload",
      identifier: user.id,
      limit: 10,
      windowSeconds: 3600,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return { ok: false, error: "Too many avatar uploads. Try again later." };
    }
    throw err;
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Missing file." };
  if (!isAllowedMime(file.type))
    return { ok: false, error: "Upload a JPG, PNG, WebP, or GIF." };
  if (file.size > AVATAR_MAX_BYTES)
    return { ok: false, error: "File is over 5 MB." };

  const buf = Buffer.from(await file.arrayBuffer());

  // Content-sniff: trust the bytes, not the client's declared mime.
  // Catches an HTML / SVG / etc. payload uploaded with a forged
  // Content-Type. sharp.metadata() reads the format from magic bytes.
  let sniffedMime: AllowedMime;
  try {
    const meta = await sharp(buf).metadata();
    const detected = meta.format ? SHARP_FORMAT_TO_MIME[meta.format] : undefined;
    if (!detected) {
      return { ok: false, error: "Unsupported image format." };
    }
    sniffedMime = detected;
  } catch {
    return { ok: false, error: "Could not read image." };
  }
  if (sniffedMime !== file.type) {
    // Treat declared/actual mismatch as a rejection rather than silently
    // trusting the bytes — the declared mime drives the storage-served
    // Content-Type header downstream, so a mismatch is a real concern.
    return { ok: false, error: "Image format does not match the file type." };
  }

  const ext = extFromMime(sniffedMime);
  const isGif = sniffedMime === "image/gif";

  let urls: { url: string; posterUrl: string | null };
  try {
    if (isGif) {
      const poster = await extractGifFirstFrame(buf);
      urls = await uploadAvatarFiles(
        user.id,
        { ext, mime: sniffedMime, bytes: buf },
        { ext: "png", bytes: poster },
      );
    } else {
      urls = await uploadAvatarFiles(user.id, {
        ext,
        mime: sniffedMime,
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
