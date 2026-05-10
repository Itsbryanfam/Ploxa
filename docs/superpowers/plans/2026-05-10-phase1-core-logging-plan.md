# Phase 1 — Core Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dogfoodable game-tracker MVP — search RAWG via ⌘K palette, quick-log inline with hearts rating, view a Letterboxd-style poster wall library with three view modes, and visit a game detail page in either a slide-over panel or full route.

**Architecture:** Next.js 16 App Router with route groups (`(auth)`, `(app)`); RSC shells hydrated by TanStack Query for reactive lists; server actions for all mutations using Drizzle (postgres.js); Upstash Redis as a read-through cache in front of RAWG; intercepting routes for the slide-over detail panel. Mascot is a custom SVG sprite with a Zustand mood store and ~25-35 hand-written copy strings.

**Tech Stack:** Next.js 16 · React 19 · TypeScript strict · Tailwind v4 · Supabase (`@supabase/ssr` for auth) · Drizzle ORM (postgres.js) · TanStack Query · Zustand · Framer Motion · Upstash Redis · sonner (toast substrate, custom icons inside) · pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-10-phase1-core-logging-design.md`](../specs/2026-05-10-phase1-core-logging-design.md)

**Verification gate:** 14 acceptance checks (see Spec §08). Phase ships when all 14 pass manually.

**Testing posture (locked by spec):** No unit tests for Phase 1. TypeScript strict + Drizzle types + Zod RAWG validation = first defense. Verification gate = smoke test. First automated tests arrive Phase 4-5.

**Custom-asset rule (load-bearing):** Every UI element gets a custom SVG/pixel-art asset. Emojis in product UI are an anti-pattern. Site must feel hand-crafted, not AI-generated. Lucide-react acceptable for tertiary icons (chevrons, settings cogs) only.

**Mascot voice:** Sardonic insider. "Ribs your backlog, never insults your taste." All copy lives in `lib/mascot/copy.ts`.

---

## Pre-flight

This plan assumes Phase 0 + Phase 1 prep are done:
- ✅ Auth + Drizzle schema + RLS policies live
- ✅ Mascot stub at `components/mascot/mascot.tsx` (placeholder pixel-blob)
- ✅ shadcn-style primitives: Button, Card, Input, Label
- ✅ Upstash Redis client at `lib/cache/redis.ts` (smoke-tested)
- ✅ Design tokens in `app/globals.css`

**Existing patterns to match:**
- Server actions follow `app/(auth)/login/actions.ts` style: `"use server"`, Zod safeParse, `{ error?, success? }` return shape
- Singleton DB clients use `global.__xClient` pattern (see `lib/db/index.ts`, `lib/cache/redis.ts`)
- Auth guarded layout in `app/(app)/layout.tsx` redirects to `/login` if no user
- Tailwind classes use CSS vars: `text-[var(--text-dim)]`, `bg-[var(--bg-card)]`

---

# Week 3 — Foundation, Assets, Data Layer

Goal: ship every primitive and server module needed by Week 4. By end of week 3, the **palette doesn't exist yet but everything it needs does**.

---

### Task 1: Install reactivity + toast deps, mount providers

**Goal:** Add TanStack Query (with devtools) + sonner toast substrate, mounted at the app root so they're available everywhere downstream.

**Files:**
- Modify: `package.json` (add deps)
- Create: `app/providers.tsx` (client component owning `<QueryClientProvider>` + `<Toaster>`)
- Modify: `app/layout.tsx` (wrap children with `<Providers>`)

**Acceptance Criteria:**
- [ ] `pnpm install` succeeds with new deps
- [ ] App still renders (`pnpm dev` → visit `/` → no errors in browser console)
- [ ] React Query Devtools appears as a small icon at bottom-right in dev mode
- [ ] Calling `toast.success("test")` from any client component shows a toast

**Verify:** `pnpm dev` then visit `http://localhost:3000` — open devtools console, run `window.__test=true` (no errors), verify TanStack devtools floating icon visible.

**Steps:**

- [ ] **Step 1: Install dependencies**

```bash
pnpm add @tanstack/react-query @tanstack/react-query-devtools sonner
```

- [ ] **Step 2: Create the providers wrapper**

Create `app/providers.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // Per-render QueryClient via useState so it survives Next.js HMR cleanly
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s default — tune per query
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          },
        }}
      />
      {process.env.NODE_ENV !== "production" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Wrap root layout**

Edit `app/layout.tsx` — import `Providers` and wrap `{children}`:

```tsx
import { Providers } from "./providers";
// ... existing imports

// Inside the JSX, wrap children:
<body>
  <Providers>{children}</Providers>
</body>
```

(Match the existing layout structure — keep all existing classes/fonts.)

- [ ] **Step 4: Manual verify**

```bash
pnpm dev
```

Visit `http://localhost:3000`. Confirm: page renders, no console errors, TanStack devtools floating icon visible bottom-right.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml app/providers.tsx app/layout.tsx
git commit -m "Phase 1.1: mount TanStack Query + sonner providers"
```

---

### Task 2: Pixel asset library — hearts, status icons, platform icons, checkmark, spinner

**Goal:** Build the entire custom-pixel-art primitive set as inline SVG components. These are the load-bearing visual identity of Phase 1; nothing downstream renders until these exist.

**Files:**
- Create: `components/pixel/hearts.tsx` — `<HeartFull>`, `<HeartHalf>`, `<HeartEmpty>` as 16×16 SVGs
- Create: `components/pixel/status-icons.tsx` — 6 status sprites (Backlog/Playing/Completed/Dropped/On Hold/Wishlist)
- Create: `components/pixel/platform-icons.tsx` — 5 platform sprites (PC/Steam/Xbox/PSN/Switch)
- Create: `components/pixel/feedback-icons.tsx` — `<PixelCheckmark>`, `<PixelX>`, `<PixelInfo>`
- Create: `components/pixel/spinner.tsx` — `<PixelSpinner>` (rotating frame animation)
- Create: `components/pixel/index.ts` — barrel re-export

**Acceptance Criteria:**
- [ ] Every component renders at 16×16, 24×24, 32×32 (size prop)
- [ ] Hearts are recognizably Minecraft-style (red fill, dark outline, half = vertically split)
- [ ] Status icons are visually distinct from each other at 16px
- [ ] All SVGs use `shape-rendering="crispEdges"` for hard pixel edges
- [ ] No emoji unicode characters anywhere

**Verify:** Build a temporary scratch route `app/(app)/_scratch/pixels/page.tsx` that renders every icon on a dark background; visit `/_scratch/pixels` to eyeball. Delete the scratch route after verification.

**Steps:**

- [ ] **Step 1: Create the hearts component**

Create `components/pixel/hearts.tsx`:

```tsx
import type { SVGProps } from "react";

const HEART_RED = "#ef4444";
const HEART_OUTLINE = "#1a1a24";
const HEART_HIGHLIGHT = "#fca5a5";

interface HeartProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

/**
 * Minecraft-style pixel heart, 16x16 native.
 * Half-heart is vertically split (left half full, right half empty).
 * Color: bright red fill, dark outline, single highlight pixel.
 */
export function HeartFull({ size = 16, ...rest }: HeartProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="none"
      {...rest}
    >
      {/* Outline (top notches) */}
      <rect x="2" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      {/* Outline (sides) */}
      <rect x="1" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="14" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="2" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="13" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      {/* Outline (bottom point) */}
      <rect x="3" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="11" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="5" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="10" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="6" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="7" y="14" width="2" height="1" fill={HEART_OUTLINE} />
      {/* Red fill */}
      <rect x="2" y="4" width="5" height="4" fill={HEART_RED} />
      <rect x="9" y="4" width="5" height="4" fill={HEART_RED} />
      <rect x="3" y="8" width="10" height="2" fill={HEART_RED} />
      <rect x="4" y="10" width="8" height="1" fill={HEART_RED} />
      <rect x="5" y="11" width="6" height="1" fill={HEART_RED} />
      <rect x="6" y="12" width="4" height="1" fill={HEART_RED} />
      <rect x="7" y="13" width="2" height="1" fill={HEART_RED} />
      {/* Highlight (small pixel sheen, top-left) */}
      <rect x="3" y="4" width="2" height="1" fill={HEART_HIGHLIGHT} />
      <rect x="3" y="5" width="1" height="1" fill={HEART_HIGHLIGHT} />
    </svg>
  );
}

export function HeartHalf({ size = 16, ...rest }: HeartProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="none"
      {...rest}
    >
      {/* Outline (full — same as HeartFull) */}
      <rect x="2" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="1" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="14" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="2" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="13" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="3" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="11" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="5" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="10" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="6" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="7" y="14" width="2" height="1" fill={HEART_OUTLINE} />
      {/* Vertical split line down the middle */}
      <rect x="8" y="3" width="1" height="11" fill={HEART_OUTLINE} />
      {/* Red fill — LEFT HALF ONLY */}
      <rect x="2" y="4" width="5" height="4" fill={HEART_RED} />
      <rect x="3" y="8" width="5" height="2" fill={HEART_RED} />
      <rect x="4" y="10" width="4" height="1" fill={HEART_RED} />
      <rect x="5" y="11" width="3" height="1" fill={HEART_RED} />
      <rect x="6" y="12" width="2" height="1" fill={HEART_RED} />
      <rect x="7" y="13" width="1" height="1" fill={HEART_RED} />
      {/* Highlight */}
      <rect x="3" y="4" width="2" height="1" fill={HEART_HIGHLIGHT} />
      <rect x="3" y="5" width="1" height="1" fill={HEART_HIGHLIGHT} />
    </svg>
  );
}

export function HeartEmpty({ size = 16, ...rest }: HeartProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="none"
      {...rest}
    >
      {/* Outline only, no fill — same outline as HeartFull */}
      <rect x="2" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="1" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="14" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="2" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="13" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="3" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="11" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="5" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="10" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="6" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="7" y="14" width="2" height="1" fill={HEART_OUTLINE} />
    </svg>
  );
}
```

- [ ] **Step 2: Create status icons (one component per status, 16×16)**

Create `components/pixel/status-icons.tsx`. Each icon = a distinct pixel sprite. Pattern: ~16 rect elements per sprite, palette = `--accent`/`--pixel`/`--success`/`--text-dim`. Reference visual concepts:
- **Backlog** = stack of 3 small books/cartridges (tall rects stacked vertically)
- **Playing** = controller silhouette (cross + buttons in corners)
- **Completed** = trophy (cup with handles)
- **Dropped** = broken cartridge (rectangle with diagonal gap)
- **On Hold** = pause icon (two vertical bars in a circle)
- **Wishlist** = star (5-point pixel star)

Skeleton (full implementation will repeat the pattern for each):

```tsx
import type { SVGProps } from "react";
import type { LogStatus } from "@/lib/db/schema-types";

interface StatusIconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

const COLORS = {
  backlog: "#9494a8",
  playing: "#7c5cff",
  completed: "#4ade80",
  dropped: "#f87171",
  on_hold: "#fbbf24",
  wishlist: "#ffb84a",
} as const;

export function BacklogIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Stack of 3 cartridges */}
      <rect x="3" y="3" width="10" height="2" fill={COLORS.backlog} />
      <rect x="2" y="4" width="12" height="1" fill="#1a1a24" />
      <rect x="3" y="6" width="10" height="2" fill={COLORS.backlog} />
      <rect x="2" y="7" width="12" height="1" fill="#1a1a24" />
      <rect x="3" y="9" width="10" height="2" fill={COLORS.backlog} />
      <rect x="2" y="10" width="12" height="1" fill="#1a1a24" />
      <rect x="2" y="12" width="12" height="1" fill="#1a1a24" />
    </svg>
  );
}

export function PlayingIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Controller body */}
      <rect x="2" y="6" width="12" height="6" fill={COLORS.playing} />
      <rect x="3" y="5" width="10" height="1" fill={COLORS.playing} />
      <rect x="3" y="12" width="10" height="1" fill={COLORS.playing} />
      {/* D-pad cross (left) */}
      <rect x="4" y="8" width="3" height="1" fill="#fff" />
      <rect x="5" y="7" width="1" height="3" fill="#fff" />
      {/* Buttons (right) */}
      <rect x="10" y="7" width="1" height="1" fill="#fff" />
      <rect x="12" y="7" width="1" height="1" fill="#fff" />
      <rect x="10" y="9" width="1" height="1" fill="#fff" />
      <rect x="12" y="9" width="1" height="1" fill="#fff" />
    </svg>
  );
}

export function CompletedIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Trophy cup */}
      <rect x="4" y="3" width="8" height="5" fill={COLORS.completed} />
      <rect x="3" y="4" width="1" height="2" fill={COLORS.completed} />
      <rect x="12" y="4" width="1" height="2" fill={COLORS.completed} />
      <rect x="5" y="8" width="6" height="1" fill={COLORS.completed} />
      {/* Stem */}
      <rect x="7" y="9" width="2" height="2" fill={COLORS.completed} />
      {/* Base */}
      <rect x="5" y="11" width="6" height="2" fill={COLORS.completed} />
    </svg>
  );
}

export function DroppedIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Cartridge top half */}
      <rect x="3" y="4" width="6" height="4" fill={COLORS.dropped} />
      {/* Cartridge bottom half (offset to suggest break) */}
      <rect x="7" y="9" width="6" height="4" fill={COLORS.dropped} />
      {/* Crack lines */}
      <rect x="9" y="6" width="1" height="1" fill="#1a1a24" />
      <rect x="6" y="9" width="1" height="1" fill="#1a1a24" />
    </svg>
  );
}

export function OnHoldIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Pause bars in a circle */}
      <rect x="5" y="3" width="6" height="1" fill={COLORS.on_hold} />
      <rect x="3" y="5" width="1" height="6" fill={COLORS.on_hold} />
      <rect x="12" y="5" width="1" height="6" fill={COLORS.on_hold} />
      <rect x="5" y="12" width="6" height="1" fill={COLORS.on_hold} />
      <rect x="4" y="4" width="1" height="1" fill={COLORS.on_hold} />
      <rect x="11" y="4" width="1" height="1" fill={COLORS.on_hold} />
      <rect x="4" y="11" width="1" height="1" fill={COLORS.on_hold} />
      <rect x="11" y="11" width="1" height="1" fill={COLORS.on_hold} />
      {/* Two pause bars */}
      <rect x="6" y="6" width="1" height="4" fill={COLORS.on_hold} />
      <rect x="9" y="6" width="1" height="4" fill={COLORS.on_hold} />
    </svg>
  );
}

export function WishlistIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* 5-point pixel star */}
      <rect x="7" y="2" width="2" height="2" fill={COLORS.wishlist} />
      <rect x="6" y="4" width="4" height="2" fill={COLORS.wishlist} />
      <rect x="2" y="6" width="12" height="2" fill={COLORS.wishlist} />
      <rect x="3" y="8" width="10" height="2" fill={COLORS.wishlist} />
      <rect x="4" y="10" width="3" height="2" fill={COLORS.wishlist} />
      <rect x="9" y="10" width="3" height="2" fill={COLORS.wishlist} />
      <rect x="3" y="12" width="3" height="2" fill={COLORS.wishlist} />
      <rect x="10" y="12" width="3" height="2" fill={COLORS.wishlist} />
    </svg>
  );
}

// Lookup helper for dynamic rendering
export const STATUS_ICONS = {
  backlog: BacklogIcon,
  playing: PlayingIcon,
  completed: CompletedIcon,
  dropped: DroppedIcon,
  on_hold: OnHoldIcon,
  wishlist: WishlistIcon,
} as const;
```

- [ ] **Step 3: Create platform icons**

Create `components/pixel/platform-icons.tsx`. Sprites for: PC (monitor), Steam (gear-like circle), Xbox (sphere with X), PSN (Greek-letter shapes), Switch (two-controller silhouette). Same SVG `<rect>` pattern, 16×16, crispEdges. Export `PLATFORM_ICONS` lookup map keyed by lowercase platform name.

- [ ] **Step 4: Create feedback icons + spinner**

Create `components/pixel/feedback-icons.tsx`:

```tsx
export function PixelCheckmark({ size = 16, color = "#4ade80" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges">
      <rect x="2" y="8" width="2" height="2" fill={color} />
      <rect x="4" y="10" width="2" height="2" fill={color} />
      <rect x="6" y="12" width="2" height="2" fill={color} />
      <rect x="8" y="10" width="2" height="2" fill={color} />
      <rect x="10" y="8" width="2" height="2" fill={color} />
      <rect x="12" y="6" width="2" height="2" fill={color} />
      <rect x="14" y="4" width="1" height="2" fill={color} />
    </svg>
  );
}

export function PixelX({ size = 16, color = "#f87171" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges">
      <rect x="3" y="3" width="2" height="2" fill={color} />
      <rect x="5" y="5" width="2" height="2" fill={color} />
      <rect x="7" y="7" width="2" height="2" fill={color} />
      <rect x="9" y="9" width="2" height="2" fill={color} />
      <rect x="11" y="11" width="2" height="2" fill={color} />
      <rect x="11" y="3" width="2" height="2" fill={color} />
      <rect x="9" y="5" width="2" height="2" fill={color} />
      <rect x="5" y="9" width="2" height="2" fill={color} />
      <rect x="3" y="11" width="2" height="2" fill={color} />
    </svg>
  );
}

export function PixelInfo({ size = 16, color = "#7c5cff" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges">
      {/* Circle border */}
      <rect x="5" y="2" width="6" height="1" fill={color} />
      <rect x="3" y="3" width="2" height="1" fill={color} />
      <rect x="11" y="3" width="2" height="1" fill={color} />
      <rect x="2" y="4" width="1" height="2" fill={color} />
      <rect x="13" y="4" width="1" height="2" fill={color} />
      <rect x="2" y="10" width="1" height="2" fill={color} />
      <rect x="13" y="10" width="1" height="2" fill={color} />
      <rect x="3" y="12" width="2" height="1" fill={color} />
      <rect x="11" y="12" width="2" height="1" fill={color} />
      <rect x="5" y="13" width="6" height="1" fill={color} />
      {/* "i" shape */}
      <rect x="7" y="4" width="2" height="2" fill={color} />
      <rect x="7" y="7" width="2" height="4" fill={color} />
    </svg>
  );
}
```

Create `components/pixel/spinner.tsx`:

```tsx
"use client";

