"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";

import { XblStep1 } from "./illustrations/xbl-step-1";
import { XblStep2 } from "./illustrations/xbl-step-2";
import { XblStep3 } from "./illustrations/xbl-step-3";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 1 | 2 | 3;

const COPY: Record<
  Step,
  { title: string; body: string; illustration: React.ReactNode; primary: string }
> = {
  1: {
    title: "Connecting Xbox is a two-tab dance",
    body: "Microsoft doesn't ship a public games API. We use a community service called OpenXBL — it's stable. Start by opening their site.",
    illustration: <XblStep1 width={240} height={180} />,
    primary: "Open xbl.io in new tab ↗",
  },
  2: {
    title: "Copy your API key",
    body: "On the xbl.io dashboard, click the API Key tab and copy the long string. We'll paste it on the next step.",
    illustration: <XblStep2 width={240} height={180} />,
    primary: "Next →",
  },
  3: {
    title: "Paste your key",
    body: "We'll encrypt it before storing. Your key stays on the server — we never send it back to your browser.",
    illustration: <XblStep3 width={240} height={180} />,
    primary: "Connect Xbox",
  },
};

export function XboxConnectModal({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const { title, body, illustration, primary } = COPY[step];

  function next() {
    if (step === 1) {
      window.open("https://xbl.io", "_blank", "noopener,noreferrer");
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else {
      submit();
    }
  }

  function submit() {
    setError(null);
    startSubmit(async () => {
      const res = await fetch("/api/connect/xbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (res.ok) {
        const { importId } = (await res.json()) as { importId: string };
        onOpenChange(false);
        router.push(`/library/import/${importId}`);
        return;
      }
      if (res.status === 401) {
        setError(
          "That key wasn't accepted. Double-check you copied the whole thing.",
        );
        return;
      }
      setError(
        "Something went wrong on OpenXBL's side. Try again in a minute.",
      );
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-32px))] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl">
          {/* Progress segments */}
          <div className="flex gap-1.5 mb-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`h-1 flex-1 rounded-full ${
                  step >= n ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              />
            ))}
          </div>

          <Dialog.Title className="text-sm font-semibold mb-2">
            Connect Xbox · Step {step} of 3
          </Dialog.Title>
          <Dialog.Description className="text-base font-medium mb-2">
            {title}
          </Dialog.Description>
          <p className="text-sm text-[var(--text-muted)] mb-4">{body}</p>

          <div className="mb-4 flex justify-center">{illustration}</div>

          {step === 3 && (
            <>
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste your OpenXBL key here…"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-sm font-mono mb-2"
                rows={3}
              />
              {error && (
                <p className="text-xs text-[var(--danger)] mb-2">{error}</p>
              )}
            </>
          )}

          <div className="flex gap-2 justify-between">
            <button
              type="button"
              onClick={() => setStep((s) => (Math.max(1, s - 1) as Step))}
              disabled={step === 1 || submitting}
              className="text-sm px-3 py-1.5 rounded border border-[var(--border)] disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={(step === 3 && key.trim().length < 10) || submitting}
              className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white disabled:opacity-60"
            >
              {submitting ? "Connecting…" : primary}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
