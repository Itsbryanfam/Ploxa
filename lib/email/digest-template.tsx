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

import type { DigestPayload } from "@/lib/social/notifications/digest";

/**
 * React Email digest template — server-rendered HTML + plain-text fallback.
 *
 * The template renders 5 sections conditionally (empty sections are skipped
 * entirely so a yourWeek-only digest stays clean). All styling is inline
 * via the style prop — email clients (Gmail, Outlook, Apple Mail) strip
 * <style> blocks and external CSS, so inline is the only reliable option.
 *
 * Mascot: uses the existing /mascot/idle.png PNG, rendered at 24x24 via
 * width/height attributes. Email clients respect those regardless of the
 * source asset's intrinsic dimensions.
 */

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

const sectionHeadingStyle = {
  fontSize: 14,
  color: "#a3a3a3",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginTop: 24,
  marginBottom: 8,
};

const itemTextStyle = {
  color: "#e5e5e5",
  fontSize: 14,
  margin: "4px 0",
};

const footerStyle = {
  fontSize: 12,
  color: "#737373",
  marginTop: 32,
};

const footerLinkStyle = {
  color: "#737373",
  textDecoration: "underline" as const,
};

export function DigestEmail(props: {
  payload: DigestPayload;
  unsubscribeUrl: string;
  baseUrl: string;
}) {
  const { payload, unsubscribeUrl, baseUrl } = props;

  return (
    <Html>
      <Head />
      <Preview>Your recap from Letterboxd for Games</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section>
            <Img
              src={`${baseUrl}/mascot/idle.png`}
              width="24"
              height="24"
              alt=""
              style={{ display: "inline-block", marginRight: 8, verticalAlign: "middle" }}
            />
            <Heading
              as="h1"
              style={{ display: "inline", fontSize: 20, color: "#e5e5e5" }}
            >
              Hi @{payload.recipient.username}
            </Heading>
          </Section>

          <Text style={{ color: "#a3a3a3" }}>
            {"Here's what happened since "}
            {payload.since.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}:
          </Text>

          {payload.newFollowers.length > 0 && (
            <Section>
              <Heading as="h2" style={sectionHeadingStyle}>
                Followers
              </Heading>
              <Text style={itemTextStyle}>
                {payload.newFollowers.length} new —{" "}
                {payload.newFollowers.map((f) => `@${f.username}`).join(", ")}
              </Text>
            </Section>
          )}

          {payload.reactions.length > 0 && (
            <Section>
              <Heading as="h2" style={sectionHeadingStyle}>
                Reactions
              </Heading>
              {payload.reactions.map((r, i) => (
                <Text key={i} style={itemTextStyle}>
                  @{r.actor} liked your{" "}
                  {r.kind === "review_liked" ? "review" : "list"} of{" "}
                  <strong>{r.targetTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          {payload.comments.length > 0 && (
            <Section>
              <Heading as="h2" style={sectionHeadingStyle}>
                Comments
              </Heading>
              {payload.comments.map((c, i) => (
                <Text key={i} style={itemTextStyle}>
                  @{c.actor}{" "}
                  {c.kind === "comment_replied"
                    ? "replied to your comment on"
                    : "commented on"}{" "}
                  <strong>{c.targetTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          {payload.wishlistTriggers.length > 0 && (
            <Section>
              <Heading as="h2" style={sectionHeadingStyle}>
                Friends playing your wishlist
              </Heading>
              {payload.wishlistTriggers.map((w, i) => (
                <Text key={i} style={itemTextStyle}>
                  @{w.actor} just started <strong>{w.gameTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          {payload.yourWeek.length > 0 && (
            <Section>
              <Heading as="h2" style={sectionHeadingStyle}>
                Your week
              </Heading>
              {payload.yourWeek.map((y, i) => (
                <Text key={i} style={itemTextStyle}>
                  You {y.kind === "log_completed" ? "completed" : "started"}{" "}
                  <strong>{y.gameTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          <Hr style={{ borderColor: "#262626", marginTop: 32 }} />
          <Text style={footerStyle}>
            <Link
              href={`${baseUrl}/settings/notifications`}
              style={footerLinkStyle}
            >
              Update digest preferences
            </Link>
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

export async function renderDigestHtml(args: {
  payload: DigestPayload;
  unsubscribeUrl: string;
  baseUrl: string;
}): Promise<string> {
  return await render(<DigestEmail {...args} />);
}

export function renderDigestPlainText(args: {
  payload: DigestPayload;
  unsubscribeUrl: string;
}): string {
  const { payload, unsubscribeUrl } = args;
  const lines: string[] = [];
  lines.push(`Hi @${payload.recipient.username},`);
  lines.push("");
  lines.push(`Here's what happened since ${payload.since.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}:`);
  lines.push("");
  if (payload.newFollowers.length > 0) {
    lines.push(
      `FOLLOWERS -- ${payload.newFollowers.length} new: ${payload.newFollowers
        .map((f) => `@${f.username}`)
        .join(", ")}`,
    );
    lines.push("");
  }
  if (payload.reactions.length > 0) {
    lines.push("REACTIONS:");
    for (const r of payload.reactions) {
      lines.push(
        `  @${r.actor} liked your ${r.kind === "review_liked" ? "review" : "list"} of ${r.targetTitle}`,
      );
    }
    lines.push("");
  }
  if (payload.comments.length > 0) {
    lines.push("COMMENTS:");
    for (const c of payload.comments) {
      lines.push(
        `  @${c.actor} ${c.kind === "comment_replied" ? "replied to your comment on" : "commented on"} ${c.targetTitle}`,
      );
    }
    lines.push("");
  }
  if (payload.wishlistTriggers.length > 0) {
    lines.push("WISHLIST:");
    for (const w of payload.wishlistTriggers) {
      lines.push(`  @${w.actor} just started ${w.gameTitle}`);
    }
    lines.push("");
  }
  if (payload.yourWeek.length > 0) {
    lines.push("YOUR WEEK:");
    for (const y of payload.yourWeek) {
      lines.push(
        `  You ${y.kind === "log_completed" ? "completed" : "started"} ${y.gameTitle}`,
      );
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}
