import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * React Email recap template — server-rendered HTML + plain-text fallback.
 *
 * Covers both yearly ("Your 2026 in games") and monthly ("Your May 2026")
 * variants via the `mode` prop. Structure mirrors digest-template.tsx:
 *   - @react-email/components primitives
 *   - Dark palette: #0a0a0a bg, #e5e5e5 text, #a3a3a3 muted
 *   - Inline styles only (email clients strip <style> blocks)
 *   - Container max-width 560px
 *   - No emoji, no exclamation marks (project memory rules)
 *
 * The template is NOT server-only — the email worker (T18) runs in an Edge
 * Function which needs to import it directly.
 */

// ─────────────────────────────────────────────────────────────
// Month name table — 1-based (index 0 = January)
// ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ─────────────────────────────────────────────────────────────
// Shared style constants (copied from digest-template.tsx palette)
// ─────────────────────────────────────────────────────────────

const bodyStyle = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  backgroundColor: "#0a0a0a",
  color: "#e5e5e5",
};

const containerStyle = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "24px 16px",
};

const headingStyle = {
  fontSize: 24,
  color: "#e5e5e5",
  margin: "16px 0 8px",
  textAlign: "center" as const,
};

const mutedTextStyle = {
  fontSize: 13,
  color: "#a3a3a3",
  textAlign: "center" as const,
  margin: "0 0 16px",
};

const ctaStyle = {
  display: "block",
  width: "fit-content",
  margin: "20px auto",
  padding: "10px 24px",
  backgroundColor: "#262626",
  color: "#e5e5e5",
  textDecoration: "none" as const,
  borderRadius: 4,
  fontSize: 14,
};

const bodyTextStyle = {
  color: "#e5e5e5",
  fontSize: 14,
  margin: "4px 0",
  textAlign: "center" as const,
};

const sparseSectionStyle = {
  padding: "32px 0",
  textAlign: "center" as const,
};

const sparseTextStyle = {
  color: "#a3a3a3",
  fontSize: 15,
  margin: "0",
};

const footerStyle = {
  fontSize: 12,
  color: "#737373",
  marginTop: 32,
  textAlign: "center" as const,
};

