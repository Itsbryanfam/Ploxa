"use client";

import { useState, useTransition } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";

import { SteamIcon, XboxIcon } from "@/components/pixel/platform-icons";
import { syncNow, disconnectPlatform } from "@/lib/imports/server-actions";
import type { ConnectionSummary } from "@/lib/imports/server-actions";
import { XboxConnectModal } from "./xbox-connect-modal";

// ─── Types ──────────────────────────────────────────────────────────────────

type Platform = "steam" | "xbox" | "manual";

type CardState = "not-connected" | "connecting" | "importing" | "connected" | "error";

interface Props {
  platform: Platform;
  /** null means "not yet connected" (or "manual" which is always treated as connected) */
  summary: ConnectionSummary | null;
  /** Only used when platform="manual" */
  manualGameCount?: number;
}

// ─── Error recovery copy map ────────────────────────────────────────────────

const RECOVERY_COPY: Record<string, { copy: string; primary: string }> = {
  STEAM_PRIVATE_PROFILE: {
    copy: "Your Steam profile is set to private. Set it to Public for 5 minutes so we can import, then you can flip it back.",
    primary: "Retry sync",
  },
  XBOX_KEY_INVALID: {
    copy: "Your OpenXBL key was rejected. Generate a new one at xbl.io and reconnect.",
    primary: "Reconnect",
  },
  STEAM_API_ERROR: {
    copy: "We couldn't reach Steam for your account. Reconnect to refresh the link.",
    primary: "Reconnect",
  },
};

const DEFAULT_RECOVERY = {
  copy: "Sync paused. Try again, or reconnect if the problem persists.",
  primary: "Retry sync",
};

// ─── State derivation ────────────────────────────────────────────────────────

function deriveState(props: Props): CardState {
  if (props.platform === "manual") return "connected";
  const s = props.summary;
  if (!s || !s.isActive) return "not-connected";
  if (
    s.latestImport?.status === "running" ||
    s.latestImport?.status === "queued"
  )
    return "importing";
  if (s.latestImport?.status === "failed") return "error";
  return "connected";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function platformLabel(platform: Platform): string {
  if (platform === "steam") return "Steam";
  if (platform === "xbox") return "Xbox";
  return "Manual";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Tiny inline spinner */
function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Three-dot kebab icon */
function KebabIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}

/** Platform icon switcher */
function PlatformIcon({ platform, muted = false }: { platform: Platform; muted?: boolean }) {
  const opacity = muted ? "opacity-50" : "";
  if (platform === "steam") return <SteamIcon size={28} className={opacity} />;
  if (platform === "xbox") return <XboxIcon size={28} className={opacity} />;
  // Manual — pencil/book-style pixel icon inline
  return (
    <svg
      viewBox="0 0 16 16"
      width={28}
      height={28}
      shapeRendering="crispEdges"
      className={opacity}
    >
      {/* Notebook body */}
      <rect x="2" y="1" width="10" height="14" fill="#9494a8" />
      <rect x="3" y="2" width="8" height="12" fill="#1a1a24" />
      {/* Spine */}
      <rect x="1" y="3" width="1" height="10" fill="#7c5cff" />
      {/* Lines */}
      <rect x="4" y="4" width="6" height="1" fill="#9494a8" opacity="0.5" />
      <rect x="4" y="6" width="6" height="1" fill="#9494a8" opacity="0.5" />
      <rect x="4" y="8" width="4" height="1" fill="#9494a8" opacity="0.5" />
      {/* Pencil */}
      <rect x="12" y="9" width="2" height="5" fill="#facc15" />
      <rect x="12" y="8" width="2" height="1" fill="#f87171" />
      <rect x="13" y="13" width="1" height="1" fill="#facc15" opacity="0.6" />
    </svg>
  );
}

// ─── Disconnect confirmation dialog ──────────────────────────────────────────

interface DisconnectDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  platform: "steam" | "xbox";
  onConfirm: () => void;
  pending: boolean;
}