export function PixelSpinner({ size = 16, color = "#7c5cff" }: { size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ animation: "pixel-spin 0.8s steps(8) infinite" }}
    >
      <rect x="7" y="2" width="2" height="2" fill={color} />
      <rect x="11" y="3" width="2" height="2" fill={color} opacity="0.85" />
      <rect x="12" y="7" width="2" height="2" fill={color} opacity="0.7" />
      <rect x="11" y="11" width="2" height="2" fill={color} opacity="0.55" />
      <rect x="7" y="12" width="2" height="2" fill={color} opacity="0.4" />
      <rect x="3" y="11" width="2" height="2" fill={color} opacity="0.3" />
      <rect x="2" y="7" width="2" height="2" fill={color} opacity="0.2" />
      <rect x="3" y="3" width="2" height="2" fill={color} opacity="0.15" />
      <style>{`@keyframes pixel-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
```

- [ ] **Step 5: Barrel export**

Create `components/pixel/index.ts`:

```ts
export * from "./hearts";
export * from "./status-icons";
export * from "./platform-icons";
export * from "./feedback-icons";
export * from "./spinner";
```

- [ ] **Step 6: Build temporary scratch page for visual review**

Create `app/(app)/_scratch/pixels/page.tsx`:

```tsx
import {
  HeartFull, HeartHalf, HeartEmpty,
  BacklogIcon, PlayingIcon, CompletedIcon, DroppedIcon, OnHoldIcon, WishlistIcon,
  PixelCheckmark, PixelX, PixelInfo, PixelSpinner,
} from "@/components/pixel";

export default function ScratchPixelsPage() {
  return (
    <div className="mx-auto max-w-4xl p-8 space-y-8">
      <h1 className="text-2xl font-bold">Pixel asset scratch — DELETE BEFORE COMMIT</h1>
      <section>
        <h2 className="text-lg mb-2">Hearts (16, 24, 32)</h2>
        <div className="flex gap-4 items-end">
          {[16, 24, 32].map(s => <HeartFull key={s} size={s} />)}
          {[16, 24, 32].map(s => <HeartHalf key={s} size={s} />)}
          {[16, 24, 32].map(s => <HeartEmpty key={s} size={s} />)}
        </div>
      </section>
      <section>
        <h2 className="text-lg mb-2">Status icons</h2>
        <div className="flex gap-4 items-end">
          <BacklogIcon size={32} /><PlayingIcon size={32} /><CompletedIcon size={32} />
          <DroppedIcon size={32} /><OnHoldIcon size={32} /><WishlistIcon size={32} />
        </div>
      </section>
      <section>
        <h2 className="text-lg mb-2">Feedback + spinner</h2>
        <div className="flex gap-4 items-end">
          <PixelCheckmark size={32} /><PixelX size={32} /><PixelInfo size={32} />
          <PixelSpinner size={32} />
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Visual review + delete scratch**

```bash
pnpm dev
```

Visit `http://localhost:3000/_scratch/pixels`. Confirm: hearts look Minecraft-y, status icons are visually distinct, spinner spins. If anything looks wrong, iterate on the SVG paths.

When satisfied:

```bash
rm -rf app/\(app\)/_scratch
```

- [ ] **Step 8: Commit**

```bash
git add components/pixel/
git commit -m "Phase 1.2: pixel asset library — hearts, status icons, platform icons, feedback glyphs, spinner"
```

---

### Task 3: `<HeartRating>` component

**Goal:** Build the rating widget — 10 hearts in a row, click left/right half for 0.5 increments, hover preview, controlled + uncontrolled modes.

**Files:**
- Create: `components/ui/heart-rating.tsx`

**Acceptance Criteria:**
- [ ] 10 hearts render in a row with 2px gap
- [ ] Hovering a heart's left half previews `index + 0.5`; right half previews `index + 1`
- [ ] Click commits the previewed value
- [ ] `value` prop sets initial display; `onChange(value)` fires on click
- [ ] Keyboard accessible: arrow keys change rating in 0.5 steps
- [ ] Renders correctly for all 21 valid values (0, 0.5, 1.0, ..., 10.0)
- [ ] Disabled mode shows hearts at half opacity, no interaction

**Verify:** Add to scratch page (recreate temporarily): test all 21 values render correctly, click the 5th heart's right half → onChange fires with 5.0, hover-then-leave restores.

**Steps:**

- [ ] **Step 1: Build the component**

Create `components/ui/heart-rating.tsx`:

```tsx
"use client";

import { useState } from "react";
import { HeartFull, HeartHalf, HeartEmpty } from "@/components/pixel";
import { cn } from "@/lib/utils";

interface HeartRatingProps {
  value?: number;
  onChange?: (value: number) => void;
  size?: number;
  disabled?: boolean;
  className?: string;
}

const HEART_COUNT = 10;

export function HeartRating({
  value = 0,
  onChange,
  size = 20,
  disabled = false,
  className,
}: HeartRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  const handleClick = (heartIndex: number, half: "left" | "right") => {
    if (disabled || !onChange) return;
    const newValue = heartIndex + (half === "left" ? 0.5 : 1);
    onChange(newValue);
  };

  const handleHover = (heartIndex: number, half: "left" | "right") => {
    if (disabled) return;
    setHover(heartIndex + (half === "left" ? 0.5 : 1));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (disabled || !onChange) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(10, value + 0.5));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, value - 0.5));
    }
  };

  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={value}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKey}
      onMouseLeave={() => setHover(null)}
      className={cn(
        "inline-flex gap-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-sm p-1",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      aria-label={`Rating: ${value} of 10`}
    >
      {Array.from({ length: HEART_COUNT }, (_, i) => {
        const heartValue = i + 1;
        const isFull = display >= heartValue;
        const isHalf = !isFull && display >= heartValue - 0.5;
        const Heart = isFull ? HeartFull : isHalf ? HeartHalf : HeartEmpty;

        return (
          <span key={i} className="relative inline-flex" style={{ width: size, height: size }}>
            <Heart size={size} />
            {!disabled && (
              <>
                <button
                  type="button"
                  onClick={() => handleClick(i, "left")}
                  onMouseEnter={() => handleHover(i, "left")}
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                  aria-label={`Set rating to ${i + 0.5}`}
                  tabIndex={-1}
                />
                <button
                  type="button"
                  onClick={() => handleClick(i, "right")}
                  onMouseEnter={() => handleHover(i, "right")}
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                  aria-label={`Set rating to ${i + 1}`}
                  tabIndex={-1}
                />
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Visual + interaction verify**

Recreate `app/(app)/_scratch/heart-rating/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { HeartRating } from "@/components/ui/heart-rating";

export default function ScratchHearts() {
  const [v, setV] = useState(0);
  return (
    <div className="p-8 space-y-4">
      <p>Current value: {v}</p>
      <HeartRating value={v} onChange={setV} size={28} />
      <p>Disabled at 7.5:</p>
      <HeartRating value={7.5} disabled size={28} />
    </div>
  );
}
```

Visit `/_scratch/heart-rating`. Test:
- Click each half of each heart, confirm value updates correctly (0.5, 1, 1.5, ..., 10)
- Hover a heart far right, then move away — value resets to actual `v`
- Tab to widget, press arrow keys — value steps by 0.5
- Disabled row at 7.5 should show 7 full + 1 half + 2 empty hearts

When satisfied: `rm -rf app/(app)/_scratch`

- [ ] **Step 3: Commit**

```bash
git add components/ui/heart-rating.tsx
git commit -m "Phase 1.3: HeartRating component (10pt halves, click + keyboard + hover)"
```

---

### Task 4: `<StatusBadge>` component

**Goal:** Visual status indicator using the pixel status icons + label. Used everywhere status appears (library cards, log card, palette form, dashboard shelves).

**Files:**
- Create: `components/ui/status-badge.tsx`
- Create: `lib/db/schema-types.ts` (extracts the `LogStatus` union from Drizzle schema for clean reuse)

**Acceptance Criteria:**
- [ ] Renders an icon + label for any of the 6 statuses
- [ ] Color matches the status (greens for completed, etc.)
- [ ] Three sizes: sm (text-xs, 12px icon), md (text-sm, 16px icon), lg (text-base, 20px icon)
- [ ] Optional `iconOnly` mode for tight spaces

**Verify:** Render all 6 statuses at all 3 sizes on scratch page; visually inspect.

**Steps:**

- [ ] **Step 1: Extract type helper**

Create `lib/db/schema-types.ts`:

```ts
import type { logStatusEnum, platformKindEnum, importStatusEnum } from "./schema";

// Drizzle pgEnum doesn't directly export the union — extract it manually.
// These must stay in sync with lib/db/schema.ts enum definitions.
export type LogStatus = "backlog" | "playing" | "completed" | "dropped" | "on_hold" | "wishlist";
export type PlatformKind = "steam" | "xbox" | "psn";
export type ImportStatus = "queued" | "running" | "completed" | "failed";

export const LOG_STATUSES: LogStatus[] = [
  "backlog", "playing", "completed", "dropped", "on_hold", "wishlist",
];

export const STATUS_LABELS: Record<LogStatus, string> = {
  backlog: "Backlog",
  playing: "Playing",
  completed: "Completed",
  dropped: "Dropped",
  on_hold: "On Hold",
  wishlist: "Wishlist",
};
```

- [ ] **Step 2: Build the badge**

Create `components/ui/status-badge.tsx`:

```tsx
import { STATUS_ICONS } from "@/components/pixel";
import { STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: LogStatus;
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
  className?: string;
}

const SIZE_PX = { sm: 12, md: 16, lg: 20 };
const TEXT_CLASS = { sm: "text-xs", md: "text-sm", lg: "text-base" };

const STATUS_TEXT_COLOR: Record<LogStatus, string> = {
  backlog: "text-[#9494a8]",
  playing: "text-[#7c5cff]",
  completed: "text-[#4ade80]",
  dropped: "text-[#f87171]",
  on_hold: "text-[#fbbf24]",
  wishlist: "text-[#ffb84a]",
};

export function StatusBadge({ status, size = "md", iconOnly, className }: StatusBadgeProps) {
  const Icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        TEXT_CLASS[size],
        STATUS_TEXT_COLOR[status],
        className,
      )}
      title={STATUS_LABELS[status]}
    >
      <Icon size={SIZE_PX[size]} />
      {!iconOnly && <span className="font-medium">{STATUS_LABELS[status]}</span>}
    </span>
  );
}
```

- [ ] **Step 3: Visual verify + delete scratch**

Add temporarily to a scratch page; render every (status × size) combination. Confirm icon colors match label colors.

- [ ] **Step 4: Commit**

```bash
git add components/ui/status-badge.tsx lib/db/schema-types.ts
git commit -m "Phase 1.4: StatusBadge + LogStatus type helper"
```

---

### Task 5: `<PlatformIcon>` component

**Goal:** Render a platform's pixel icon by name (string match against RAWG platform list).

**Files:**
- Create: `components/ui/platform-icon.tsx`
- Create: `lib/games/platform-mapping.ts` (RAWG platform name → our icon key)

**Acceptance Criteria:**
- [ ] Renders the right icon for "PC", "PlayStation 5", "Xbox Series S/X", "Nintendo Switch", "Steam"
- [ ] Returns `null` for unrecognized platforms (caller decides fallback)
- [ ] Tooltip shows full platform name

**Steps:**

- [ ] **Step 1: Platform mapping**

Create `lib/games/platform-mapping.ts`:

```ts
export type PlatformKey = "pc" | "steam" | "xbox" | "playstation" | "switch";

const RAWG_TO_KEY: Array<[RegExp, PlatformKey]> = [
  [/^pc$/i, "pc"],
  [/^steam$/i, "steam"],
  [/xbox/i, "xbox"],
  [/playstation|^ps[345]/i, "playstation"],
  [/switch|nintendo/i, "switch"],
];

export function rawgPlatformToKey(name: string): PlatformKey | null {
  for (const [pattern, key] of RAWG_TO_KEY) {
    if (pattern.test(name)) return key;
  }
  return null;
}
```

- [ ] **Step 2: Build component**

Create `components/ui/platform-icon.tsx`:

```tsx
import { PLATFORM_ICONS } from "@/components/pixel";
import { rawgPlatformToKey } from "@/lib/games/platform-mapping";

export function PlatformIcon({ name, size = 16 }: { name: string; size?: number }) {
  const key = rawgPlatformToKey(name);
  if (!key) return null;
  const Icon = PLATFORM_ICONS[key];
  return <Icon size={size} aria-label={name}><title>{name}</title></Icon>;
}
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/platform-icon.tsx lib/games/platform-mapping.ts
git commit -m "Phase 1.5: PlatformIcon + RAWG platform name mapping"
```

---

### Task 6: `<EmptyState>` component (mascot + scenario copy)

**Goal:** Reusable empty-state wrapper. Mascot illustration with mood + scenario-specific copy. Used on library, filtered library, palette no-results, profile, etc.

**Files:**
- Create: `components/ui/empty-state.tsx`

**Acceptance Criteria:**
- [ ] Renders mascot at large size + heading + body text
- [ ] Mood prop sets the mascot's expression
- [ ] Optional CTA button
- [ ] Centered layout, generous whitespace

**Steps:**

- [ ] **Step 1: Build component**

Create `components/ui/empty-state.tsx`:

```tsx
import { Mascot } from "@/components/mascot/mascot";
import type { MascotMood } from "@/components/mascot/states";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  mood?: MascotMood;
  title: string;
  body?: string;
  action?: React.ReactNode;
  size?: "md" | "lg";
  className?: string;
}

export function EmptyState({
  mood = "pointing",
  title,
  body,
  action,
  size = "lg",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center gap-4",
        size === "lg" ? "py-16 px-6" : "py-8 px-4",
        className,
      )}
    >
      <Mascot size={size === "lg" ? "xl" : "lg"} mood={mood} silent />
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold text-[var(--text)]">{title}</h2>
        {body && <p className="text-sm text-[var(--text-dim)] max-w-md mx-auto">{body}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/empty-state.tsx
git commit -m "Phase 1.6: EmptyState component (mascot + title + body + CTA)"
```

---

### Task 7: RAWG client + types + KV cache layer

**Goal:** Build the entire RAWG data layer — typed fetch wrapper, Zod-validated response shapes, and KV-backed read-through cache. Server-only modules.

**Files:**
- Create: `lib/rawg/types.ts` — Zod schemas + inferred TS types
- Create: `lib/rawg/client.ts` — `rawgFetch(path, params)` wrapper
- Create: `lib/rawg/cache.ts` — `cachedSearch(q)`, `cachedGameDetail(id)`

**Acceptance Criteria:**
- [ ] `rawgFetch` adds the API key, handles 429 rate limiting (returns typed error), validates response with Zod
- [ ] `cachedSearch("hades")` returns within ~20ms on second call (KV hit)
- [ ] `cachedGameDetail(id)` returns within ~20ms on second call
- [ ] First-call latencies are network-bound (~200-500ms) and write-through to KV
- [ ] Unrecognized fields in RAWG response don't crash (Zod uses `.passthrough()` or selective parsing)

**Verify:** Build a scratch route `app/(app)/_scratch/rawg/page.tsx` that calls `cachedSearch("hades")` server-side and renders the results. Hit it twice; second hit is much faster (check Network tab or add `console.time`).

**Steps:**

- [ ] **Step 1: Define Zod types**

Create `lib/rawg/types.ts`:

```ts
import { z } from "zod";

// RAWG search result item — minimal fields we use.
export const RawgSearchItemSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  released: z.string().nullable().optional(),
  background_image: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  metacritic: z.number().nullable().optional(),
  parent_platforms: z
    .array(z.object({ platform: z.object({ name: z.string() }) }))
    .nullable()
    .optional(),
});

export const RawgSearchResponseSchema = z.object({
  count: z.number(),
  results: z.array(RawgSearchItemSchema),
});

// Game detail — richer; only fields we render.
export const RawgGameDetailSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  released: z.string().nullable().optional(),
  background_image: z.string().nullable().optional(),
  description_raw: z.string().optional(),
  rating: z.number().nullable().optional(),
  metacritic: z.number().nullable().optional(),
  playtime: z.number().optional(), // hours, RAWG average
  genres: z.array(z.object({ name: z.string() })).optional(),
  themes: z.array(z.object({ name: z.string() })).optional(),
  tags: z.array(z.object({ name: z.string() })).optional(),
  platforms: z.array(z.object({ platform: z.object({ name: z.string() }) })).optional(),
});

export const RawgScreenshotsSchema = z.object({
  results: z.array(z.object({ id: z.number(), image: z.string() })),
});

export type RawgSearchItem = z.infer<typeof RawgSearchItemSchema>;
export type RawgSearchResponse = z.infer<typeof RawgSearchResponseSchema>;
export type RawgGameDetail = z.infer<typeof RawgGameDetailSchema>;
export type RawgScreenshots = z.infer<typeof RawgScreenshotsSchema>;
```

- [ ] **Step 2: Build the fetch wrapper**

Create `lib/rawg/client.ts`:

```ts
import "server-only";
import { z } from "zod";
import { requireEnv } from "@/lib/env";

const RAWG_BASE = "https://api.rawg.io/api";

export class RawgError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "RawgError";
  }
}

interface RawgFetchOptions {
  path: string;
  params?: Record<string, string | number>;
  schema: z.ZodSchema;
  next?: { revalidate?: number };
}

