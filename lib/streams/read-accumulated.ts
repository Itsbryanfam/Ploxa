/**
 * Drain a ReadableStream<string> whose chunks are *accumulated* values
 * (each chunk is the full latest text, not a delta). Returns the final
 * accumulated string and fires `onChunk` for every intermediate value.
 *
 * Used by the AI review pipeline (section regenerate + interview draft)
 * where the server action streams the running buffer as it builds.
 */
export async function readAccumulatedStream(
  stream: ReadableStream<string>,
  onChunk: (latest: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  let last = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        last = value;
        onChunk(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return last;
}