function DisconnectDialog({
  open,
  onOpenChange,
  platform,
  onConfirm,
  pending,
}: DisconnectDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(380px,calc(100vw-32px))] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl">
          <Dialog.Title className="text-sm font-semibold mb-2">
            Disconnect {platformLabel(platform)}?
          </Dialog.Title>
          <Dialog.Description className="text-sm text-[var(--text-muted)] mb-5">
            Your imported games stay. We&apos;ll just stop syncing.
          </Dialog.Description>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="text-sm px-3 py-1.5 rounded border border-[var(--border)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="text-sm px-3 py-1.5 rounded bg-[var(--danger,#ef4444)] text-white disabled:opacity-60 flex items-center gap-1.5"
            >
              {pending && <Spinner />}
              Disconnect
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PlatformCard(props: Props) {
  const state = deriveState(props);
  const label = platformLabel(props.platform);

  const [xboxModalOpen, setXboxModalOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [pendingSync, startSync] = useTransition();
  const [pendingDisconnect, startDisconnect] = useTransition();

  // ── Manual card (early return) ────────────────────────────────────────────
  if (props.platform === "manual") {
    return (
      <div className="border border-dashed border-[var(--border)] rounded-md p-3 flex items-center gap-3">
        <PlatformIcon platform="manual" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">
            Manual{" "}
            <span className="text-xs font-normal text-[var(--text-muted)]">
              · Switch + physical
            </span>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {props.manualGameCount ?? 0} games logged manually
          </div>
        </div>
        <a
          href="/library"
          className="shrink-0 text-xs text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
        >
          Log a game →
        </a>
      </div>
    );
  }

  // From here, platform is "steam" | "xbox"
  const syncablePlatform = props.platform as "steam" | "xbox";

  // ── Shared card shell ─────────────────────────────────────────────────────
  const isImporting = state === "importing";
  const isError = state === "error";
  const isConnected = state === "connected";

  const borderClass = isImporting
    ? "border-[var(--accent)]"
    : isError
      ? "border-[var(--danger,#ef4444)]"
      : "border-[var(--border)]";

  // errorMessage may exist on the runtime object even if not in the TS type
  // (e.g., if the query is extended); safe optional-chain access.
  const rawErrorCode =
    (
      props.summary?.latestImport as
        | (NonNullable<ConnectionSummary["latestImport"]> & {
            errorMessage?: string | null;
          })
        | null
        | undefined
    )?.errorMessage ?? "";
  const recovery = RECOVERY_COPY[rawErrorCode] ?? DEFAULT_RECOVERY;

  const importedCount = props.summary?.latestImport?.importedCount ?? 0;
  const totalCount = props.summary?.latestImport?.totalCount ?? 0;
  const progressPct =
    totalCount > 0 ? Math.min(100, Math.round((importedCount / totalCount) * 100)) : 0;

  return (
    <>
      <div
        className={`bg-[var(--bg-card)] border ${borderClass} rounded-md p-3 transition-colors`}
      >
        {/* ── Not connected ── */}
        {state === "not-connected" && (
          <div className="flex items-center gap-3">
            <PlatformIcon platform={props.platform} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{label}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {props.platform === "steam"
                  ? "Import your entire Steam library automatically."
                  : "Import your Xbox play history via OpenXBL."}
              </div>
            </div>
            {props.platform === "steam" ? (
              <a
                href="/api/auth/steam"
                className="shrink-0 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                Connect Steam
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setXboxModalOpen(true)}
                className="shrink-0 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                Connect Xbox
              </button>
            )}
          </div>
        )}

        {/* ── Connecting ── */}
        {state === "connecting" && (
          <div className="flex items-center gap-3">
            <PlatformIcon platform={props.platform} muted />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--text-muted)]">
                Verifying with {label}…
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Hang on — this usually takes a few seconds.
              </div>
            </div>
            <Spinner className="text-[var(--accent)]" />
          </div>
        )}

        {/* ── Importing ── */}
        {state === "importing" && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <PlatformIcon platform={props.platform} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-xs text-[var(--accent)]">
                  Importing · {importedCount} / {totalCount || "?"} games
                </div>
              </div>
              <Spinner className="text-[var(--accent)]" />
            </div>
            {/* Progress bar */}
            <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Connected ── */}
        {isConnected && props.summary && (
          <div className="flex items-start gap-3">
            <PlatformIcon platform={props.platform} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{label}</div>
              <div className="text-xs text-[var(--text-muted)] space-x-1">
                {props.summary.externalId && (
                  <span className="font-mono">@{props.summary.externalId}</span>
                )}
                <span>·</span>
                <span>{props.summary.gameCount} games</span>
                <span>·</span>
                <span>Last synced {relativeTime(props.summary.lastSyncedAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Sync now button */}
              <button
                type="button"
                onClick={() =>
                  startSync(async () => {
                    await syncNow(syncablePlatform);
                  })
                }
                disabled={pendingSync}
                className="text-xs px-2.5 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {pendingSync ? <Spinner /> : null}
                {pendingSync ? "Syncing…" : "Sync now"}
              </button>

              {/* Kebab menu */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label="More options"
                    className="p-1.5 rounded hover:bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
                    <KebabIcon />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-30 min-w-[160px] rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-1 shadow-lg text-sm"
                  >
                    <DropdownMenu.Item
                      onSelect={() =>
                        startSync(async () => {
                          await syncNow(syncablePlatform);
                        })
                      }
                      className="px-2.5 py-1.5 rounded cursor-pointer hover:bg-[var(--bg)] outline-none"
                    >
                      Re-import full
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-[var(--border)]" />
                    <DropdownMenu.Item
                      onSelect={() => setDisconnectOpen(true)}
                      className="px-2.5 py-1.5 rounded cursor-pointer hover:bg-[var(--bg)] outline-none text-[var(--danger,#ef4444)]"
                    >
                      Disconnect
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="flex items-start gap-3">
            <PlatformIcon platform={props.platform} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--danger,#ef4444)]">
                {label} · Sync failed
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">{recovery.copy}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (recovery.primary.toLowerCase().includes("reconnect")) {
                  if (props.platform === "xbox") {
                    setXboxModalOpen(true);
                  } else {
                    window.location.href = "/api/auth/steam";
                  }
                } else {
                  startSync(async () => {
                    await syncNow(syncablePlatform);
                  });
                }
              }}
              disabled={pendingSync}
              className="shrink-0 text-xs px-2.5 py-1 rounded bg-[var(--danger,#ef4444)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
            >
              {pendingSync && <Spinner />}
              {recovery.primary}
            </button>
          </div>
        )}
      </div>

      {/* ── Xbox connect modal ───────────────────────────────────────────── */}
      {props.platform === "xbox" && (
        <XboxConnectModal open={xboxModalOpen} onOpenChange={setXboxModalOpen} />
      )}

      {/* ── Disconnect confirmation dialog ───────────────────────────────── */}
      <DisconnectDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        platform={syncablePlatform}
        pending={pendingDisconnect}
        onConfirm={() =>
          startDisconnect(async () => {
            await disconnectPlatform(syncablePlatform);
            setDisconnectOpen(false);
          })
        }
      />
    </>
  );
}
