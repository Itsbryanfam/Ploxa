"use client";

import { toast } from "sonner";

/**
 * Connector pills on /u/[username]. Renders a compact row of platform
 * pills (Steam, Xbox, Discord) for whichever platforms the profile owner
 * has connected.
 *
 * Click targets per platform:
 *   - Steam → steamcommunity.com/profiles/<steamid64> (Steam redirects to
 *     the vanity URL if the user set one).
 *   - Xbox → xboxgamertag.com/<gamertag> (third-party but reliable — the
 *     official account.xbox.com/Profile only resolves when the viewer is
 *     signed in to an Xbox account, which is unrealistic for share links).
 *   - Discord → no link; click copies the handle. Discord profile URLs
 *     require shared-server membership and aren't publicly resolvable.
 *
 * Brand SVGs are inlined rather than pulled from a package — lucide
 * doesn't ship brand glyphs, and pulling react-icons/simple-icons for
 * three glyphs would balloon the bundle. Paths are CC0 from the brand
 * style guides.
 */
export interface ConnectorPillsProps {
  steam?: { gamertag: string | null; steamId: string } | null;
  xbox?: { gamertag: string | null; xuid: string } | null;
  discord?: string | null;
}

export function ConnectorPills({ steam, xbox, discord }: ConnectorPillsProps) {
  if (!steam && !xbox && !discord) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {steam && (
        <a
          href={`https://steamcommunity.com/profiles/${steam.steamId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          <SteamIcon />
          <span>{steam.gamertag ?? "Steam"}</span>
        </a>
      )}
      {xbox && (
        <a
          href={
            xbox.gamertag
              ? `https://xboxgamertag.com/search/${encodeURIComponent(xbox.gamertag)}`
              : `https://xboxgamertag.com/search/${xbox.xuid}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
        >
          <XboxIcon />
          <span>{xbox.gamertag ?? "Xbox"}</span>
        </a>
      )}
      {discord && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(discord)
              .then(() => toast.success(`Copied ${discord}`))
              .catch(() => toast.error("Couldn't copy handle"));
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          aria-label={`Copy Discord handle ${discord}`}
          title="Click to copy"
        >
          <DiscordIcon />
          <span>{discord}</span>
        </button>
      )}
    </div>
  );
}

// ── Brand glyphs (24×24 path inscribed in 14px container) ─────────────

function SteamIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
    </svg>
  );
}

function XboxIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.555-1.36-4.024-7.013-7.902-10.591-3.878 3.578-9.457 9.231-7.898 10.591zm11.16-14.502c2.961 3.181 7.624 9.621 6.04 12.077C23.02 16.66 24 14.443 24 12c0-3.756-2.297-6.479-2.297-6.479s-.144-.097-.443.026c-1.674.531-3.51 1.835-5.998 4.984zM8.747 5.547C6.249 8.7 4.421 10 2.751 9.467c-.295-.123-.443-.022-.443.022C2.308 9.495 0 12.226 0 12c0 2.443.98 4.66 2.563 6.318C.939 16.181 5.722 9.605 8.747 5.547zM12 3.475c2.171 0 4.515 1.143 4.515 1.143.05.025.115.025.135-.005.012-.022.005-.055-.027-.084 0 0-2.115-2.535-4.623-2.535-2.518 0-4.626 2.535-4.626 2.535-.032.029-.039.062-.027.084.02.03.085.03.135.005 0 0 2.347-1.143 4.518-1.143z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0190 1.3332-.9554 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}