export async function rawgFetch<T>({ path, params = {}, schema, next }: RawgFetchOptions): Promise<T> {
  const apiKey = requireEnv("RAWG_API_KEY");
  const url = new URL(`${RAWG_BASE}${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { next });

  if (res.status === 429) {
    throw new RawgError("RAWG rate limit hit", 429);
  }
  if (!res.ok) {
    throw new RawgError(`RAWG ${res.status}: ${res.statusText}`, res.status);
  }

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error("RAWG response shape mismatch", parsed.error.issues.slice(0, 3));
    throw new RawgError("RAWG response failed validation");
  }
  return parsed.data as T;
}
```

- [ ] **Step 3: Build the KV cache wrappers**

Create `lib/rawg/cache.ts`:

```ts
import "server-only";
import { redis } from "@/lib/cache/redis";
import { rawgFetch } from "./client";
import {
  RawgSearchResponseSchema,
  RawgGameDetailSchema,
  RawgScreenshotsSchema,
  type RawgSearchResponse,
  type RawgGameDetail,
  type RawgScreenshots,
} from "./types";

const SEARCH_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DETAIL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SCREENSHOTS_TTL_SECONDS = 60 * 60 * 24 * 7;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

export async function cachedSearch(query: string): Promise<RawgSearchResponse> {
  const key = `rawg:search:${norm(query)}`;
  const cached = await redis.get<RawgSearchResponse>(key);
  if (cached) return cached;

  const fresh = await rawgFetch<RawgSearchResponse>({
    path: "/games",
    params: { search: query, page_size: 12 },
    schema: RawgSearchResponseSchema,
  });
  await redis.set(key, fresh, { ex: SEARCH_TTL_SECONDS });
  return fresh;
}

export async function cachedGameDetail(rawgId: number): Promise<RawgGameDetail> {
  const key = `rawg:game:${rawgId}`;
  const cached = await redis.get<RawgGameDetail>(key);
  if (cached) return cached;

  const fresh = await rawgFetch<RawgGameDetail>({
    path: `/games/${rawgId}`,
    schema: RawgGameDetailSchema,
  });
  await redis.set(key, fresh, { ex: DETAIL_TTL_SECONDS });
  return fresh;
}

export async function cachedScreenshots(rawgId: number): Promise<RawgScreenshots> {
  const key = `rawg:screenshots:${rawgId}`;
  const cached = await redis.get<RawgScreenshots>(key);
  if (cached) return cached;

  const fresh = await rawgFetch<RawgScreenshots>({
    path: `/games/${rawgId}/screenshots`,
    schema: RawgScreenshotsSchema,
  });
  await redis.set(key, fresh, { ex: SCREENSHOTS_TTL_SECONDS });
  return fresh;
}

/** Bypass + refresh helpers — for admin use or tests. */
export async function invalidateGame(rawgId: number) {
  await redis.del(`rawg:game:${rawgId}`, `rawg:screenshots:${rawgId}`);
}
```

- [ ] **Step 4: Smoke test via scratch route**

Create `app/(app)/_scratch/rawg/page.tsx`:

```tsx
import { cachedSearch } from "@/lib/rawg/cache";

export default async function ScratchRawg() {
  const start = Date.now();
  const results = await cachedSearch("hades");
  const duration = Date.now() - start;
  return (
    <pre className="p-8 text-xs">
      Duration: {duration}ms
      Count: {results.count}
      Results:
      {JSON.stringify(results.results.slice(0, 3), null, 2)}
    </pre>
  );
}
```

Visit `/_scratch/rawg` twice. First load: ~200-500ms. Second load: <50ms (KV hit).

When confirmed: `rm -rf app/(app)/_scratch`.

- [ ] **Step 5: Commit**

```bash
git add lib/rawg/
git commit -m "Phase 1.7: RAWG client + Zod types + KV read-through cache"
```

---

### Task 8: Game server actions — search, detail, upsert

**Goal:** Server actions the client will call from the palette and detail page. Bridges RAWG cache → Postgres `games` upsert.

**Files:**
- Create: `lib/games/server-actions.ts`

**Acceptance Criteria:**
- [ ] `searchGames(q)` returns lightweight result shape (id, slug, name, year, cover, platforms[]) ready for typeahead
- [ ] `getGameDetail(slugOrId)` returns full game from `games` table if cached, otherwise fetches RAWG, upserts, returns
- [ ] `upsertGameFromRawg(rawg)` inserts/updates the `games` row idempotently
- [ ] All actions are `"use server"` and validated server-side

**Steps:**

- [ ] **Step 1: Build the actions**

Create `lib/games/server-actions.ts`:

```ts
"use server";

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cachedSearch, cachedGameDetail, cachedScreenshots } from "@/lib/rawg/cache";
import type { RawgGameDetail, RawgSearchItem } from "@/lib/rawg/types";

export interface SearchResult {
  rawgId: number;
  slug: string;
  title: string;
  year: number | null;
  coverUrl: string | null;
  platforms: string[];
}

const searchInput = z.object({ query: z.string().min(2).max(100) });

export async function searchGames(query: string): Promise<SearchResult[]> {
  const parsed = searchInput.safeParse({ query });
  if (!parsed.success) return [];

  const response = await cachedSearch(parsed.data.query);
  return response.results.map(toSearchResult);
}

function toSearchResult(item: RawgSearchItem): SearchResult {
  const year = item.released ? Number(item.released.slice(0, 4)) || null : null;
  const platforms = (item.parent_platforms ?? []).map((p) => p.platform.name);
  return {
    rawgId: item.id,
    slug: item.slug,
    title: item.name,
    year,
    coverUrl: item.background_image ?? null,
    platforms,
  };
}

/**
 * Fetch + cache full game detail. Returns the row from our `games` table
 * (write-through populated from RAWG if missing or stale).
 */
export async function getGameDetail(rawgId: number) {
  // Already in our DB?
  const existing = await db.query.games.findFirst({ where: eq(schema.games.id, rawgId) });
  if (existing) {
    const ageMs = Date.now() - new Date(existing.cachedAt).getTime();
    const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30d
    if (ageMs < FRESH_MS) return existing;
  }

  // Fetch fresh from RAWG (cache layer)
  const rawg = await cachedGameDetail(rawgId);
  return await upsertGameFromRawg(rawg);
}

export async function getGameDetailBySlug(slug: string) {
  const existing = await db.query.games.findFirst({ where: eq(schema.games.slug, slug) });
  if (existing) return getGameDetail(existing.id);
  // Not in DB — search RAWG by slug
  const search = await cachedSearch(slug);
  const match = search.results.find((r) => r.slug === slug);
  if (!match) throw new Error(`Game not found: ${slug}`);
  return getGameDetail(match.id);
}

export async function getScreenshots(rawgId: number): Promise<string[]> {
  const data = await cachedScreenshots(rawgId);
  return data.results.map((r) => r.image);
}

/** Insert or update the games row from a RAWG payload. */
export async function upsertGameFromRawg(rawg: RawgGameDetail) {
  const row = {
    id: rawg.id,
    slug: rawg.slug,
    title: rawg.name,
    released: rawg.released ? new Date(rawg.released) : null,
    coverUrl: rawg.background_image ?? null,
    description: rawg.description_raw ?? null,
    genres: rawg.genres?.map((g) => g.name) ?? [],
    themes: rawg.tags?.slice(0, 20).map((t) => t.name) ?? [],
    mechanics: [],
    platforms: rawg.platforms?.map((p) => p.platform.name) ?? [],
    playtimeAvgHours: rawg.playtime ? String(rawg.playtime) : null,
    metacriticScore: rawg.metacritic ?? null,
    rawgRating: rawg.rating != null ? String(rawg.rating) : null,
    cachedAt: new Date(),
  };

  await db
    .insert(schema.games)
    .values(row)
    .onConflictDoUpdate({
      target: schema.games.id,
      set: {
        title: row.title,
        released: row.released,
        coverUrl: row.coverUrl,
        description: row.description,
        genres: row.genres,
        themes: row.themes,
        platforms: row.platforms,
        playtimeAvgHours: row.playtimeAvgHours,
        metacriticScore: row.metacriticScore,
        rawgRating: row.rawgRating,
        cachedAt: row.cachedAt,
      },
    });

  return (await db.query.games.findFirst({ where: eq(schema.games.id, rawg.id) }))!;
}
```

- [ ] **Step 2: Smoke test via scratch route**

Create `app/(app)/_scratch/server-actions/page.tsx`:

```tsx
import { searchGames, getGameDetailBySlug } from "@/lib/games/server-actions";

export default async function ScratchActions() {
  const results = await searchGames("hades");
  const detail = await getGameDetailBySlug("hades");
  return (
    <pre className="p-8 text-xs">
      Search results: {results.length}
      First: {JSON.stringify(results[0], null, 2)}
      Detail (from games table): {JSON.stringify({ id: detail.id, title: detail.title, genres: detail.genres }, null, 2)}
    </pre>
  );
}
```

Visit `/_scratch/server-actions`. Confirm: results render, detail returns from DB, second visit shows DB hit (no new RAWG calls).

After: `rm -rf app/(app)/_scratch`.

- [ ] **Step 3: Commit**

```bash
git add lib/games/server-actions.ts
git commit -m "Phase 1.8: game server actions — search, detail, upsert"
```

---

# Week 4 — Cmd+K Palette + Quick-Log Flow

Goal: ship the search → log roundtrip end-to-end. By end of week 4, you can ⌘K, search, pick a game, fill the quick-log form, submit, and see a toast. The library page doesn't exist yet — but the data lands in the DB.

---

### Task 9: Header bar with `<HeaderSearchInput>` + ⌘K shortcut handler

**Goal:** Update the existing `(app)` layout's header to show the faux search input. Add a global Zustand store to track palette open state. Wire the keyboard shortcut.

**Files:**
- Modify: `app/(app)/layout.tsx` (replace the `<nav>` block, add header search input)
- Create: `components/palette/header-search-input.tsx`
- Create: `lib/palette/palette-store.ts` (Zustand store: `isOpen`, `open()`, `close()`, `toggle()`)
- Create: `components/palette/keyboard-shortcut.tsx` (client component listening for ⌘K / Ctrl+K globally)

**Acceptance Criteria:**
- [ ] Header shows: logo + faux search input ("Search games...") with ⌘K hint chip on the right + user email + logout
- [ ] Click on faux input → palette open state becomes `true` (verify via Zustand devtools or console.log)
- [ ] ⌘K (Mac) / Ctrl+K (Windows/Linux) → palette open state toggles
- [ ] Esc → palette closes
- [ ] Keyboard shortcut doesn't fire while typing in any other input

**Verify:** `pnpm dev`, sign in, click the faux search → store updates. Hit ⌘K from anywhere → store updates. The actual palette UI is task 10; for now just confirm the toggle wires up correctly via a `console.log` in the store.

**Steps:**

- [ ] **Step 1: Build the Zustand palette store**

Create `lib/palette/palette-store.ts`:

```ts
import { create } from "zustand";

type PaletteView = "search" | "quick-log";

interface PaletteState {
  isOpen: boolean;
  view: PaletteView;
  selectedGame: { rawgId: number; title: string; coverUrl: string | null } | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setView: (view: PaletteView) => void;
  selectGame: (game: PaletteState["selectedGame"]) => void;
  reset: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  isOpen: false,
  view: "search",
  selectedGame: null,
  open: () => set({ isOpen: true, view: "search" }),
  close: () => set({ isOpen: false, view: "search", selectedGame: null }),
  toggle: () =>
    set((s) => ({ isOpen: !s.isOpen, view: "search", selectedGame: s.isOpen ? null : s.selectedGame })),
  setView: (view) => set({ view }),
  selectGame: (selectedGame) => set({ selectedGame, view: "quick-log" }),
  reset: () => set({ view: "search", selectedGame: null }),
}));
```

- [ ] **Step 2: Build the header search input**

Create `components/palette/header-search-input.tsx`:

```tsx
"use client";

import { usePaletteStore } from "@/lib/palette/palette-store";

export function HeaderSearchInput() {
  const open = usePaletteStore((s) => s.open);

  return (
    <button
      type="button"
      onClick={open}
      className="group flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-faint)] transition-colors hover:border-[var(--accent-soft)] hover:text-[var(--text-dim)] w-full max-w-md"
      aria-label="Search games (Cmd+K)"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[var(--text-faint)]">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="flex-1 text-left">Search games...</span>
      <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-faint)]">
        <span>⌘</span>K
      </kbd>
    </button>
  );
}
```

- [ ] **Step 3: Build the keyboard shortcut listener**

Create `components/palette/keyboard-shortcut.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { usePaletteStore } from "@/lib/palette/palette-store";

export function PaletteKeyboardShortcut() {
  const toggle = usePaletteStore((s) => s.toggle);
  const close = usePaletteStore((s) => s.close);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't intercept ⌘K when user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Allow ⌘K from inside the palette's own input (handled separately)
        if (isTyping && !target.dataset.paletteInput) return;
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle, close]);

  return null;
}
```

- [ ] **Step 4: Update the app layout**

Edit `app/(app)/layout.tsx` — replace the `<header>...</header>` block:

```tsx
import { HeaderSearchInput } from "@/components/palette/header-search-input";
import { PaletteKeyboardShortcut } from "@/components/palette/keyboard-shortcut";
// ... other existing imports

// Inside JSX, replace the header:
<header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--bg)]/80 backdrop-blur">
  <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
    <Link href="/" className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
      <span className="font-mono text-xs tracking-[0.2em] text-[var(--pixel)]">▓ L4G ▓</span>
      <span className="hidden sm:inline text-[var(--text-dim)]">Letterboxd for Games</span>
    </Link>
    <div className="flex-1 flex justify-center">
      <HeaderSearchInput />
    </div>
    <nav className="flex items-center gap-3 text-sm whitespace-nowrap">
      <span className="hidden md:inline text-[var(--text-faint)]">{user.email}</span>
      <LogoutButton />
    </nav>
  </div>
</header>
<PaletteKeyboardShortcut />
<main className="flex-1">{children}</main>
```

(Also update Link's href from `/dashboard` to `/` in anticipation of Task 30.)

- [ ] **Step 5: Add Zustand if not present (it's already in deps from Phase 0)**

Verify with `grep zustand package.json` — should already be there.

- [ ] **Step 6: Smoke test**

```bash
pnpm dev
```

Sign in. Verify:
- Faux search input renders centered in the header
- Click → no UI change yet (palette doesn't render) but `usePaletteStore.getState().isOpen` returns `true` (check via React DevTools or temporary `console.log`)
- ⌘K toggles
- Esc closes

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/layout.tsx components/palette/ lib/palette/
git commit -m "Phase 1.9: header search bar + Cmd+K shortcut + Zustand palette store"
```

---

### Task 10: `<CommandPalette>` shell with portal + state machine

**Goal:** Render the actual palette modal — Radix-style overlay, animates in, contains the input + results scaffold. Wire it to the Zustand store. Empty/searching/results/quick-log state machine, but only the search view is filled in this task.

**Files:**
- Create: `components/palette/command-palette.tsx` — main component, uses `<Dialog>` from a headless lib OR a hand-rolled overlay
- Create: `components/palette/palette-input.tsx` — the controlled input with `data-palette-input` attribute
- Modify: `app/(app)/layout.tsx` — mount `<CommandPalette />` inside the layout

**Acceptance Criteria:**
- [ ] Opening palette renders a centered card overlay with backdrop blur
- [ ] Input is auto-focused on open
- [ ] Backdrop click closes
- [ ] Esc closes
- [ ] Animates in (~150ms scale + fade) via Framer Motion
- [ ] Renders empty-state mascot if no query, "searching..." if query has 2+ chars and TQ is fetching, results stub if data
- [ ] Component is render-tree-mounted at all times but conditionally visible

**Steps:**

- [ ] **Step 1: Build the input**

Create `components/palette/palette-input.tsx`:

```tsx
"use client";

import { forwardRef } from "react";

interface PaletteInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export const PaletteInput = forwardRef<HTMLInputElement, PaletteInputProps>(
  function PaletteInput({ value, onChange, placeholder = "Search games..." }, ref) {
    return (
      <input
        ref={ref}
        data-palette-input="true"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-transparent text-lg text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none border-none"
      />
    );
  },
);
```

- [ ] **Step 2: Build the palette shell**

Create `components/palette/command-palette.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { PaletteInput } from "./palette-input";
import { Mascot } from "@/components/mascot/mascot";

export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const view = usePaletteStore((s) => s.view);
  const close = usePaletteStore((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Auto-focus on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={close}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed left-1/2 top-[15vh] z-50 w-[92vw] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--shadow-elev)]"
            role="dialog"
            aria-modal="true"
            aria-label="Game search"
          >
            <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-5 py-4">
              <PaletteSearchIcon />
              <PaletteInput ref={inputRef} value={query} onChange={setQuery} />
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {view === "search" ? (
                <SearchView query={query} />
              ) : (
                <QuickLogView /* will be built in Task 12 */ />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PaletteSearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--text-dim)]">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Stub for now; Task 11 fills it
function SearchView({ query }: { query: string }) {
  if (query.length < 2) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="idle" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">Start typing to search.</p>
      </div>
    );
  }
  return (
    <div className="px-5 py-8 text-sm text-[var(--text-dim)]">
      [results for "{query}" wired in Task 11]
    </div>
  );
}

// Placeholder until Task 12
function QuickLogView() {
  return <div className="px-5 py-8">[quick-log form wired in Task 12]</div>;
}
```

- [ ] **Step 3: Mount in layout**

Edit `app/(app)/layout.tsx` — add `<CommandPalette />` inside the rendered tree:

```tsx
import { CommandPalette } from "@/components/palette/command-palette";
// ...

// Inside the return JSX, after <main>:
<main className="flex-1">{children}</main>
<CommandPalette />
```

- [ ] **Step 4: Smoke test**

`pnpm dev`. Sign in. Verify:
- ⌘K opens palette with input focused, scaffolded view shown
- Click backdrop closes
- Esc closes
- Type "ha" → switches to "[results for 'ha' wired in Task 11]" placeholder
- Animation smooth (~150ms in/out)

- [ ] **Step 5: Commit**

```bash
git add components/palette/command-palette.tsx components/palette/palette-input.tsx app/\(app\)/layout.tsx
git commit -m "Phase 1.10: CommandPalette shell — portal + state machine + animations"
```

---

### Task 11: Wire palette typeahead with TanStack Query → searchGames

**Goal:** Replace the SearchView stub with the real typeahead — debounced TanStack Query call to `searchGames`, results render as keyboard-navigable list with cover thumbnail + title + year + platforms. Picking a result transitions to the quick-log view.

**Files:**
- Create: `components/palette/game-search-results.tsx`
- Modify: `components/palette/command-palette.tsx` (replace `SearchView` stub)
- Create: `lib/palette/use-debounced.ts` (250ms debounce hook)

**Acceptance Criteria:**
- [ ] Typing 2+ chars triggers a TanStack Query call to `searchGames(q)` after 250ms idle
- [ ] Loading state shows mascot `thinking` mood + "Searching..."
- [ ] Empty result shows mascot `confused` + "Nothing matches. Try actual spelling?" (placeholder for mascot copy registry — task 15 finalizes)
- [ ] Results show as rows: 36×48 cover thumbnail | title bold | year + platform icons subtle | hover/keyboard highlight
- [ ] Arrow Up/Down navigates results, Enter selects, click selects
- [ ] Selected result → palette transitions to quick-log view via `selectGame()` in store

**Steps:**

- [ ] **Step 1: Debounce hook**

Create `lib/palette/use-debounced.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
```

- [ ] **Step 2: Build results component**

Create `components/palette/game-search-results.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Image from "next/image";
import { searchGames, type SearchResult } from "@/lib/games/server-actions";
import { useDebounced } from "@/lib/palette/use-debounced";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { Mascot } from "@/components/mascot/mascot";
import { PixelSpinner } from "@/components/pixel";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { cn } from "@/lib/utils";

export function GameSearchResults({ query }: { query: string }) {
  const debouncedQuery = useDebounced(query, 250);
  const selectGame = usePaletteStore((s) => s.selectGame);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["palette-search", debouncedQuery],
    queryFn: () => searchGames(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5,
  });

  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => setActiveIndex(0), [results]);

  // Keyboard navigation
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = results[activeIndex];
        if (r) selectGame({ rawgId: r.rawgId, title: r.title, coverUrl: r.coverUrl });
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, activeIndex, selectGame]);

  if (query.length < 2) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="idle" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">Start typing to search.</p>
      </div>
    );
  }

  if (isFetching) {
    return (
      <div className="px-5 py-12 text-center flex flex-col items-center gap-3">
        <PixelSpinner size={24} />
        <p className="text-sm text-[var(--text-dim)]">Searching...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="confused" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">Nothing matches. Try actual spelling?</p>
      </div>
    );
  }

  return (
    <ul className="py-2">
      {results.map((r, i) => (
        <li key={r.rawgId}>
          <button
            type="button"
            onClick={() => selectGame({ rawgId: r.rawgId, title: r.title, coverUrl: r.coverUrl })}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors",
              i === activeIndex && "bg-[var(--bg-card-hover)]",
            )}
          >
            <CoverThumb url={r.coverUrl} alt={r.title} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--text)] truncate">{r.title}</p>
              <p className="text-xs text-[var(--text-faint)] flex items-center gap-2">
                {r.year ?? "—"}
                <span className="flex gap-1">
                  {r.platforms.slice(0, 4).map((p) => (
                    <PlatformIcon key={p} name={p} size={12} />
                  ))}
                </span>
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CoverThumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="w-9 h-12 rounded bg-[var(--bg-elev)] border border-[var(--border-soft)] flex-shrink-0" />
    );
  }
  return (
    <div className="relative w-9 h-12 rounded overflow-hidden bg-[var(--bg-elev)] flex-shrink-0">
      <Image src={url} alt={alt} fill sizes="36px" className="object-cover" unoptimized />
    </div>
  );
}
```

- [ ] **Step 3: Wire into palette**

Edit `components/palette/command-palette.tsx`:
- Remove the `SearchView` stub function
- Import `GameSearchResults`
- Replace `<SearchView query={query} />` with `<GameSearchResults query={query} />`

- [ ] **Step 4: Configure next.config.ts for RAWG image domain**

If image domains aren't configured for `media.rawg.io`, add to `next.config.ts`:

```ts
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.rawg.io" },
    ],
  },
};
```

(We use `unoptimized` in the cover thumb above as a safe fallback if domain config is missing.)

- [ ] **Step 5: Smoke test**

`pnpm dev`. Sign in. ⌘K, type "hades" — confirm:
- ~250ms after typing stops, results appear
- Hades cover renders
- Arrow keys navigate; row highlights
- Click or Enter on a result → store's `selectedGame` populates, view changes to quick-log

- [ ] **Step 6: Commit**

```bash
git add components/palette/game-search-results.tsx components/palette/command-palette.tsx lib/palette/use-debounced.ts next.config.ts
git commit -m "Phase 1.11: palette typeahead — debounced TanStack Query + keyboard nav + RAWG cover thumbs"
```

---

### Task 12: `<QuickLogForm>` — status chips + heart rating + optional note

**Goal:** Build the inline quick-log form that lives inside the palette. After the user picks a search result, this view appears. Submitting fires the `createLog` server action (Task 13).

**Files:**
- Create: `components/palette/quick-log-form.tsx`
- Modify: `components/palette/command-palette.tsx` (replace `QuickLogView` stub)

**Acceptance Criteria:**
- [ ] Renders selected game's cover + title at top
- [ ] 6 status chips (Backlog/Playing/Completed/Dropped/On Hold/Wishlist) — click to select
- [ ] HeartRating widget (`<HeartRating>` from Task 3)
- [ ] Optional one-line note input (max 200 chars)
- [ ] Submit + Cancel buttons
- [ ] Submit calls `createLog` server action (placeholder until Task 13 — log to console for now)
- [ ] Cancel returns to search view

**Steps:**

- [ ] **Step 1: Build the form**

Create `components/palette/quick-log-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { HeartRating } from "@/components/ui/heart-rating";
import { STATUS_ICONS } from "@/components/pixel";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<LogStatus, string> = {
  backlog: "border-[#9494a8] text-[#9494a8]",
  playing: "border-[#7c5cff] text-[#7c5cff]",
  completed: "border-[#4ade80] text-[#4ade80]",
  dropped: "border-[#f87171] text-[#f87171]",
  on_hold: "border-[#fbbf24] text-[#fbbf24]",
  wishlist: "border-[#ffb84a] text-[#ffb84a]",
};

