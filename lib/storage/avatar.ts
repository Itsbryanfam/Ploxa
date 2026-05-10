import sharp from "sharp";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const AVATAR_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedMime = (typeof AVATAR_ALLOWED_MIMES)[number];

export function extFromMime(mime: AllowedMime): "jpg" | "png" | "webp" | "gif" {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
  }
}

/** Extract the first frame of an animated GIF as a PNG buffer. */
export async function extractGifFirstFrame(gifBuffer: Buffer): Promise<Buffer> {
  return sharp(gifBuffer, { animated: false }).png().toBuffer();
}

/**
 * Upload primary + optional poster to <userId>/<path> in the avatars bucket.
 * Returns public URLs. Throws on failure — the server action wraps with a
 * friendly envelope.
 */
export async function uploadAvatarFiles(
  userId: string,
  primary: { ext: string; mime: string; bytes: Buffer },
  poster?: { ext: "png"; bytes: Buffer },
): Promise<{ url: string; posterUrl: string | null }> {
  const supabase = await createSupabaseServerClient();
  const primaryPath = `${userId}/avatar.${primary.ext}`;
  const { error: uErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(primaryPath, primary.bytes, {
      contentType: primary.mime,
      upsert: true,
    });
  if (uErr) throw new Error(`storage upload failed: ${uErr.message}`);

  let posterUrl: string | null = null;
  if (poster) {
    const posterPath = `${userId}/avatar-poster.png`;
    const { error: pErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(posterPath, poster.bytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (pErr) {
      // Roll back the primary upload so we don't orphan it.
      await supabase.storage.from(AVATAR_BUCKET).remove([primaryPath]);
      throw new Error(`storage poster upload failed: ${pErr.message}`);
    }
    const { data: pUrl } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(posterPath);
    posterUrl = pUrl.publicUrl;
  }

  const { data: pubUrl } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(primaryPath);

  return { url: pubUrl.publicUrl, posterUrl };
}

/** Best-effort cleanup; called when DB update fails after upload. */
export async function deleteUploadedAvatar(
  userId: string,
  ext: string,
  hasPoster: boolean,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const paths = [`${userId}/avatar.${ext}`];
  if (hasPoster) paths.push(`${userId}/avatar-poster.png`);
  await supabase.storage.from(AVATAR_BUCKET).remove(paths);
}
