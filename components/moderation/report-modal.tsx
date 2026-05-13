"use client";
import { useState, useTransition } from "react";
import { Flag } from "lucide-react";

import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { createReport } from "@/lib/social/moderation/server-actions";

const REASONS = [
  { value: "spam", label: "Spam or unwanted ads" },
  { value: "harassment", label: "Harassment or hate speech" },
  { value: "spoiler", label: "Untagged spoiler" },
  { value: "off_topic", label: "Off-topic" },
  { value: "other", label: "Something else" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

export function ReportModal({
  targetType,
  targetId,
}: {
  targetType: "comment" | "review" | "list" | "profile";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("spam");
  const [details, setDetails] = useState("");
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await createReport({
        targetType,
        targetId,
        reason,
        details: details || undefined,
      });
      if (r.ok) {
        setSuccess(true);
        // Auto-close shortly after the thank-you to keep the modal lightweight.
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
        }, 2000);
      } else {
        setError(
          r.reason === "rate-limited"
            ? "You've sent too many reports recently — try again later."
            : r.reason === "not-authenticated"
              ? "Please log in to report."
              : "Couldn't send report. Try again later.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          <Flag size={12} /> Report
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {success ? "Report submitted" : `Report this ${targetType}`}
          </DialogTitle>
          <DialogDescription>
            {success
              ? "Thanks — we'll review this within 48 hours."
              : "Pick a reason. Optional context helps the mods."}
          </DialogDescription>
        </DialogHeader>
        {!success && (
          <>
            <fieldset className="space-y-2">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Optional details (max 500 chars)"
              rows={3}
              maxLength={500}
              className="w-full p-2 text-sm rounded border border-[var(--border)] bg-[var(--bg)]"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <DialogFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-1.5 text-sm rounded border border-[var(--border)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-white disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send report"}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
