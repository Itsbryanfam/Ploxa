"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { deleteReview } from "@/lib/reviews/server-actions";

interface Props {
  reviewId: string;
  username: string;
}

export function DeleteReviewLink({ reviewId, username }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteReview({ reviewId });
      if (result.ok) {
        // Don't close here — leaving the dialog open avoids a flash before
        // navigation; the modal unmounts with the page.
        router.push(`/u/${username}/reviews`);
      } else {
        // On failure, drop the dialog so the user can see the page and decide
        // what to do — focus restores to the trigger automatically.
        setOpen(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[var(--text-dim)] hover:text-red-500"
      >
        Delete
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-32px))] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <Dialog.Title className="text-lg font-semibold">
              Delete this review?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-[var(--text-dim)]">
              Permanently removes the review and all its comments. The
              underlying log keeps your status, rating, and dates. You can&apos;t
              undo this.
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={pending}
                  className="px-4 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)] disabled:opacity-50"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="px-4 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete review"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