export function QuickLogForm() {
  const selectedGame = usePaletteStore((s) => s.selectedGame);
  const reset = usePaletteStore((s) => s.reset);
  const close = usePaletteStore((s) => s.close);
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!selectedGame) return null;

  function handleSubmit() {
    if (!status) {
      setError("Pick a status first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // TASK 13 will replace this with the actual server action call
      // For now, log + close
      console.log("[quick-log] would submit:", { selectedGame, status, rating, note });
      close();
    });
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {/* Selected game preview */}
      <div className="flex items-center gap-3">
        {selectedGame.coverUrl ? (
          <div className="relative w-12 h-16 rounded overflow-hidden bg-[var(--bg-elev)]">
            <Image
              src={selectedGame.coverUrl}
              alt={selectedGame.title}
              fill
              sizes="48px"
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="w-12 h-16 rounded bg-[var(--bg-elev)] border border-[var(--border-soft)]" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[var(--text)] truncate">{selectedGame.title}</p>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors"
          >
            ← Change game
          </button>
        </div>
      </div>

      {/* Status chips */}
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">Status</p>
        <div className="grid grid-cols-3 gap-2">
          {LOG_STATUSES.map((s) => {
            const Icon = STATUS_ICONS[s];
            const isActive = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-all",
                  isActive
                    ? `${STATUS_COLORS[s]} bg-[var(--bg-elev)]`
                    : "border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-soft)]",
                )}
              >
                <Icon size={14} />
                {STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rating */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Rating</p>
          <span className="text-sm font-mono text-[var(--text-dim)]">
            {rating > 0 ? `${rating} / 10` : "—"}
          </span>
        </div>
        <HeartRating value={rating} onChange={setRating} size={22} />
      </div>

      {/* Note */}
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">
          One-line thought (optional)
        </p>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="loved the soundtrack..."
          className="w-full bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-md px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent-soft)]"
        />
      </div>

      {/* Error */}
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-soft)]">
        <Button variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={pending || !status}>
          {pending ? "Logging..." : "Log it"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into palette**

In `components/palette/command-palette.tsx`:
- Remove the `QuickLogView` stub
- Import `QuickLogForm` and use it in place of `<QuickLogView />`

- [ ] **Step 3: Smoke test**

`pnpm dev`, sign in, ⌘K, search "hades", pick result. Verify:
- Quick-log form appears with cover + title
- Click status chips — only one selected at a time, color matches status
- Click hearts to set rating, current value shows in upper right
- Type a note
- Submit logs to console with `{ selectedGame, status, rating, note }`
- Cancel closes palette
- "← Change game" returns to search view

- [ ] **Step 4: Commit**

```bash
git add components/palette/quick-log-form.tsx components/palette/command-palette.tsx
git commit -m "Phase 1.12: QuickLogForm — status chips + heart rating + note (server action wired in next task)"
```

---

### Task 13: `createLog` server action — Drizzle insert + game upsert

**Goal:** Wire the actual log creation. Server action validates input, upserts the game row from RAWG if needed, inserts the log row owned by the current user. Returns the new log id.

**Files:**
- Create: `lib/logs/server-actions.ts`
- Modify: `components/palette/quick-log-form.tsx` (replace `console.log` with action call)

**Acceptance Criteria:**
- [ ] `createLog` validates: rawgId is positive int, status is in enum, rating is 0-10 in 0.5 steps, note is ≤200 chars
- [ ] Authenticated check: pulls user via `createSupabaseServerClient`; throws if no user
- [ ] Idempotently upserts the game (calls `getGameDetail` from Task 8)
- [ ] Inserts a `logs` row with `user_id = auth user`, status, rating (or null if 0), notes (or null if empty)
- [ ] Unique constraint on `(user_id, game_id, is_replay)` — if a log already exists with `is_replay=false`, return error "Already logged. Edit existing log instead."
- [ ] Returns `{ logId: string, gameSlug: string }` on success

**Steps:**

- [ ] **Step 1: Build the action**

Create `lib/logs/server-actions.ts`:

```ts
"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGameDetail } from "@/lib/games/server-actions";
import { LOG_STATUSES } from "@/lib/db/schema-types";

const createLogInput = z.object({
  rawgId: z.number().int().positive(),
  status: z.enum(LOG_STATUSES as [typeof LOG_STATUSES[number], ...typeof LOG_STATUSES[number][]]),
  rating: z
    .number()
    .min(0)
    .max(10)
    .refine((v) => v * 2 === Math.round(v * 2), "Rating must be in 0.5 steps")
    .optional(),
  note: z.string().max(200).optional(),
});

export type CreateLogResult =
  | { ok: true; logId: string; gameSlug: string }
  | { ok: false; error: string };

export async function createLog(input: unknown): Promise<CreateLogResult> {
  const parsed = createLogInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { rawgId, status, rating, note } = parsed.data;

  // Auth check
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Ensure the game exists in our DB (write-through cache)
  const game = await getGameDetail(rawgId);

  // Check for existing non-replay log on this game
  const existing = await db.query.logs.findFirst({
    where: and(
      eq(schema.logs.userId, user.id),
      eq(schema.logs.gameId, game.id),
      eq(schema.logs.isReplay, false),
    ),
  });
  if (existing) {
    return { ok: false, error: "Already logged. Edit the existing log instead." };
  }

  const [inserted] = await db
    .insert(schema.logs)
    .values({
      userId: user.id,
      gameId: game.id,
      status,
      rating: rating && rating > 0 ? String(rating) : null,
      notes: note?.trim() || null,
    })
    .returning({ id: schema.logs.id });

  return { ok: true, logId: inserted.id, gameSlug: game.slug };
}
```

- [ ] **Step 2: Wire into the form**

Edit `components/palette/quick-log-form.tsx` — replace the placeholder submit body:

```tsx
import { createLog } from "@/lib/logs/server-actions";
import { useQueryClient } from "@tanstack/react-query";
// ... add at top of QuickLogForm function:
const queryClient = useQueryClient();

// Replace handleSubmit body:
function handleSubmit() {
  if (!status) {
    setError("Pick a status first.");
    return;
  }
  setError(null);
  startTransition(async () => {
    const result = await createLog({
      rawgId: selectedGame!.rawgId,
      status,
      rating,
      note,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Invalidate library + dashboard queries so they refetch
    queryClient.invalidateQueries({ queryKey: ["library"] });
    queryClient.invalidateQueries({ queryKey: ["status-shelf"] });
    queryClient.invalidateQueries({ queryKey: ["recent-activity"] });
    close();
  });
}
```

- [ ] **Step 3: Smoke test**

`pnpm dev`, sign in. ⌘K, search "hades", pick it, choose Completed, set 9 hearts, submit. Verify:
- Palette closes
- No console errors
- Run in Supabase SQL editor: `SELECT * FROM public.logs ORDER BY created_at DESC LIMIT 1;` — confirm a row exists with your user_id, the right game_id, status='completed', rating='9.0'
- `SELECT * FROM public.games WHERE slug='hades';` — confirm Hades was upserted

Try logging Hades again → should get "Already logged" error.

- [ ] **Step 4: Commit**

```bash
git add lib/logs/server-actions.ts components/palette/quick-log-form.tsx
git commit -m "Phase 1.13: createLog server action + wire into QuickLogForm"
```

---

### Task 14: Toast confirmation + mascot celebration

**Goal:** When a log succeeds, fire a toast with the custom pixel checkmark and trigger the mascot's `celebrating` mood briefly. The toast is the user's primary success feedback; the mascot is the delight moment.

**Files:**
- Modify: `components/palette/quick-log-form.tsx` (add toast call + mascot mood trigger)
- Modify: `components/mascot/mascot-store.ts` (verify `setMood` + `celebrate` helpers exist; add if not)
- Create: `components/ui/log-success-toast.tsx` (custom toast content with pixel checkmark)

**Acceptance Criteria:**
- [ ] On successful log, sonner shows a toast with the pixel checkmark + game title + status: "Hades logged as Completed"
- [ ] Mascot store's mood briefly switches to `celebrating` for 1.5s, then returns to `idle`
- [ ] No emoji in the toast text or icon

**Steps:**

- [ ] **Step 1: Verify mascot store has celebrate helper**

Read `components/mascot/mascot-store.ts`. If it doesn't have a `celebrate(message?)` method, add one:

```ts
// Inside the store create:
celebrate: (message?: string) => {
  set({ state: { mood: "celebrating", message, durationMs: 1500 } });
  setTimeout(() => set({ state: DEFAULT_MASCOT_STATE }), 1500);
},
```

- [ ] **Step 2: Build the custom toast component**

Create `components/ui/log-success-toast.tsx`:

```tsx
import { PixelCheckmark } from "@/components/pixel";
import { STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";

export function LogSuccessToast({ title, status }: { title: string; status: LogStatus }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <PixelCheckmark size={20} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)] truncate">{title}</p>
        <p className="text-xs text-[var(--text-dim)]">Logged as {STATUS_LABELS[status]}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the form**

Edit `components/palette/quick-log-form.tsx`:

```tsx
import { toast } from "sonner";
import { LogSuccessToast } from "@/components/ui/log-success-toast";
import { useMascotStore } from "@/components/mascot/mascot-store";

// Inside QuickLogForm:
const celebrate = useMascotStore((s) => s.celebrate);

// Inside handleSubmit, after queryClient.invalidateQueries calls but BEFORE close():
toast.custom(() => <LogSuccessToast title={selectedGame!.title} status={status!} />, {
  duration: 3500,
});
celebrate();
close();
```

- [ ] **Step 4: Smoke test**

Sign in, ⌘K, search a game (try one you haven't logged yet — if Hades is already logged, search "Outer Wilds"). Log it. Verify:
- Toast appears bottom-right with pixel checkmark + title + "Logged as Completed"
- Mascot anywhere on screen briefly celebrates (if no mascot visible, you'll see this in Task 27 with the dashboard)
- No emojis anywhere in the success path

- [ ] **Step 5: Commit**

```bash
git add components/palette/quick-log-form.tsx components/mascot/mascot-store.ts components/ui/log-success-toast.tsx
git commit -m "Phase 1.14: log success toast (pixel checkmark) + mascot celebration trigger"
```

---

### Task 15: Initialize `lib/mascot/copy.ts` with starter strings + variant picker

**Goal:** Set up the mascot copy registry with the structure that all subsequent mascot moments will plug into. Author the first batch of strings (palette empty/searching/no-results/log-success). Full copy authoring happens in Task 32 at end of phase.

**Files:**
- Create: `lib/mascot/copy.ts`
- Create: `lib/mascot/scenarios.ts` (typed scenario keys)

**Acceptance Criteria:**
- [ ] `copy(scenario, context?)` returns one of N variants for the scenario
- [ ] Variants picked deterministically by hash(date + scenario) — same day = same line
- [ ] Type-safe: TypeScript errors if you reference a scenario that doesn't exist
- [ ] At least 8 scenarios filled with 3+ variants each (palette/log/empty starters)

**Steps:**

- [ ] **Step 1: Define scenarios**

Create `lib/mascot/scenarios.ts`:

```ts
export type MascotScenario =
  // Palette
  | "palette.idle"
  | "palette.no-results"
  | "palette.searching"
  // Log
  | "log.success.completed-high" // rating >= 8.5
  | "log.success.completed-mid" // rating 5-8
  | "log.success.completed-low" // rating < 5
  | "log.success.playing"
  | "log.success.backlog"
  | "log.success.wishlist"
  | "log.success.dropped"
  | "log.success.on_hold"
  // Empty states
  | "library.empty.all"
  | "library.empty.playing"
  | "library.empty.completed"
  | "library.empty.backlog"
  | "library.empty.wishlist"
  | "library.empty.dropped"
  | "library.empty.on_hold"
  // Dashboard
  | "dashboard.greeting.morning"
  | "dashboard.greeting.afternoon"
  | "dashboard.greeting.evening"
  | "dashboard.greeting.night"
  | "dashboard.greeting.long-absence" // 7+ days since last log
  | "dashboard.greeting.actively-playing" // has games in playing
  // Errors
  | "error.404"
  | "error.500"
  | "error.rate-limited";
```

- [ ] **Step 2: Build the copy registry**

Create `lib/mascot/copy.ts`:

```ts
import type { MascotScenario } from "./scenarios";

type CopyContext = Record<string, string | number | undefined>;

const COPY: Record<MascotScenario, string[]> = {
  // === Palette ===
  "palette.idle": ["Start typing to search.", "What are we logging today?", "I'll wait."],
  "palette.no-results": [
    "Nothing matches. Try actual spelling?",
    "No hits. RAWG hasn't heard of it.",
    "Empty. The search engine, not your taste.",
  ],
  "palette.searching": ["Searching...", "Looking...", "Hold on."],

  // === Log success ===
  "log.success.completed-high": [
    "{rating} hearts. That's basically a marriage proposal.",
    "{rating} hearts on {title}. Bold endorsement.",
    "Logged. {title} clearly hit.",
  ],
  "log.success.completed-mid": [
    "Logged. Solid pick.",
    "{title} — fair rating.",
    "Logged. Mid-tier banger.",
  ],
  "log.success.completed-low": [
    "Logged. Closure achieved.",
    "Done is done.",
    "{title} survived. So did you.",
  ],
  "log.success.playing": [
    "On the docket.",
    "Currently playing: noted.",
    "Good luck out there.",
  ],
  "log.success.backlog": [
    "Backlog +1. Bold.",
    "Added to The Pile.",
    "Maybe someday.",
  ],
  "log.success.wishlist": [
    "Wishlisted. Sale notifications coming for your wallet.",
    "Saved for later. Like a tab.",
    "Wishlist +1.",
  ],
  "log.success.dropped": ["Marked dropped. No shame.", "Cut your losses.", "Moving on."],
  "log.success.on_hold": ["Paused. We'll see.", "On the shelf.", "Maybe later."],

  // === Empty states (placeholders — finalized in Task 32) ===
  "library.empty.all": [
    "Empty shelf. The classic 'I'll start tomorrow' move.",
    "Nothing logged yet. Let's fix that.",
  ],
  "library.empty.playing": ["Nothing actively playing.", "No active runs.", "Free time?"],
  "library.empty.completed": ["No finishes yet. The journey is the reward, etc.", "Zero completions."],
  "library.empty.backlog": ["No backlog. Suspicious.", "Empty backlog. Either a lie or a flex."],
  "library.empty.wishlist": [
    "No wishlisted games. You're either disciplined or in denial.",
    "Wishlist empty.",
  ],
  "library.empty.dropped": ["Nothing dropped. Yet.", "No dropped games. Stay strong."],
  "library.empty.on_hold": ["Nothing paused.", "No games on hold."],

  // === Dashboard greetings (placeholder — Task 27 expands) ===
  "dashboard.greeting.morning": ["Morning.", "Up early.", "Coffee first."],
  "dashboard.greeting.afternoon": ["Afternoon.", "How's the day?", "Welcome back."],
  "dashboard.greeting.evening": ["Evening.", "Logging hours, I see.", "Welcome back."],
  "dashboard.greeting.night": ["Late one tonight.", "Bedtime soon?", "Just one more."],
  "dashboard.greeting.long-absence": [
    "Been a while. Welcome back.",
    "It's been {days} days. We missed you.",
  ],
  "dashboard.greeting.actively-playing": [
    "Still on {title}? Respect.",
    "{days} days into {title} — close to finishing?",
  ],

  // === Errors ===
  "error.404": ["This game doesn't exist. Or maybe you do.", "404. Try a different URL."],
  "error.500": ["Something broke. Not your fault. Probably.", "500. Refresh, maybe?"],
  "error.rate-limited": [
    "RAWG is napping. Try in a minute.",
    "Slow down — we're rate-limited.",
  ],
};

/** Deterministic hash so the same scenario picks the same variant within a day. */
function hashDay(scenario: string): number {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let h = 0;
  const s = day + scenario;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function interpolate(line: string, ctx?: CopyContext): string {
  if (!ctx) return line;
  return line.replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

export function copy(scenario: MascotScenario, ctx?: CopyContext): string {
  const variants = COPY[scenario];
  if (!variants || variants.length === 0) return "";
  const idx = hashDay(scenario) % variants.length;
  return interpolate(variants[idx], ctx);
}

/** Helper: pick the right log success scenario from status + rating. */
export function logSuccessCopy(status: string, rating: number, title: string): string {
  const ctx: CopyContext = { title, rating };
  if (status === "completed") {
    if (rating >= 8.5) return copy("log.success.completed-high", ctx);
    if (rating >= 5) return copy("log.success.completed-mid", ctx);
    return copy("log.success.completed-low", ctx);
  }
  return copy(`log.success.${status}` as MascotScenario, ctx);
}
```

- [ ] **Step 3: Wire into existing components that have placeholder copy**

Edit `components/palette/game-search-results.tsx`:
- Replace `"Start typing to search."` with `{copy("palette.idle")}`
- Replace `"Searching..."` with `{copy("palette.searching")}`
- Replace `"Nothing matches. Try actual spelling?"` with `{copy("palette.no-results")}`

Edit `components/palette/quick-log-form.tsx`:
- After log success, also include the mascot's reaction in the toast OR pass to `celebrate(message)`:

```tsx
const message = logSuccessCopy(status!, rating, selectedGame!.title);
toast.custom(() => <LogSuccessToast title={selectedGame!.title} status={status!} />, {
  duration: 3500,
});
celebrate(message);
```

- [ ] **Step 4: Smoke test**

Trigger each scenario:
- Open palette, type 1 char → "Start typing to search." (or one of the variants)
- Type "asdfghjkl" → no-results variant
- Log a game → mascot celebrates with status-appropriate copy

- [ ] **Step 5: Commit**

```bash
git add lib/mascot/ components/palette/game-search-results.tsx components/palette/quick-log-form.tsx
git commit -m "Phase 1.15: mascot copy registry — scenarios + variant picker + first batch of strings"
```

---

# Week 5 — Library Page + Game Detail

Goal: build the library page with all three views, the game detail page (full route + intercepted panel), and tactile FLIP transitions for status changes. By end of week 5, you can browse, filter, sort, click into details, and edit logs.

---

### Task 16: Library server actions — `getUserLibrary`, `updateLogStatus`, `deleteLog`

**Goal:** Read/mutate API for the library page.

**Files:**
- Modify: `lib/logs/server-actions.ts` (append actions)

**Acceptance Criteria:**
- [ ] `getUserLibrary(filters)` returns `{ log + game }` joined rows for the current user, optionally filtered by status, sorted by chosen field
- [ ] `updateLogStatus(logId, newStatus)` updates status, throws if log isn't owned by user
- [ ] `deleteLog(logId)` removes the log, throws if not owned

**Steps:**

- [ ] **Step 1: Append actions**

Edit `lib/logs/server-actions.ts` — add at the bottom:

```ts
import { desc, asc, sql } from "drizzle-orm";
import type { LogStatus } from "@/lib/db/schema-types";

export interface LibraryItem {
  logId: string;
  status: LogStatus;
  rating: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  hoursPlayed: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  game: {
    id: number;
    slug: string;
    title: string;
    coverUrl: string | null;
    released: Date | null;
    genres: string[] | null;
    platforms: string[] | null;
  };
}

export type SortKey = "rating-desc" | "rating-asc" | "recent" | "title-asc" | "released-desc";

interface GetLibraryArgs {
  status?: LogStatus | "all";
  sort?: SortKey;
}

export async function getUserLibrary(args: GetLibraryArgs = {}): Promise<LibraryItem[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const orderBy = (() => {
    switch (args.sort) {
      case "rating-asc":
        return asc(schema.logs.rating);
      case "rating-desc":
        return desc(schema.logs.rating);
      case "title-asc":
        return asc(schema.games.title);
      case "released-desc":
        return desc(schema.games.released);
      case "recent":
      default:
        return desc(schema.logs.updatedAt);
    }
  })();

  const rows = await db
    .select({
      logId: schema.logs.id,
      status: schema.logs.status,
      rating: schema.logs.rating,
      startedAt: schema.logs.startedAt,
      finishedAt: schema.logs.finishedAt,
      hoursPlayed: schema.logs.hoursPlayed,
      notes: schema.logs.notes,
      createdAt: schema.logs.createdAt,
      updatedAt: schema.logs.updatedAt,
      game_id: schema.games.id,
      game_slug: schema.games.slug,
      game_title: schema.games.title,
      game_coverUrl: schema.games.coverUrl,
      game_released: schema.games.released,
      game_genres: schema.games.genres,
      game_platforms: schema.games.platforms,
    })
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(
      and(
        eq(schema.logs.userId, user.id),
        args.status && args.status !== "all" ? eq(schema.logs.status, args.status) : undefined,
      ),
    )
    .orderBy(orderBy);

  return rows.map((r) => ({
    logId: r.logId,
    status: r.status as LogStatus,
    rating: r.rating ? Number(r.rating) : null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    hoursPlayed: r.hoursPlayed ? Number(r.hoursPlayed) : null,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    game: {
      id: r.game_id,
      slug: r.game_slug,
      title: r.game_title,
      coverUrl: r.game_coverUrl,
      released: r.game_released,
      genres: r.game_genres ?? [],
      platforms: r.game_platforms ?? [],
    },
  }));
}

const updateStatusInput = z.object({
  logId: z.string().uuid(),
  status: z.enum(LOG_STATUSES as [LogStatus, ...LogStatus[]]),
});

export async function updateLogStatus(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = updateStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await db
    .update(schema.logs)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(schema.logs.id, parsed.data.logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  return { ok: true };
}

export async function deleteLog(logId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await db
    .delete(schema.logs)
    .where(and(eq(schema.logs.id, logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  return { ok: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/logs/server-actions.ts
git commit -m "Phase 1.16: library server actions — getUserLibrary + updateLogStatus + deleteLog"
```

---

### Task 17: `<FilterChips>` and `<SortDropdown>` components

**Goal:** Pixel-styled status filter chips and a sort dropdown. Drive URL state via Next.js `useSearchParams`.

**Files:**
- Create: `components/library/filter-chips.tsx`
- Create: `components/library/sort-dropdown.tsx`

**Acceptance Criteria:**
- [ ] FilterChips: 7 chips (All + 6 statuses) with pixel-art "sticky note" styling (slight rotation, dashed border, status color when active)
- [ ] Selecting a chip updates `?status=playing` in the URL via `router.replace`
- [ ] SortDropdown: 5 options (recent, rating-desc, rating-asc, title-asc, released-desc) → updates `?sort=...`
- [ ] Both components are client components and read from `useSearchParams`

**Steps:**

- [ ] **Step 1: FilterChips**

Create `components/library/filter-chips.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { STATUS_ICONS } from "@/components/pixel";
import { cn } from "@/lib/utils";

const STATUS_BORDER: Record<LogStatus | "all", string> = {
  all: "border-[var(--text-dim)] text-[var(--text)]",
  backlog: "border-[#9494a8] text-[#9494a8]",
  playing: "border-[#7c5cff] text-[#7c5cff]",
  completed: "border-[#4ade80] text-[#4ade80]",
  dropped: "border-[#f87171] text-[#f87171]",
  on_hold: "border-[#fbbf24] text-[#fbbf24]",
  wishlist: "border-[#ffb84a] text-[#ffb84a]",
};

const ROTATIONS = ["-rotate-1", "rotate-1", "-rotate-[0.5deg]", "rotate-[0.5deg]"];

export function FilterChips() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get("status") ?? "all") as LogStatus | "all";

  function setStatus(s: LogStatus | "all") {
    const next = new URLSearchParams(params);
    if (s === "all") next.delete("status");
    else next.set("status", s);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const allChips: Array<LogStatus | "all"> = ["all", ...LOG_STATUSES];

  return (
    <div className="flex flex-wrap gap-2">
      {allChips.map((s, i) => {
        const isActive = current === s;
        const Icon = s === "all" ? null : STATUS_ICONS[s];
        return (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border-2 border-dashed px-3 py-1.5 text-xs font-medium transition-all",
              ROTATIONS[i % ROTATIONS.length],
              isActive
                ? `${STATUS_BORDER[s]} bg-[var(--bg-card)] shadow-[var(--shadow-card)]`
                : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-soft)] hover:text-[var(--text-dim)]",
            )}
          >
            {Icon && <Icon size={12} />}
            {s === "all" ? "All" : STATUS_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: SortDropdown**

Create `components/library/sort-dropdown.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { SortKey } from "@/lib/logs/server-actions";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently updated",
  "rating-desc": "Highest rated",
  "rating-asc": "Lowest rated",
  "title-asc": "Title (A-Z)",
  "released-desc": "Newest released",
};

export function SortDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get("sort") ?? "recent") as SortKey;

  function setSort(s: SortKey) {
    const next = new URLSearchParams(params);
    if (s === "recent") next.delete("sort");
    else next.set("sort", s);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <select
      value={current}
      onChange={(e) => setSort(e.target.value as SortKey)}
      className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md px-3 py-1.5 text-sm text-[var(--text-dim)] focus:border-[var(--accent-soft)] outline-none"
    >
      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
        <option key={k} value={k}>
          {SORT_LABELS[k]}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/library/filter-chips.tsx components/library/sort-dropdown.tsx
git commit -m "Phase 1.17: FilterChips (pixel sticky-notes) + SortDropdown"
```

---

### Task 18: `<ShelfFrame>` pixel-art shelf wrapper

**Goal:** The signature visual treatment for the library — a pixel-art wooden shelf graphic that frames the poster grid.

**Files:**
- Create: `components/pixel/shelf-frame.tsx`

**Acceptance Criteria:**
- [ ] Renders a wooden plank graphic at top + bottom of the wrapped content
- [ ] Mascot peeks from one corner (small, `idle` mood, silent)
- [ ] Children render in a centered area between the planks
- [ ] Looks intentional even on different screen widths (planks scale)

**Steps:**

- [ ] **Step 1: Build the frame**

Create `components/pixel/shelf-frame.tsx`:

```tsx
import { Mascot } from "@/components/mascot/mascot";
import { cn } from "@/lib/utils";

export function ShelfFrame({
  children,
  className,
  showMascot = true,
}: {
  children: React.ReactNode;
  className?: string;
  showMascot?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <ShelfPlank position="top" />
      <div className="px-2 py-6 sm:px-4">{children}</div>
      <ShelfPlank position="bottom" />
      {showMascot && (
        <div className="absolute -top-12 right-2 sm:right-6 pointer-events-none select-none">
          <Mascot size="sm" mood="idle" silent />
        </div>
      )}
    </div>
  );
}

function ShelfPlank({ position }: { position: "top" | "bottom" }) {
  const isTop = position === "top";
  return (
    <div
      className="relative h-3 w-full overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, #8b4513 0 4px, #6b3410 4px 8px, #8b4513 8px 12px, #5a2d0c 12px 16px)",
        boxShadow: isTop
          ? "inset 0 -2px 0 #3d1f08, 0 2px 0 #3d1f08"
          : "inset 0 2px 0 #3d1f08, 0 -2px 0 #3d1f08",
      }}
      aria-hidden
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pixel/shelf-frame.tsx
git commit -m "Phase 1.18: ShelfFrame — pixel-art wooden shelf wrapper for library wall"
```

---

### Task 19: `<LibraryGrid>` (poster wall view)

**Goal:** The default library view — Letterboxd-style small-poster wall. Hover overlay shows rating + status. Each poster links to game detail.

**Files:**
- Create: `components/library/library-grid.tsx`
- Create: `components/library/library-poster.tsx`

**Acceptance Criteria:**
- [ ] Posters at ~140px wide, 6-8 per row at desktop, 3-4 at tablet, 2 at mobile (CSS grid with `repeat(auto-fill, minmax(...))`)
- [ ] Each poster: cover image, hover overlay with status badge + heart count
- [ ] Click → navigates to `/games/[slug]` (will be intercepted in Task 26)
- [ ] Empty input renders `<EmptyState>` with status-specific mascot copy

**Steps:**

- [ ] **Step 1: Build poster card**

Create `components/library/library-poster.tsx`:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartFull } from "@/components/pixel";

export function LibraryPoster({ item }: { item: LibraryItem }) {
  return (
    <motion.div
      layout
      layoutId={`poster-${item.logId}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group relative aspect-[2/3] w-full overflow-hidden rounded-md bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
    >
      <Link href={`/games/${item.game.slug}`} className="block w-full h-full">
        {item.game.coverUrl ? (
          <Image
            src={item.game.coverUrl}
            alt={item.game.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 140px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-[var(--text-faint)] p-2 text-center">
            {item.game.title}
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1">
          <p className="text-xs font-semibold text-white truncate">{item.game.title}</p>
          <div className="flex items-center justify-between">
            <StatusBadge status={item.status} size="sm" iconOnly />
            {item.rating != null && (
              <span className="flex items-center gap-1 text-xs font-mono text-white">
                <HeartFull size={10} />
                {item.rating}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
```

- [ ] **Step 2: Build the grid**

Create `components/library/library-grid.tsx`:

```tsx
"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { LibraryPoster } from "./library-poster";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import type { LogStatus } from "@/lib/db/schema-types";

interface Props {
  items: LibraryItem[];
  filter: LogStatus | "all";
}

export function LibraryGrid({ items, filter }: Props) {
  if (items.length === 0) {
    const scenarioKey =
      filter === "all" ? "library.empty.all" : (`library.empty.${filter}` as const);
    return (
      <EmptyState
        mood={filter === "all" ? "pointing" : "confused"}
        title={copy(scenarioKey)}
        body={filter === "all" ? "Press ⌘K to log your first game." : undefined}
      />
    );
  }

  return (
    <motion.div
      layout
      className="grid gap-3"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
      }}
    >
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <LibraryPoster key={item.logId} item={item} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/library/library-grid.tsx components/library/library-poster.tsx
git commit -m "Phase 1.19: LibraryGrid — poster wall + hover overlay + FLIP-ready layoutId"
```

---

### Task 20: `<LibraryList>` (info-dense list view)

**Goal:** Alternative library view — info-dense rows with cover thumbnail + title + hearts + status + dates + hours.

**Files:**
- Create: `components/library/library-list.tsx`

**Acceptance Criteria:**
- [ ] Each row: 60×80 cover thumbnail | title bold | rating (hearts inline) | status badge | finished date | hours played
- [ ] Mobile: stacks vertically (cover left, info right wraps)
- [ ] Empty state same as grid (reuse `EmptyState`)

**Steps:**

- [ ] **Step 1: Build the list**

Create `components/library/library-list.tsx`:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartRating } from "@/components/ui/heart-rating";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import type { LogStatus } from "@/lib/db/schema-types";

interface Props {
  items: LibraryItem[];
  filter: LogStatus | "all";
}

export function LibraryList({ items, filter }: Props) {
  if (items.length === 0) {
    const scenarioKey =
      filter === "all" ? "library.empty.all" : (`library.empty.${filter}` as const);
    return <EmptyState mood="pointing" title={copy(scenarioKey)} />;
  }

  return (
    <ul className="divide-y divide-[var(--border-soft)] rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)]">
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <motion.li
            key={item.logId}
            layout
            layoutId={`list-${item.logId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Link
              href={`/games/${item.game.slug}`}
              className="flex items-center gap-4 p-3 hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              <div className="relative w-12 h-16 rounded overflow-hidden bg-[var(--bg-elev)] flex-shrink-0">
                {item.game.coverUrl && (
                  <Image
                    src={item.game.coverUrl}
                    alt={item.game.title}
                    fill
                    sizes="48px"
                    className="object-cover"
                    unoptimized
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--text)] truncate">{item.game.title}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-faint)]">
                  <StatusBadge status={item.status} size="sm" />
                  {item.rating != null && <HeartRating value={item.rating} disabled size={10} />}
                  {item.finishedAt && (
                    <span>Finished {new Date(item.finishedAt).toLocaleDateString()}</span>
                  )}
                  {item.hoursPlayed != null && <span>{item.hoursPlayed}h</span>}
                </div>
              </div>
            </Link>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/library/library-list.tsx
git commit -m "Phase 1.20: LibraryList — info-dense rows with cover, hearts, status, dates, hours"
```

---

### Task 21: `<StatusShelf>` (horizontal carousels per status)

**Goal:** The "cockpit" view — horizontal carousels grouped by status (Playing, Up Next/Backlog, Recently Completed, Wishlist). Reused on both library page (as a view toggle) AND dashboard (as the hero).

**Files:**
- Create: `components/library/status-shelf.tsx`

**Acceptance Criteria:**
- [ ] Renders 4 horizontal carousels in this order: Playing, Backlog (titled "Up Next"), Completed (titled "Recently Completed"), Wishlist
- [ ] Each carousel: status icon + title at left, horizontal scroll of medium covers (~180px wide)
- [ ] Empty carousels show a small "no games here" line, not the full mascot empty state (to keep the shelf compact)
- [ ] Uses native horizontal scroll with `scroll-snap-type: x mandatory`

**Steps:**

- [ ] **Step 1: Build the shelf**

Create `components/library/status-shelf.tsx`:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { STATUS_ICONS } from "@/components/pixel";
import type { LogStatus } from "@/lib/db/schema-types";
import { HeartFull } from "@/components/pixel";

const SHELF_ORDER: { status: LogStatus; label: string }[] = [
  { status: "playing", label: "Playing" },
  { status: "backlog", label: "Up Next" },
  { status: "completed", label: "Recently Completed" },
  { status: "wishlist", label: "Wishlist" },
];

export function StatusShelf({ items }: { items: LibraryItem[] }) {
  // Sort completed by finishedAt desc, others by updatedAt desc — slice top 12 each
  const byStatus: Record<LogStatus, LibraryItem[]> = {
    backlog: [], playing: [], completed: [], dropped: [], on_hold: [], wishlist: [],
  };
  for (const item of items) {
    byStatus[item.status]?.push(item);
  }
  for (const s of Object.keys(byStatus) as LogStatus[]) {
    byStatus[s] = byStatus[s].slice(0, 12);
  }

  return (
    <div className="space-y-8">
      {SHELF_ORDER.map(({ status, label }) => {
        const Icon = STATUS_ICONS[status];
        const shelfItems = byStatus[status];
        return (
          <section key={status}>
            <header className="flex items-center gap-2 mb-3 px-1">
              <Icon size={16} />
              <h2 className="text-sm font-semibold text-[var(--text)]">{label}</h2>
              {shelfItems.length > 0 && (
                <span className="text-xs text-[var(--text-faint)]">{shelfItems.length}</span>
              )}
            </header>
            {shelfItems.length === 0 ? (
              <p className="text-xs text-[var(--text-faint)] px-1">— Nothing here yet.</p>
            ) : (
              <div
                className="flex gap-3 overflow-x-auto pb-2"
                style={{ scrollSnapType: "x mandatory" }}
              >
                {shelfItems.map((item) => (
                  <ShelfItem key={item.logId} item={item} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ShelfItem({ item }: { item: LibraryItem }) {
  return (
    <Link
      href={`/games/${item.game.slug}`}
      className="flex-shrink-0 w-[140px] group"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-[var(--bg-elev)] border border-[var(--border-soft)] group-hover:border-[var(--accent-soft)] transition-colors">
        {item.game.coverUrl && (
          <Image
            src={item.game.coverUrl}
            alt={item.game.title}
            fill
            sizes="140px"
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <div className="mt-1.5">
        <p className="text-xs text-[var(--text)] truncate">{item.game.title}</p>
        {item.rating != null && (
          <p className="text-xs text-[var(--text-faint)] flex items-center gap-1">
            <HeartFull size={8} /> {item.rating}
          </p>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/library/status-shelf.tsx
git commit -m "Phase 1.21: StatusShelf — horizontal carousels per status"
```

---

### Task 22: `/library` page with view toggle + URL state

**Goal:** The library page itself. RSC fetches the library, hydrates a client component that owns the view-toggle state and re-renders the appropriate component (grid/list/shelf).

**Files:**
- Create: `app/(app)/library/page.tsx` (RSC)
- Create: `components/library/library-view-switcher.tsx` (client)

**Acceptance Criteria:**
- [ ] `/library` renders the page with shelf frame around grid (default view)
- [ ] View toggle (3 buttons: Grid / List / Shelf) at top right
- [ ] Filter chips + sort dropdown at top
- [ ] URL syncs: `?status=playing&sort=rating-desc&view=list`
- [ ] TanStack Query: `getUserLibrary` server action wrapped in a query, refetches on URL state change
- [ ] Initial RSC pass populates `initialData`

**Steps:**

- [ ] **Step 1: Build the view switcher (client)**

Create `components/library/library-view-switcher.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getUserLibrary, type LibraryItem, type SortKey } from "@/lib/logs/server-actions";
import { LibraryGrid } from "./library-grid";
import { LibraryList } from "./library-list";
import { StatusShelf } from "./status-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { FilterChips } from "./filter-chips";
import { SortDropdown } from "./sort-dropdown";
import type { LogStatus } from "@/lib/db/schema-types";
import { cn } from "@/lib/utils";

type View = "grid" | "list" | "shelf";

interface Props {
  initialData: LibraryItem[];
  initialFilter: LogStatus | "all";
  initialSort: SortKey;
}

export function LibraryViewSwitcher({ initialData, initialFilter, initialSort }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get("view") ?? "grid") as View;
  const filter = (params.get("status") ?? "all") as LogStatus | "all";
  const sort = (params.get("sort") ?? "recent") as SortKey;

  const { data: items = initialData } = useQuery({
    queryKey: ["library", filter, sort],
    queryFn: () => getUserLibrary({ status: filter, sort }),
    initialData: filter === initialFilter && sort === initialSort ? initialData : undefined,
  });

  function setView(v: View) {
    const next = new URLSearchParams(params);
    if (v === "grid") next.delete("view");
    else next.set("view", v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips />
        <div className="flex items-center gap-3">
          <SortDropdown />
          <div className="flex border border-[var(--border)] rounded-md overflow-hidden">
            {(["grid", "list", "shelf"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3 py-1.5 text-xs uppercase tracking-wide",
                  view === v
                    ? "bg-[var(--bg-card)] text-[var(--text)]"
                    : "text-[var(--text-faint)] hover:text-[var(--text-dim)]",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "grid" ? (
        <ShelfFrame>
          <LibraryGrid items={items} filter={filter} />
        </ShelfFrame>
      ) : view === "list" ? (
        <LibraryList items={items} filter={filter} />
      ) : (
        <StatusShelf items={items} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the page (RSC)**

Create `app/(app)/library/page.tsx`:

```tsx
import { getUserLibrary, type SortKey } from "@/lib/logs/server-actions";
import { LibraryViewSwitcher } from "@/components/library/library-view-switcher";
import type { LogStatus } from "@/lib/db/schema-types";

export const metadata = { title: "Library — Letterboxd for Games" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const filter = (sp.status ?? "all") as LogStatus | "all";
  const sort = (sp.sort ?? "recent") as SortKey;
  const initialData = await getUserLibrary({ status: filter, sort });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Library</h1>
        <p className="text-sm text-[var(--text-dim)]">Your games, your shelf.</p>
      </header>
      <LibraryViewSwitcher
        initialData={initialData}
        initialFilter={filter}
        initialSort={sort}
      />
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

Sign in. Log a few games via ⌘K (Hades, Outer Wilds, Celeste — at least one per a few different statuses). Visit `/library`. Verify:
- Posters render in grid view
- Click filter chip → grid filters, URL updates
- Toggle to List → row layout
- Toggle to Shelf → carousels by status
- Sort changes order (rating desc → highest rated first)
- Reload preserves state (URL drives everything)

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/library/ components/library/library-view-switcher.tsx
git commit -m "Phase 1.22: /library page — view switcher + URL state + RSC initial data"
```

---

### Task 23: Tactile FLIP transitions for status changes

**Goal:** When a game's status changes (e.g. Backlog → Playing via library row context menu, or any updateLogStatus call), the poster physically animates to its new section in the grid via Framer Motion's FLIP technique. The `layout` prop on posters from Task 19 already enables this — this task adds the trigger surface (a status menu on poster hover) and verifies the animation.

**Files:**
- Create: `components/library/poster-status-menu.tsx`
- Modify: `components/library/library-poster.tsx` (add menu trigger)

**Acceptance Criteria:**
- [ ] Hovering a poster shows a small "Change status" affordance (subtle, not overwhelming the hover overlay)
- [ ] Clicking it opens a popover with 6 status options
- [ ] Picking a new status calls `updateLogStatus`, invalidates `["library"]`, and the poster physically slides to its new sorted position via FLIP
- [ ] Animation is smooth (no jank on grids of 30+ items)

**Steps:**

- [ ] **Step 1: Build the status menu popover**

Create `components/library/poster-status-menu.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { updateLogStatus } from "@/lib/logs/server-actions";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { STATUS_ICONS } from "@/components/pixel";
import { cn } from "@/lib/utils";

interface Props {
  logId: string;
  currentStatus: LogStatus;
  onClose: () => void;
}

export function PosterStatusMenu({ logId, currentStatus, onClose }: Props) {
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  function handlePick(status: LogStatus) {
    if (status === currentStatus) {
      onClose();
      return;
    }
    startTransition(async () => {
      const result = await updateLogStatus({ logId, status });
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["library"] });
        await queryClient.invalidateQueries({ queryKey: ["status-shelf"] });
      }
      onClose();
    });
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="absolute top-2 right-2 z-10 bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow-[var(--shadow-elev)] py-1 min-w-[140px]"
        onClick={(e) => e.stopPropagation()}
      >
        {LOG_STATUSES.map((s) => {
          const Icon = STATUS_ICONS[s];
          const isCurrent = s === currentStatus;
          return (
            <button
              key={s}
              type="button"
              onClick={() => handlePick(s)}
              disabled={pending}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors",
                isCurrent
                  ? "text-[var(--accent)] cursor-default"
                  : "text-[var(--text-dim)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]",
              )}
            >
              <Icon size={12} />
              {STATUS_LABELS[s]}
              {isCurrent && <span className="ml-auto">•</span>}
            </button>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Wire menu trigger into poster**

Edit `components/library/library-poster.tsx` — add status menu button + state:

```tsx
import { useState } from "react";
import { PosterStatusMenu } from "./poster-status-menu";

// Inside LibraryPoster:
const [menuOpen, setMenuOpen] = useState(false);

// Add a small menu button INSIDE the hover overlay (before the closing </div> of the gradient overlay):
<button
  type="button"
  onClick={(e) => {
    e.preventDefault();
    setMenuOpen((v) => !v);
  }}
  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 backdrop-blur flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto"
  aria-label="Change status"
>
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="2" r="1" fill="currentColor" />
    <circle cx="6" cy="6" r="1" fill="currentColor" />
    <circle cx="6" cy="10" r="1" fill="currentColor" />
  </svg>
</button>
{menuOpen && (
  <PosterStatusMenu
    logId={item.logId}
    currentStatus={item.status}
    onClose={() => setMenuOpen(false)}
  />
)}
```

(Make sure the menu trigger is OUTSIDE the `<Link>` wrapper or use `e.preventDefault()` to avoid navigation.)

- [ ] **Step 3: Smoke test**

Visit /library with games in different statuses. Hover a poster. Click the dot menu. Pick a different status. Watch the poster animate from its old position to the new one.

If animation feels janky, verify:
- LibraryGrid has `layout` on the wrapping motion.div
- LibraryPoster has `layout` and `layoutId` on its motion.div
- Both components are inside an `AnimatePresence` mode="popLayout"

- [ ] **Step 4: Commit**

```bash
git add components/library/poster-status-menu.tsx components/library/library-poster.tsx
git commit -m "Phase 1.23: tactile FLIP transitions — status menu + animated re-sort"
```

---

### Task 24: `<GameDetail>` component (cover hero, metadata, screenshots, log card)

**Goal:** The actual game detail content — used by both the slide-over panel (intercepted route) and the full route. Pure presentational, takes data as props.

**Files:**
- Create: `components/game/game-detail.tsx`
- Create: `components/game/log-card.tsx`
- Create: `components/game/screenshot-gallery.tsx`

**Acceptance Criteria:**
- [ ] Cover hero at top (full width, ~280px tall, gradient overlay for legibility)
- [ ] Title, year, genres (chips), platforms (icons), Metacritic + RAWG ratings as small badges
- [ ] Description (collapsed past 4 lines with "Read more" expander)
- [ ] Screenshots gallery (horizontal scroll, lazy-loaded)
- [ ] Log card if user has logged it (shows status + heart rating + dates + hours + notes preview + "Edit log" button)
- [ ] "Log it" button if not logged → opens palette quick-log pre-filled with this game

**Steps:**

- [ ] **Step 1: Build screenshot gallery**

Create `components/game/screenshot-gallery.tsx`:

```tsx
"use client";

import Image from "next/image";

export function ScreenshotGallery({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {urls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 relative w-72 aspect-video rounded-md overflow-hidden bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
        >
          <Image src={url} alt="Screenshot" fill sizes="288px" className="object-cover" unoptimized />
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build log card**

Create `components/game/log-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartRating } from "@/components/ui/heart-rating";
import { Button } from "@/components/ui/button";
import { EditLogModal } from "./edit-log-modal";

export function LogCard({ item }: { item: LibraryItem }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Your log</p>
          <StatusBadge status={item.status} size="lg" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>

      {item.rating != null && (
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-1">Rating</p>
          <HeartRating value={item.rating} disabled size={20} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        {item.startedAt && (
          <div>
            <p className="text-xs text-[var(--text-faint)]">Started</p>
            <p className="text-[var(--text-dim)]">
              {new Date(item.startedAt).toLocaleDateString()}
            </p>
          </div>
        )}
        {item.finishedAt && (
          <div>
            <p className="text-xs text-[var(--text-faint)]">Finished</p>
            <p className="text-[var(--text-dim)]">
              {new Date(item.finishedAt).toLocaleDateString()}
            </p>
          </div>
        )}
        {item.hoursPlayed != null && (
          <div>
            <p className="text-xs text-[var(--text-faint)]">Hours</p>
            <p className="text-[var(--text-dim)]">{item.hoursPlayed}h</p>
          </div>
        )}
      </div>

      {item.notes && (
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-1">Notes</p>
          <p className="text-sm text-[var(--text-dim)]">{item.notes}</p>
        </div>
      )}

      {editing && <EditLogModal item={item} onClose={() => setEditing(false)} />}
    </div>
  );
}
```

(The `EditLogModal` is built in Task 31; for now this import will fail until that's done. Comment out the `<EditLogModal>` usage temporarily and uncomment after Task 31 lands. Or build a stub now: `export function EditLogModal({ onClose }: any) { return null; }`.)

- [ ] **Step 3: Build the detail component**

Create `components/game/game-detail.tsx`:

```tsx
import Image from "next/image";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { ScreenshotGallery } from "./screenshot-gallery";
import { LogCard } from "./log-card";

interface Props {
  game: {
    id: number;
    slug: string;
    title: string;
    coverUrl: string | null;
    released: Date | null;
    description: string | null;
    genres: string[] | null;
    platforms: string[] | null;
    metacriticScore: number | null;
    rawgRating: string | null;
  };
  screenshots: string[];
  log: LibraryItem | null;
}

export function GameDetail({ game, screenshots, log }: Props) {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative h-72 -mt-6 -mx-6 overflow-hidden">
        {game.coverUrl && (
          <Image
            src={game.coverUrl}
            alt={game.title}
            fill
            sizes="100vw"
            className="object-cover"
            priority
            unoptimized
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <h1 className="text-3xl font-bold text-white">{game.title}</h1>
          <p className="text-sm text-white/70">
            {game.released ? new Date(game.released).getFullYear() : "—"}
          </p>
        </div>
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap gap-2 items-center">
        {(game.genres ?? []).slice(0, 4).map((g) => (
          <span
            key={g}
            className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-dim)]"
          >
            {g}
          </span>
        ))}
        <span className="text-[var(--text-faint)]">·</span>
        {(game.platforms ?? []).slice(0, 5).map((p) => (
          <PlatformIcon key={p} name={p} size={16} />
        ))}
        {game.metacriticScore != null && (
          <span className="ml-auto text-xs font-mono text-[var(--success)]">
            MC {game.metacriticScore}
          </span>
        )}
        {game.rawgRating != null && (
          <span className="text-xs font-mono text-[var(--text-dim)]">
            RAWG {game.rawgRating}
          </span>
        )}
      </div>

      {/* Log card OR log-it CTA */}
      {log ? (
        <LogCard item={log} />
      ) : (
        <div className="rounded-lg border-2 border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-dim)]">
          Not logged. Press ⌘K to log it.
        </div>
      )}

      {/* Description */}
      {game.description && <DescriptionBlock text={game.description} />}

      {/* Screenshots */}
      {screenshots.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)] mb-3">Screenshots</h2>
          <ScreenshotGallery urls={screenshots} />
        </div>
      )}
    </div>
  );
}

function DescriptionBlock({ text }: { text: string }) {
  return (
    <details className="text-sm text-[var(--text-dim)] leading-relaxed">
      <summary className="cursor-pointer mb-2 text-[var(--text)] font-medium">About</summary>
      <p className="whitespace-pre-line">{text}</p>
    </details>
  );
}
```

- [ ] **Step 4: Add a temporary EditLogModal stub (Task 31 fills it)**

Create `components/game/edit-log-modal.tsx`:

```tsx
"use client";

import type { LibraryItem } from "@/lib/logs/server-actions";

// Stub — fully implemented in Task 31
export function EditLogModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p>EditLogModal stub for {item.game.title}. Built in Task 31.</p>
        <button onClick={onClose} className="mt-4 text-[var(--accent)]">
          Close
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/game/
git commit -m "Phase 1.24: GameDetail + LogCard + ScreenshotGallery (EditLogModal stub)"
```

---

### Task 25: Full game detail route at `/games/[slug]`

**Goal:** The full-page route. RSC fetches game + screenshots + the user's log if any, renders `<GameDetail>`.

**Files:**
- Create: `app/(app)/games/[slug]/page.tsx`

**Acceptance Criteria:**
- [ ] Visiting `/games/hades` directly renders the full page (cover hero, metadata, log card if logged)
- [ ] If game not in DB, fetches from RAWG and upserts (via `getGameDetailBySlug`)
- [ ] If user has logged it, log card renders; otherwise CTA placeholder
- [ ] 404 for unknown slugs (mascot copy from registry)

**Steps:**

- [ ] **Step 1: Build the page**

Create `app/(app)/games/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GameDetail } from "@/components/game/game-detail";
import type { LibraryItem } from "@/lib/logs/server-actions";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  const screenshots = await getScreenshots(game.id);

  // Fetch the user's log if any
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let log: LibraryItem | null = null;
  if (user) {
    const row = await db.query.logs.findFirst({
      where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, game.id)),
    });
    if (row) {
      log = {
        logId: row.id,
        status: row.status,
        rating: row.rating ? Number(row.rating) : null,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        hoursPlayed: row.hoursPlayed ? Number(row.hoursPlayed) : null,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        game: {
          id: game.id,
          slug: game.slug,
          title: game.title,
          coverUrl: game.coverUrl,
          released: game.released,
          genres: game.genres ?? [],
          platforms: game.platforms ?? [],
        },
      };
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <GameDetail
        game={{
          id: game.id,
          slug: game.slug,
          title: game.title,
          coverUrl: game.coverUrl,
          released: game.released,
          description: game.description,
          genres: game.genres,
          platforms: game.platforms,
          metacriticScore: game.metacriticScore,
          rawgRating: game.rawgRating,
        }}
        screenshots={screenshots}
        log={log}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build a not-found page**

Create `app/(app)/games/[slug]/not-found.tsx`:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";

export default function GameNotFound() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <EmptyState mood="confused" title={copy("error.404")} body="That game isn't in our catalog." />
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

Visit `/games/hades` (assuming you've logged it). Verify hero + metadata + log card render. Visit `/games/asdfqwer` → 404 with mascot.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/games/
git commit -m "Phase 1.25: full game detail route /games/[slug]"
```

---

### Task 26: Intercepting route — slide-over panel from the library

**Goal:** When the user is inside the app and clicks a poster, the URL changes to `/games/[slug]` but instead of a page nav, a slide-over panel renders the same `<GameDetail>` over the library. Refreshing or sharing the URL loads the full page (Task 25 already supports this).

**Files:**
- Create: `app/(app)/@modal/default.tsx` (parallel route default — empty)
- Create: `app/(app)/@modal/(.)games/[slug]/page.tsx` (intercepting route)
- Create: `components/game/game-detail-panel.tsx` (the slide-over wrapper)
- Modify: `app/(app)/layout.tsx` (accept `modal` slot)

**Acceptance Criteria:**
- [ ] Clicking a library poster opens the slide-over panel; URL is `/games/hades`
- [ ] Refreshing the page → loads as full route at `/games/hades`
- [ ] Closing the panel (backdrop click, Esc, or close button) returns to library
- [ ] Slide animation: panel slides in from right (~300ms ease-out)
- [ ] On mobile (<768px): bottom sheet instead of side panel

**Steps:**

- [ ] **Step 1: Add modal slot to app layout**

Edit `app/(app)/layout.tsx` to accept and render the modal slot:

```tsx
export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  // ... existing auth check ...
  return (
    <div className="flex min-h-screen flex-col">
      {/* ... header ... */}
      <main className="flex-1">{children}</main>
      <CommandPalette />
      {modal}
    </div>
  );
}
```

- [ ] **Step 2: Build the default for the modal slot**

Create `app/(app)/@modal/default.tsx`:

```tsx
export default function Default() {
  return null;
}
```

- [ ] **Step 3: Build the panel component**

Create `components/game/game-detail-panel.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export function GameDetailPanel({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={() => router.back()}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 280 }}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-[var(--bg)] shadow-[var(--shadow-elev)] md:border-l md:border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex justify-between items-center px-6 py-3 border-b border-[var(--border-soft)] bg-[var(--bg)]/80 backdrop-blur">
          <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Game detail</span>
          <button
            onClick={() => router.back()}
            className="text-[var(--text-dim)] hover:text-[var(--text)] text-2xl leading-none"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-6">{children}</div>
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Build the intercepted route**

Create `app/(app)/@modal/(.)games/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GameDetail } from "@/components/game/game-detail";
import { GameDetailPanel } from "@/components/game/game-detail-panel";
import type { LibraryItem } from "@/lib/logs/server-actions";

export default async function InterceptedGamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  const screenshots = await getScreenshots(game.id);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let log: LibraryItem | null = null;
  if (user) {
    const row = await db.query.logs.findFirst({
      where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, game.id)),
    });
    if (row) {
      log = {
        logId: row.id, status: row.status,
        rating: row.rating ? Number(row.rating) : null,
        startedAt: row.startedAt, finishedAt: row.finishedAt,
        hoursPlayed: row.hoursPlayed ? Number(row.hoursPlayed) : null,
        notes: row.notes, createdAt: row.createdAt, updatedAt: row.updatedAt,
        game: {
          id: game.id, slug: game.slug, title: game.title,
          coverUrl: game.coverUrl, released: game.released,
          genres: game.genres ?? [], platforms: game.platforms ?? [],
        },
      };
    }
  }

  return (
    <GameDetailPanel>
      <GameDetail
        game={{
          id: game.id, slug: game.slug, title: game.title,
          coverUrl: game.coverUrl, released: game.released,
          description: game.description, genres: game.genres,
          platforms: game.platforms, metacriticScore: game.metacriticScore,
          rawgRating: game.rawgRating,
        }}
        screenshots={screenshots}
        log={log}
      />
    </GameDetailPanel>
  );
}
```

- [ ] **Step 5: Smoke test**

Visit /library. Click Hades poster — slide-over should open with detail content; URL is `/games/hades`. Esc or backdrop click → back to library. Refresh while panel is open → loads full page.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/@modal/ components/game/game-detail-panel.tsx app/\(app\)/layout.tsx
git commit -m "Phase 1.26: intercepting routes — slide-over game detail panel"
```

---

# Week 6 — Cockpit Dashboard, Profile, Polish, Verification

Goal: ship the cockpit dashboard, profile page, full edit-log modal, complete the mascot copy, and run the verification gate.

---

### Task 27: `<MascotGreeting>` with context-aware copy

**Goal:** The dashboard's hero — mascot at large size with a context-aware greeting based on time of day, last activity, and currently playing.

**Files:**
- Create: `components/dashboard/mascot-greeting.tsx`
- Modify: `lib/mascot/copy.ts` (add greeting picker helper)

**Acceptance Criteria:**
- [ ] Renders mascot at `xl` with `waving` mood transitioning to `idle` after 1.5s
- [ ] Speech bubble shows context-aware copy
- [ ] Picks greeting based on (hour-of-day, days-since-last-log, currently-playing title)
- [ ] Long-absence greeting includes day count via interpolation

**Steps:**

- [ ] **Step 1: Add greeting picker to copy.ts**

Edit `lib/mascot/copy.ts` — append:

```ts
export interface GreetingContext {
  hour: number; // 0-23
  daysSinceLastLog: number | null;
  currentlyPlaying: { title: string; daysSinceStarted: number } | null;
}

export function dashboardGreeting(ctx: GreetingContext): string {
  // Long absence trumps all
  if (ctx.daysSinceLastLog != null && ctx.daysSinceLastLog >= 7) {
    return copy("dashboard.greeting.long-absence", { days: ctx.daysSinceLastLog });
  }
  // Currently playing reference
  if (ctx.currentlyPlaying && ctx.currentlyPlaying.daysSinceStarted >= 3) {
    return copy("dashboard.greeting.actively-playing", {
      title: ctx.currentlyPlaying.title,
      days: ctx.currentlyPlaying.daysSinceStarted,
    });
  }
  // Time of day
  if (ctx.hour < 5) return copy("dashboard.greeting.night");
  if (ctx.hour < 12) return copy("dashboard.greeting.morning");
  if (ctx.hour < 17) return copy("dashboard.greeting.afternoon");
  if (ctx.hour < 22) return copy("dashboard.greeting.evening");
  return copy("dashboard.greeting.night");
}
```

- [ ] **Step 2: Build greeting component**

Create `components/dashboard/mascot-greeting.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Mascot } from "@/components/mascot/mascot";
import { dashboardGreeting, type GreetingContext } from "@/lib/mascot/copy";

export function MascotGreeting({ context }: { context: GreetingContext }) {
  const [mood, setMood] = useState<"waving" | "idle">("waving");
  const message = dashboardGreeting(context);

  useEffect(() => {
    const t = setTimeout(() => setMood("idle"), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex items-center gap-6">
      <Mascot size="xl" mood={mood} message={message} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/mascot-greeting.tsx lib/mascot/copy.ts
git commit -m "Phase 1.27: MascotGreeting + dashboardGreeting context picker"
```

---

### Task 28: `<StatsStrip>` and `<ActivityTimeline>` for dashboard

**Goal:** Two dashboard widgets — the at-a-glance stats and the recent-activity feed.

**Files:**
- Create: `components/dashboard/stats-strip.tsx`
- Create: `components/dashboard/activity-timeline.tsx`
- Modify: `lib/logs/server-actions.ts` (add `getUserStats` + `getRecentActivity`)

**Acceptance Criteria:**
- [ ] StatsStrip: total games · by-status counts · average rating
- [ ] ActivityTimeline: last 10 events (logged X, rated Y, status changed) with timestamps
- [ ] Both use server actions returning lightweight shapes

**Steps:**

- [ ] **Step 1: Add stats + activity actions**

Edit `lib/logs/server-actions.ts` — append:

```ts
export interface UserStats {
  total: number;
  byStatus: Record<LogStatus, number>;
  averageRating: number | null;
}

export async function getUserStats(): Promise<UserStats | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const rows = await db
    .select({
      status: schema.logs.status,
      rating: schema.logs.rating,
    })
    .from(schema.logs)
    .where(eq(schema.logs.userId, user.id));

  const byStatus: Record<LogStatus, number> = {
    backlog: 0, playing: 0, completed: 0, dropped: 0, on_hold: 0, wishlist: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const r of rows) {
    byStatus[r.status as LogStatus]++;
    if (r.rating != null) {
      ratingSum += Number(r.rating);
      ratingCount++;
    }
  }

  return {
    total: rows.length,
    byStatus,
    averageRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
  };
}

export interface ActivityEvent {
  type: "logged";
  logId: string;
  status: LogStatus;
  rating: number | null;
  gameTitle: string;
  gameSlug: string;
  at: Date;
}

export async function getRecentActivity(limit = 10): Promise<ActivityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const rows = await db
    .select({
      logId: schema.logs.id,
      status: schema.logs.status,
      rating: schema.logs.rating,
      title: schema.games.title,
      slug: schema.games.slug,
      at: schema.logs.updatedAt,
    })
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(eq(schema.logs.userId, user.id))
    .orderBy(desc(schema.logs.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    type: "logged" as const,
    logId: r.logId,
    status: r.status as LogStatus,
    rating: r.rating ? Number(r.rating) : null,
    gameTitle: r.title,
    gameSlug: r.slug,
    at: r.at,
  }));
}
```

- [ ] **Step 2: Build StatsStrip**

Create `components/dashboard/stats-strip.tsx`:

```tsx
import type { UserStats } from "@/lib/logs/server-actions";
import { STATUS_LABELS } from "@/lib/db/schema-types";
import { HeartFull } from "@/components/pixel";

export function StatsStrip({ stats }: { stats: UserStats }) {
  const { total, byStatus, averageRating } = stats;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Total" value={String(total)} />
      <Stat label={STATUS_LABELS.playing} value={String(byStatus.playing)} accent="#7c5cff" />
      <Stat label={STATUS_LABELS.completed} value={String(byStatus.completed)} accent="#4ade80" />
      <Stat
        label="Avg rating"
        value={averageRating != null ? String(averageRating) : "—"}
        icon={<HeartFull size={14} />}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">{label}</p>
      <p
        className="text-2xl font-bold mt-0.5 flex items-center gap-2"
        style={accent ? { color: accent } : undefined}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Build ActivityTimeline**

Create `components/dashboard/activity-timeline.tsx`:

```tsx
import Link from "next/link";
import type { ActivityEvent } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartFull } from "@/components/pixel";

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li
          key={e.logId}
          className="flex items-center gap-3 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2"
        >
          <StatusBadge status={e.status} size="sm" iconOnly />
          <Link
            href={`/games/${e.gameSlug}`}
            className="flex-1 text-sm text-[var(--text)] hover:text-[var(--accent)] truncate"
          >
            {e.gameTitle}
          </Link>
          {e.rating != null && (
            <span className="text-xs font-mono text-[var(--text-dim)] flex items-center gap-1">
              <HeartFull size={10} />
              {e.rating}
            </span>
          )}
          <span className="text-xs text-[var(--text-faint)]">{relativeTime(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function relativeTime(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const min = ms / 60_000;
  const hr = min / 60;
  const day = hr / 24;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)}m ago`;
  if (hr < 24) return `${Math.floor(hr)}h ago`;
  if (day < 7) return `${Math.floor(day)}d ago`;
  return new Date(d).toLocaleDateString();
}
```

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ lib/logs/server-actions.ts
git commit -m "Phase 1.28: StatsStrip + ActivityTimeline + getUserStats/getRecentActivity actions"
```

---

### Task 29: Cockpit dashboard at `/` (replace marketing landing for authed users)

**Goal:** The post-login experience. Mascot greeting + Status Shelf hero + recent activity + stats. Conditional render: unauthed sees the existing marketing landing, authed sees the cockpit.

**Files:**
- Modify: `app/page.tsx` (existing marketing page — wrap with auth check)
- Create: `app/(app)/_cockpit/cockpit-dashboard.tsx` (the authed view component)
- Delete: `app/(app)/dashboard/` (no longer needed; redirect handled below)
- Create: `app/(app)/dashboard/page.tsx` (redirect to /)

**Acceptance Criteria:**
- [ ] Visit `/` while signed out → marketing landing (existing)
- [ ] Visit `/` while signed in → cockpit dashboard
- [ ] Login redirect now goes to `/` instead of `/dashboard`
- [ ] Old `/dashboard` URL redirects to `/`
- [ ] Cockpit shows: greeting + status shelf + activity timeline + stats strip

**Steps:**

- [ ] **Step 1: Build cockpit component**

Create `app/(app)/_cockpit/cockpit-dashboard.tsx`:

```tsx
import { getUserLibrary, getUserStats, getRecentActivity } from "@/lib/logs/server-actions";
import { MascotGreeting } from "@/components/dashboard/mascot-greeting";
import { StatusShelf } from "@/components/library/status-shelf";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import type { GreetingContext } from "@/lib/mascot/copy";

export async function CockpitDashboard() {
  const [library, stats, activity] = await Promise.all([
    getUserLibrary({}),
    getUserStats(),
    getRecentActivity(10),
  ]);

  // Build greeting context
  const playing = library.find((l) => l.status === "playing");
  const lastLog = library[0]; // already sorted by recent
  const greetingCtx: GreetingContext = {
    hour: new Date().getHours(),
    daysSinceLastLog: lastLog
      ? Math.floor((Date.now() - new Date(lastLog.updatedAt).getTime()) / 86_400_000)
      : null,
    currentlyPlaying: playing
      ? {
          title: playing.game.title,
          daysSinceStarted: playing.startedAt
            ? Math.floor((Date.now() - new Date(playing.startedAt).getTime()) / 86_400_000)
            : 0,
        }
      : null,
  };

  if (library.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <EmptyState
          mood="pointing"
          title={copy("library.empty.all")}
          body="Press ⌘K to log your first game."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      <MascotGreeting context={greetingCtx} />
      {stats && <StatsStrip stats={stats} />}
      <StatusShelf items={library} />
      {activity.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 text-[var(--text)]">Recent activity</h2>
          <ActivityTimeline events={activity} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Modify the root page to conditionally render**

Edit `app/page.tsx` — wrap with auth check. Current page is the marketing landing; we need to dispatch:

```tsx
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CockpitDashboard } from "./(app)/_cockpit/cockpit-dashboard";

// (KEEP all the existing imports for the marketing landing)
// ... existing imports for Hero, etc.

export default async function HomePage() {
  // If Supabase isn't configured, always show marketing
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      return <CockpitDashboard />;
    }
  }

  // Existing marketing landing JSX goes here unchanged
  return <MarketingLanding />;
}

function MarketingLanding() {
  // Move the existing app/page.tsx return JSX into this function
  return (
    /* ... existing landing JSX ... */
    <div>...</div>
  );
}
```

(Rename the existing exported function's body into `MarketingLanding()` — keep all hero/CTA elements as-is.)

- [ ] **Step 3: Important — the cockpit needs the (app) layout**

Problem: `app/page.tsx` is OUTSIDE `(app)/`, so it doesn't get the header bar with the search palette mounted. Fix by moving the auth check INTO the `(app)` layout group:

Alternative cleaner approach — create `app/(app)/page.tsx` for the authed cockpit, and update middleware/route to handle:

Actually, simpler: keep the dispatch in `app/page.tsx`, but wrap the cockpit-render branch with the same providers/header. Since `app/(app)/layout.tsx` already does auth check + redirect, we can lean on it.

**Refined plan:** Make the root `app/page.tsx` conditionally redirect:

```tsx
// app/page.tsx
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
// ... marketing landing imports

export default async function HomePage() {
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/home");
    }
  }
  return /* existing marketing landing JSX */;
}
```

Then create `app/(app)/home/page.tsx` for the cockpit:

```tsx
import { CockpitDashboard } from "../_cockpit/cockpit-dashboard";
export default function HomeRoute() {
  return <CockpitDashboard />;
}
```

And update login redirect to `/home`:

Edit `app/(auth)/login/actions.ts`: change `redirect(parsed.data.next || "/dashboard")` → `redirect(parsed.data.next || "/home")`. Same change in `app/(auth)/signup/actions.ts` and `app/auth/callback/route.ts`.

- [ ] **Step 4: Redirect old `/dashboard`**

Modify `app/(app)/dashboard/page.tsx` to be just:

```tsx
import { redirect } from "next/navigation";
export default function DashboardRedirect() {
  redirect("/home");
}
```

- [ ] **Step 5: Update header link**

Edit `app/(app)/layout.tsx` — the Logo `<Link href="/">` → `<Link href="/home">`.

- [ ] **Step 6: Smoke test**

- Sign out → visit `/` → marketing landing
- Sign in → redirected to `/home` → cockpit renders
- Visit `/dashboard` → redirected to `/home`
- Header logo → goes to `/home`

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/\(app\)/_cockpit/ app/\(app\)/home/ app/\(app\)/dashboard/page.tsx app/\(app\)/layout.tsx app/\(auth\)/login/actions.ts app/\(auth\)/signup/actions.ts app/auth/callback/route.ts
git commit -m "Phase 1.29: cockpit dashboard at /home + dispatch from / + redirect /dashboard"
```

---

### Task 30: `/u/[username]` profile page

**Goal:** Profile page (own profile primary; public access works via RLS but isn't UI-polished). Header + library tab + stats. Reuses `<LibraryGrid>` + `<StatsStrip>`.

**Files:**
- Create: `app/(app)/u/[username]/page.tsx`
- Create: `lib/profile/server-actions.ts` (`getProfileByUsername`, `ensureMyProfile`)

**Acceptance Criteria:**
- [ ] Visiting `/u/myusername` shows profile header + library + stats
- [ ] If no profile exists for the current user, auto-create one with username from email prefix
- [ ] Visiting `/u/nonexistent` → 404 with mascot
- [ ] Public viewing of other users' profiles works (RLS-filtered library)

**Steps:**

- [ ] **Step 1: Build profile actions**

Create `lib/profile/server-actions.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getProfileByUsername(username: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
  });
  return profile ?? null;
}

export async function ensureMyProfile() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
  });
  if (existing) return existing;

  // Generate username from email prefix
  const baseUsername = (user.email?.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9_]/g, "");
  let username = baseUsername.slice(0, 32) || `user${Date.now()}`;

  // Ensure unique — append numeric suffix if collision
  for (let i = 0; i < 10; i++) {
    const conflict = await db.query.profiles.findFirst({
      where: eq(schema.profiles.username, username),
    });
    if (!conflict) break;
    username = `${baseUsername}${i + 1}`;
  }

  const [created] = await db
    .insert(schema.profiles)
    .values({ userId: user.id, username, displayName: user.email ?? username })
    .returning();
  return created;
}
```

- [ ] **Step 2: Build profile page**

Create `app/(app)/u/[username]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { LibraryGrid } from "@/components/library/library-grid";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { Mascot } from "@/components/mascot/mascot";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LibraryItem } from "@/lib/logs/server-actions";
import type { LogStatus } from "@/lib/db/schema-types";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  // Determine if viewing own profile
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwn = user?.id === profile.userId;

  // Load library — own profile sees everything, public sees only non-private logs
  const rows = await db
    .select({
      logId: schema.logs.id,
      status: schema.logs.status,
      rating: schema.logs.rating,
      startedAt: schema.logs.startedAt,
      finishedAt: schema.logs.finishedAt,
      hoursPlayed: schema.logs.hoursPlayed,
      notes: schema.logs.notes,
      isPrivate: schema.logs.isPrivate,
      createdAt: schema.logs.createdAt,
      updatedAt: schema.logs.updatedAt,
      game_id: schema.games.id,
      game_slug: schema.games.slug,
      game_title: schema.games.title,
      game_coverUrl: schema.games.coverUrl,
      game_released: schema.games.released,
      game_genres: schema.games.genres,
      game_platforms: schema.games.platforms,
    })
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(eq(schema.logs.userId, profile.userId))
    .orderBy(desc(schema.logs.updatedAt));

  const items: LibraryItem[] = rows
    .filter((r) => isOwn || !r.isPrivate)
    .map((r) => ({
      logId: r.logId, status: r.status as LogStatus,
      rating: r.rating ? Number(r.rating) : null,
      startedAt: r.startedAt, finishedAt: r.finishedAt,
      hoursPlayed: r.hoursPlayed ? Number(r.hoursPlayed) : null,
      notes: r.notes, createdAt: r.createdAt, updatedAt: r.updatedAt,
      game: {
        id: r.game_id, slug: r.game_slug, title: r.game_title,
        coverUrl: r.game_coverUrl, released: r.game_released,
        genres: r.game_genres ?? [], platforms: r.game_platforms ?? [],
      },
    }));

  // Stats from visible items
  const byStatus: Record<LogStatus, number> = {
    backlog: 0, playing: 0, completed: 0, dropped: 0, on_hold: 0, wishlist: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const i of items) {
    byStatus[i.status]++;
    if (i.rating != null) {
      ratingSum += i.rating;
      ratingCount++;
    }
  }
  const stats = {
    total: items.length,
    byStatus,
    averageRating:
      ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header className="flex items-center gap-6">
        <Mascot size="xl" mood="idle" silent />
        <div>
          <h1 className="text-3xl font-bold">{profile.displayName ?? profile.username}</h1>
          <p className="text-sm text-[var(--text-dim)]">@{profile.username}</p>
          {profile.bio && <p className="mt-2 text-sm text-[var(--text)] max-w-md">{profile.bio}</p>}
        </div>
      </header>

      <StatsStrip stats={stats} />

      <ShelfFrame>
        <LibraryGrid items={items} filter="all" />
      </ShelfFrame>
    </div>
  );
}
```

- [ ] **Step 3: Add profile bootstrap on login**

Edit `app/auth/callback/route.ts` — after auth succeeds, call `ensureMyProfile()`. Same in login/signup actions:

```ts
// At the bottom, after successful auth, before redirect:
import { ensureMyProfile } from "@/lib/profile/server-actions";
await ensureMyProfile();
redirect("/home");
```

- [ ] **Step 4: 404 for unknown usernames**

Create `app/(app)/u/[username]/not-found.tsx` (similar to game not-found):

```tsx
import { EmptyState } from "@/components/ui/empty-state";

export default function ProfileNotFound() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <EmptyState mood="confused" title="No such profile." body="Try a different username." />
    </div>
  );
}
```

- [ ] **Step 5: Smoke test**

Sign in. Visit `/u/<your-derived-username>` (check DB: `SELECT username FROM profiles WHERE user_id = '...';`). Verify header + library + stats.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/u/ lib/profile/ app/auth/callback/route.ts app/\(auth\)/
git commit -m "Phase 1.30: /u/[username] profile page + ensureMyProfile bootstrap"
```

---

### Task 31: `<EditLogModal>` — full-form log editor

**Goal:** Replace the stub from Task 24 with the real edit form. All schema fields exposed.

**Files:**
- Modify: `components/game/edit-log-modal.tsx` (replace stub with full form)
- Modify: `lib/logs/server-actions.ts` (add `updateLogFull` action)

**Acceptance Criteria:**
- [ ] Modal opens centered with all fields: status, rating, started date, finished date, hours, platform, replay flag, privacy toggle, notes (textarea)
- [ ] Submit calls `updateLogFull`, invalidates queries, closes
- [ ] Delete button (with confirm) deletes the log + closes
- [ ] Validates: rating in 0-10/0.5 steps, hours non-negative, dates parse-able

**Steps:**

- [ ] **Step 1: Append updateLogFull action**

Edit `lib/logs/server-actions.ts`:

```ts
const updateLogFullInput = z.object({
  logId: z.string().uuid(),
  status: z.enum(LOG_STATUSES as [LogStatus, ...LogStatus[]]),
  rating: z.number().min(0).max(10).optional().nullable(),
  startedAt: z.string().optional().nullable(), // ISO date string
  finishedAt: z.string().optional().nullable(),
  hoursPlayed: z.number().min(0).max(99999).optional().nullable(),
  platformPlayedOn: z.string().max(64).optional().nullable(),
  isReplay: z.boolean(),
  isPrivate: z.boolean(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function updateLogFull(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = updateLogFullInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const d = parsed.data;
  const result = await db
    .update(schema.logs)
    .set({
      status: d.status,
      rating: d.rating != null && d.rating > 0 ? String(d.rating) : null,
      startedAt: d.startedAt ? new Date(d.startedAt) : null,
      finishedAt: d.finishedAt ? new Date(d.finishedAt) : null,
      hoursPlayed: d.hoursPlayed != null ? String(d.hoursPlayed) : null,
      platformPlayedOn: d.platformPlayedOn || null,
      isReplay: d.isReplay,
      isPrivate: d.isPrivate,
      notes: d.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.logs.id, d.logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  return { ok: true };
}
```

- [ ] **Step 2: Replace EditLogModal stub with full form**

Edit `components/game/edit-log-modal.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { updateLogFull, deleteLog } from "@/lib/logs/server-actions";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { STATUS_ICONS } from "@/components/pixel";
import { HeartRating } from "@/components/ui/heart-rating";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_BORDER: Record<LogStatus, string> = {
  backlog: "border-[#9494a8] text-[#9494a8]",
  playing: "border-[#7c5cff] text-[#7c5cff]",
  completed: "border-[#4ade80] text-[#4ade80]",
  dropped: "border-[#f87171] text-[#f87171]",
  on_hold: "border-[#fbbf24] text-[#fbbf24]",
  wishlist: "border-[#ffb84a] text-[#ffb84a]",
};

const dateToInput = (d: Date | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function EditLogModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const [status, setStatus] = useState<LogStatus>(item.status);
  const [rating, setRating] = useState(item.rating ?? 0);
  const [startedAt, setStartedAt] = useState(dateToInput(item.startedAt));
  const [finishedAt, setFinishedAt] = useState(dateToInput(item.finishedAt));
  const [hours, setHours] = useState(item.hoursPlayed?.toString() ?? "");
  const [platform, setPlatform] = useState("");
  const [isReplay, setIsReplay] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const router = useRouter();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateLogFull({
        logId: item.logId,
        status,
        rating: rating > 0 ? rating : null,
        startedAt: startedAt || null,
        finishedAt: finishedAt || null,
        hoursPlayed: hours ? Number(hours) : null,
        platformPlayedOn: platform || null,
        isReplay,
        isPrivate,
        notes,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["library"] });
      router.refresh();
      onClose();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this log? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteLog(item.logId);
      if (!result.ok) {
        setError(result.error ?? "Failed to delete");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["library"] });
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Edit log</h2>
          <button onClick={onClose} className="text-[var(--text-dim)] text-2xl leading-none">×</button>
        </header>

        {/* Status */}
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">Status</p>
          <div className="grid grid-cols-3 gap-2">
            {LOG_STATUSES.map((s) => {
              const Icon = STATUS_ICONS[s];
              const isActive = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-all",
                    isActive
                      ? `${STATUS_BORDER[s]} bg-[var(--bg-elev)]`
                      : "border-[var(--border)] text-[var(--text-dim)]",
                  )}
                >
                  <Icon size={14} />
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rating */}
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">
            Rating <span className="font-mono">{rating > 0 ? rating : "—"}</span>
          </p>
          <HeartRating value={rating} onChange={setRating} size={22} />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started">
            <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Finished">
            <input type="date" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {/* Hours + platform */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours played">
            <input
              type="number" min="0" step="0.1" value={hours}
              onChange={(e) => setHours(e.target.value)} className={inputCls}
            />
          </Field>
          <Field label="Platform">
            <input
              type="text" value={platform} placeholder="Steam Deck, PS5..."
              onChange={(e) => setPlatform(e.target.value)} className={inputCls}
            />
          </Field>
        </div>

        {/* Toggles */}
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isReplay} onChange={(e) => setIsReplay(e.target.checked)} />
            Replay
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Private
          </label>
        </div>

        {/* Notes */}
        <Field label="Notes">
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000}
            className={cn(inputCls, "resize-y")}
          />
        </Field>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-between pt-2 border-t border-[var(--border-soft)]">
          <Button variant="ghost" onClick={handleDelete} disabled={pending}>Delete log</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={save} disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-md px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-soft)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-1.5">{label}</p>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

On a logged game's detail page, click Edit on the log card. Modal opens. Change rating to 9.5, set hours to 35, finished date to today, save. Detail page refreshes with new values. Delete log → confirms → log removed.

- [ ] **Step 4: Commit**

```bash
git add components/game/edit-log-modal.tsx lib/logs/server-actions.ts
git commit -m "Phase 1.31: EditLogModal full form + updateLogFull action"
```

---

### Task 32: Author full mascot copy strings

**Goal:** Round out `lib/mascot/copy.ts` with at least 3 variants per scenario and verify tone consistency. Prune any placeholder lines.

**Files:**
- Modify: `lib/mascot/copy.ts`

**Acceptance Criteria:**
- [ ] Every scenario in `MascotScenario` has at least 3 variants
- [ ] Every line passes the tone check: ribs your backlog, never insults your taste; one sentence; no emojis; no exclamation marks
- [ ] Run a manual review pass — read every line aloud; flag and rewrite anything that sounds AI-default
- [ ] Variant count totals 25-35 strings (per spec target)

**Steps:**

- [ ] **Step 1: Edit copy.ts** — expand each scenario to 3-5 variants. Sample additions for `dashboard.greeting.morning`:

```ts
"dashboard.greeting.morning": [
  "Morning.",
  "Up early. Or up late, hard to tell.",
  "Coffee first.",
  "Morning. The day's full of unplayed games.",
  "Good morning. Pick up where you left off?",
],
```

Apply similar expansion to every scenario. Aim for the sardonic-insider voice throughout. Reference the spec's authoring guidelines:
- Game-culture references on-brand ("soulslike", "roguelike", "Stockholm syndrome" in jest)
- Avoid "epic", "wholesome", "amazing"
- Length: one sentence (occasionally two)

- [ ] **Step 2: Tone-review pass**

Read every variant. Ask:
- Does it sound like a friend who knows games?
- Does it ever feel mean rather than ribbing?
- Does it use any words an LLM defaults to?

Fix any that fail.

- [ ] **Step 3: Commit**

```bash
git add lib/mascot/copy.ts
git commit -m "Phase 1.32: full mascot copy authoring pass — 3-5 variants per scenario"
```

---

### Task 33: Verification gate run-through + bug fixes

**Goal:** Manually run all 14 acceptance criteria from the spec. Fix anything that doesn't pass. This is the gate.

**Files:**
- (Likely various small fixes across the codebase)

**Acceptance Criteria:** All 14 spec gate items pass:

- [ ] 1. Visit `/` while signed out → redirect to `/login`
- [ ] 2. Sign in → land on `/home` → mascot greeting + status shelf (empty if no games) + onboarding
- [ ] 3. ⌘K → palette → type "Hades" → results within 500ms
- [ ] 4. Click Hades → quick-log form → Completed → 9 hearts → submit
- [ ] 5. Toast with custom pixel checkmark + mascot celebrates → palette closes
- [ ] 6. `/home` updates: Hades in "Recently Completed"
- [ ] 7. `/library` → poster wall shows Hades cover (with shelf frame)
- [ ] 8. Click "Completed" filter → grid filters (FLIP animation)
- [ ] 9. Click Hades poster → slide-over panel with detail + log card
- [ ] 10. Refresh while panel is open → loads as full `/games/hades`
- [ ] 11. Toggle library to Status Shelf → Hades in Completed shelf
- [ ] 12. Toggle to List view → info-dense row
- [ ] 13. Sort by rating desc → Hades at top
- [ ] 14. Edit log → set hours 35, platform "Steam Deck", finished today → save → see updated card

**Steps:**

- [ ] **Step 1: Run through the gate as an end user**

Sign out, clear session, restart `pnpm dev`, work through all 14 checks in order. Note any failures.

- [ ] **Step 2: Cross-browser pass**

Repeat the gate in:
- Chrome / Edge desktop
- Safari desktop (or Firefox if no Mac)
- iOS Safari (use device or simulator)
- Chrome Android (or DevTools mobile emulation)

Note especially: intercepting routes behavior, slide-over panel mobile fallback, Cmd+K vs Ctrl+K, image loading on `media.rawg.io`.

- [ ] **Step 3: Fix anything broken**

Each fix gets its own commit:

```bash
git commit -m "Phase 1.33: <one-liner about what was fixed>"
```

- [ ] **Step 4: Final commit when gate passes**

```bash
git commit --allow-empty -m "Phase 1 verification gate: all 14 checks passing"
```

---

# Phase 1 — Done

When all 33 tasks above are complete:
- The dogfood loop works end-to-end
- The codebase is ready for Phase 2 (AI router + reviews)
- Tag the milestone: `git tag phase-1-complete`

