"use client";

import { useId, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { block } from "@/lib/social/blocks/server-actions";

/**
 * Overflow menu (⋯) + native <dialog> confirm for blocking another user.
 *
 * Uses the platform `<dialog>` element with `showModal()` rather than a
 * portal-based modal library: zero extra deps, built-in backdrop, focus
 * trap, and ESC-to-close. After a successful block we redirect to /home
 * because the now-blocked profile will 404 on refresh anyway — staying
 * on the (now broken) URL is worse UX than landing on home.
 */
export function BlockAction({
  targetUserId,
  targetUsername,
}: {
  targetUserId: string;
  targetUsername: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  }

  function confirmBlock() {
    startTransition(async () => {
      const result = await block(targetUserId);
      if (result.ok) {
        router.push("/home");
      } else {
        handleClose(); // focus returns to trigger on failure
      }
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="More options"
        onClick={() => dialogRef.current?.showModal()}
        className="px-2 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]"
      >
        ⋯
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="rounded-lg p-6 bg-[var(--bg-card)] text-[var(--text)] border border-[var(--border)] backdrop:bg-black/40 max-w-sm"
      >
        <h2 id={titleId} className="text-lg font-semibold">Block @{targetUsername}?</h2>
        <p className="mt-2 text-sm text-[var(--text-dim)]">
          You won&apos;t see their content. They won&apos;t see yours. Mutual follows and
          likes will be removed and won&apos;t be restored if you unblock.
        </p>
        <div className="mt-6 flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmBlock}
            disabled={isPending}
            className="px-4 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            Block
          </button>
        </div>
      </dialog>
    </>
  );
}
