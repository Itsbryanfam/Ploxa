import type { MascotPose } from "./dominant-pose";

const FONT_MONO = "ui-monospace, monospace";

export type TasteCardProps = {
  username: string;
  narrative: string;
  topGenre: string;
  playstyle: string;
  lengthSweetSpot: string;
  pose: MascotPose;
  /** Absolute URL of the mascot sprite for the pose (passed in from the route). */
  mascotImageUrl: string;
};

/**
 * 1200x630 taste-fingerprint trading card rendered via Vercel OG.
 *
 * Vercel OG accepts a constrained CSS subset: inline styles only (no
 * className), parent containers with multiple children must set
 * display:flex, no min/max shorthand, all sizes as numbers. Stays inside
 * those rails on purpose.
 */
export function TasteCard(props: TasteCardProps) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        background: "#0a0a0a",
        fontFamily: FONT_MONO,
        color: "#e4e4e7",
        padding: 40,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          border: "4px solid #27272a",
          borderRadius: 16,
          padding: 40,
          gap: 24,
        }}
      >
        {/* Top row: mascot + username */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {/* next/og does not run the Next Image component; raw <img> is correct. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={props.mascotImageUrl}
            width={120}
            height={120}
            style={{ imageRendering: "pixelated" }}
            alt=""
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: 18,
                color: "#71717a",
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              taste card
            </span>
            <span style={{ fontSize: 36, color: "#e4e4e7" }}>@{props.username}</span>
          </div>
        </div>

        {/* Stats panel */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "#18181b",
            border: "2px solid #27272a",
            borderRadius: 8,
            padding: 20,
            gap: 12,
            fontSize: 22,
          }}
        >
          <Row label="TOP GENRE" value={props.topGenre} />
          <Row label="PLAYSTYLE" value={props.playstyle} />
          <Row label="SWEET SPOT" value={props.lengthSweetSpot} />
        </div>

        {/* Narrative */}
        <div
          style={{
            display: "flex",
            fontSize: 24,
            lineHeight: 1.4,
            color: "#a1a1aa",
            marginTop: "auto",
          }}
        >
          &quot;{props.narrative}&quot;
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <span style={{ color: "#52525b", width: 160, display: "flex" }}>{label}</span>
      <span style={{ color: "#fafafa", flex: 1, display: "flex" }}>{value}</span>
    </div>
  );
}