const footerLinkStyle = {
  color: "#737373",
  textDecoration: "underline" as const,
};

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export interface RecapEmailProps {
  payload: RecapPayload;
  mode: "yearly" | "monthly";
  /** e.g. "https://ploxa.vercel.app/u/alex/year/2026" */
  recapUrl: string;
  /** Signed unsubscribe URL — rendered as a link in the footer. */
  unsubscribeUrl: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function deriveYear(payload: RecapPayload): number {
  // windowStart is an ISO string, e.g. "2026-01-01T00:00:00.000Z"
  return new Date(payload.windowStart).getUTCFullYear();
}

function deriveMonthName(payload: RecapPayload): string {
  const m = new Date(payload.windowStart).getUTCMonth(); // 0-based
  return MONTH_NAMES[m] ?? "Unknown";
}

function genreLabel(payload: RecapPayload): string {
  return payload.topGenre?.name ?? "varied";
}

function heroDimensions(mode: "yearly" | "monthly"): { width: string; height: string } {
  return mode === "yearly"
    ? { width: "280", height: "420" }
    : { width: "220", height: "330" };
}

// ─────────────────────────────────────────────────────────────
// RecapEmail component
// ─────────────────────────────────────────────────────────────

export function RecapEmail(props: RecapEmailProps) {
  const { payload, mode, recapUrl, unsubscribeUrl } = props;

  const year = deriveYear(payload);
  const monthName = deriveMonthName(payload);
  const cover = payload.goty?.coverUrl ?? null;
  const gotyTitle = payload.goty?.title ?? null;
  const genre = genreLabel(payload);
  const totalGames = payload.totals.totalGames;
  const { width: coverW, height: coverH } = heroDimensions(mode);

  const heroTitle =
    mode === "yearly"
      ? `Your ${year} in games`
      : `Your ${monthName} ${year}`;

  const ctaLabel = mode === "yearly" ? "See your year →" : "See your month →";

  const previewText =
    mode === "yearly"
      ? `Your ${year} in games — ${totalGames} games, top genre: ${genre}`
      : `Your ${monthName} ${year} recap — ${totalGames} games`;

  // Sparse tier: calm fallback with no hero
  if (payload.tier === "too_sparse") {
    return (
      <Html>
        <Head />
        <Preview>{previewText}</Preview>
        <Body style={bodyStyle}>
          <Container style={containerStyle}>
            <Section style={sparseSectionStyle}>
              <Text style={sparseTextStyle}>
                You haven&apos;t logged enough games yet — keep it up and we&apos;ll send
                you a recap when you do.
              </Text>
            </Section>

            <Hr style={{ borderColor: "#262626", marginTop: 32 }} />
            <Text style={footerStyle}>
              Ploxa
              {" · "}
              <Link href={unsubscribeUrl} style={footerLinkStyle}>
                Unsubscribe
              </Link>
            </Text>
          </Container>
        </Body>
      </Html>
    );
  }

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>

          {/* Hero: cover image */}
          {cover && (
            <Section style={{ textAlign: "center" }}>
              <Img
                src={cover}
                width={coverW}
                height={coverH}
                alt={gotyTitle ?? "Top game cover"}
                style={{ display: "block", margin: "0 auto", borderRadius: 4 }}
              />
            </Section>
          )}

          {/* Hero: title */}
          <Section>
            <Heading as="h1" style={headingStyle}>
              {heroTitle}
            </Heading>
          </Section>

          {/* Hero: stat strip */}
          <Section>
            <Text style={mutedTextStyle}>
              {totalGames} {totalGames === 1 ? "game" : "games"} &middot; {genre}
            </Text>
          </Section>

          {/* Top game name (when present) */}
          {gotyTitle && (
            <Section>
              <Text style={bodyTextStyle}>Top game: {gotyTitle}</Text>
            </Section>
          )}

          {/* CTA */}
          <Section>
            <Link href={recapUrl} style={ctaStyle}>
              {ctaLabel}
            </Link>
          </Section>

        </Container>

        {/* Footer outside inner section to keep email-safe layout */}
        <Container style={{ ...containerStyle, paddingTop: 0 }}>
          <Hr style={{ borderColor: "#262626" }} />
          <Text style={footerStyle}>
            Ploxa
            {" · "}
            <Link href={unsubscribeUrl} style={footerLinkStyle}>
              Unsubscribe
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ─────────────────────────────────────────────────────────────
// Render helpers
// ─────────────────────────────────────────────────────────────

export async function renderRecapHtml(props: RecapEmailProps): Promise<string> {
  return await render(<RecapEmail {...props} />);
}

export function renderRecapPlainText(props: RecapEmailProps): string {
  const { payload, mode, recapUrl, unsubscribeUrl } = props;

  const year = deriveYear(payload);
  const monthName = deriveMonthName(payload);
  const genre = genreLabel(payload);
  const totalGames = payload.totals.totalGames;
  const gotyTitle = payload.goty?.title ?? null;

  const lines: string[] = [];

  if (payload.tier === "too_sparse") {
    lines.push("You haven't logged enough games yet — keep it up and we'll send you a recap when you do.");
    lines.push("");
    lines.push("---");
    lines.push(`Unsubscribe: ${unsubscribeUrl}`);
    return lines.join("\n");
  }

  if (mode === "yearly") {
    lines.push(`Your ${year} in games`);
    lines.push("");
    lines.push(`${totalGames} games logged. Top genre: ${genre}.`);
    if (gotyTitle) {
      lines.push(`Top game: ${gotyTitle}`);
    }
    lines.push("");
    lines.push(`See your full year: ${recapUrl}`);
  } else {
    lines.push(`Your ${monthName} ${year}`);
    lines.push("");
    lines.push(`${totalGames} games logged. Top genre: ${genre}.`);
    if (gotyTitle) {
      lines.push(`Top game: ${gotyTitle}`);
    }
    lines.push("");
    lines.push(`See your full month: ${recapUrl}`);
  }

  lines.push("");
  lines.push("—");
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Subject builder
// ─────────────────────────────────────────────────────────────

export function recapSubject(args: {
  mode: "yearly" | "monthly";
  year: number;
  monthIndex?: number; // 1-based, required when mode is monthly
}): string {
  const { mode, year, monthIndex } = args;

  if (mode === "yearly") {
    return `Your ${year} in games`;
  }

  // Monthly: monthIndex is required
  if (monthIndex === undefined || monthIndex === null) {
    throw new Error("recapSubject: monthIndex is required when mode is 'monthly'");
  }
  if (monthIndex < 1 || monthIndex > 12) {
    throw new RangeError(`recapSubject: monthIndex must be 1-12, got ${monthIndex}`);
  }

  const month = MONTH_NAMES[monthIndex - 1];
  return `Your ${month} ${year} recap`;
}
