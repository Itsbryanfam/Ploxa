import type { MascotScenario } from "./scenarios";

type CopyContext = Record<string, string | number | undefined>;

const COPY: Record<MascotScenario, string[]> = {
  // === Palette ===
  "palette.idle": [
    "Start typing to search.",
    "What are we logging today?",
    "I'll wait.",
    "Search anything — RAWG has an opinion.",
  ],
  "palette.no-results": [
    "Nothing matches. Try actual spelling?",
    "No hits. RAWG hasn't heard of it.",
    "Empty. The search engine, not your taste.",
    "Zero results. Could be a RAWG gap, could be a typo.",
  ],
  "palette.searching": [
    "Searching...",
    "Looking...",
    "Hold on.",
    "Asking RAWG nicely.",
  ],

  // === Log success ===
  "log.success.completed-high": [
    "{rating} hearts. That's basically a marriage proposal.",
    "{rating} hearts on {title}. Bold endorsement.",
    "Logged. {title} clearly hit.",
    "Strong rating. The Pile thanks you for finishing something.",
  ],
  "log.success.completed-mid": [
    "Logged. Solid pick.",
    "{title} — fair rating.",
    "Logged. Mid-tier banger.",
    "Respectable. Not everything has to be a masterpiece.",
  ],
  "log.success.completed-low": [
    "Logged. Closure achieved.",
    "Done is done.",
    "{title} survived. So did you.",
    "At least it's off the backlog.",
    "Low rating, but you finished it — that's commitment.",
  ],
  "log.success.playing": [
    "On the docket.",
    "Currently playing: noted.",
    "Good luck out there.",
    "The clock starts now.",
  ],
  "log.success.backlog": [
    "Backlog +1. Bold.",
    "Added to The Pile.",
    "Maybe someday.",
    "The Pile grows. As it does.",
  ],
  "log.success.wishlist": [
    "Wishlisted. Sale notifications coming for your wallet.",
    "Saved for later. Like a tab.",
    "Wishlist +1.",
    "Noted. Now wait for a 90% off sale like everyone else.",
  ],
  "log.success.dropped": [
    "Marked dropped. No shame.",
    "Cut your losses.",
    "Moving on.",
    "Some games earn it. Recorded for posterity.",
  ],
  "log.success.on_hold": [
    "Paused. We'll see.",
    "On the shelf.",
    "Maybe later.",
    "On hold — the diplomatic answer.",
  ],

  // === Empty states ===
  "library.empty.all": [
    "Empty shelf. The classic 'I'll start tomorrow' move.",
    "Nothing logged yet. Press Command-K and get on with it.",
    "Empty. Auspicious start.",
    "The shelf is bare. The backlog is not.",
  ],
  "library.empty.playing": [
    "Nothing actively playing.",
    "No active runs.",
    "Free time?",
    "No current game — rare condition.",
  ],
  "library.empty.completed": [
    "No finishes yet. The journey is the reward, etc.",
    "Zero completions. The backlog appreciates your loyalty.",
    "Nothing completed. That's what The Pile wants you to think.",
    "No finished games — a clean slate or a concerning pattern.",
  ],
  "library.empty.backlog": [
    "No backlog. Suspicious.",
    "Empty backlog. Either a lie or a flex.",
    "Backlog empty. Are you okay.",
    "No backlog entries — a statistical anomaly.",
  ],
  "library.empty.wishlist": [
    "No wishlisted games. You're either disciplined or in denial.",
    "Wishlist empty. The sales will wait.",
    "Nothing wishlisted — unprecedented restraint.",
    "Empty wishlist. Someone's lying to themselves.",
  ],
  "library.empty.dropped": [
    "Nothing dropped. Yet.",
    "No dropped games. Stay strong.",
    "Zero drops — impressive or in denial.",
    "Nothing abandoned. The optimism is noted.",
  ],
  "library.empty.on_hold": [
    "Nothing paused.",
    "No games on hold.",
    "Empty hold list. Every game got a verdict.",
    "Nothing on hold — decisive.",
  ],

  // === Dashboard greetings ===
  "dashboard.greeting.morning": [
    "Morning.",
    "Up early.",
    "Coffee first.",
    "Morning. The backlog is already judging you.",
  ],
  "dashboard.greeting.afternoon": [
    "Afternoon.",
    "Welcome back.",
    "Afternoon. The Pile hasn't shrunk.",
    "Back again. Good.",
  ],
  "dashboard.greeting.evening": [
    "Evening.",
    "Logging hours, I see.",
    "Welcome back.",
    "Evening. One more session before bed, probably.",
  ],
  "dashboard.greeting.night": [
    "Late one tonight.",
    "Bedtime soon?",
    "Just one more.",
    "Still here. The Pile is impressed.",
  ],
  "dashboard.greeting.long-absence": [
    "Been a while. Welcome back.",
    "It's been {days} days. We missed you.",
    "{days} days off. The backlog grew anyway.",
    "Look who's back. The Pile didn't go anywhere.",
  ],
  "dashboard.greeting.actively-playing": [
    "Still on {title}? Respect.",
    "{days} days into {title} — close to finishing?",
    "{title} is getting its money's worth.",
    "{days} days in. Either a great game or a long one.",
  ],

  // === Errors ===
  "error.404": [
    "This game doesn't exist. Or maybe you do.",
    "404. Try a different URL.",
    "Nothing here. Either a broken link or a fever dream.",
    "Page not found. The backlog knows the feeling.",
  ],
  "error.500": [
    "Something broke. Not your fault. Probably.",
    "500. Refresh, maybe?",
    "The server's having a moment. Give it a sec.",
    "Internal error. Classic.",
  ],
  "error.rate-limited": [
    "RAWG is napping. Try in a minute.",
    "Slow down — we're rate-limited.",
    "Too many requests. Take a breath.",
    "Rate-limited. Even the API needs a break.",
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

export interface GreetingContext {
  /** Local hour 0-23. Null means "decide client-side" — server can't know
   *  the user's tz, and a server-derived hour leaks UTC to non-UTC users. */
  hour: number | null;
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
  // Time of day — fall back to the user's local hour when hour is null.
  // dashboardGreeting is consumed inside MascotGreeting ("use client"), so
  // `new Date().getHours()` resolves against the browser's timezone.
  const hour = ctx.hour ?? new Date().getHours();
  if (hour < 5) return copy("dashboard.greeting.night");
  if (hour < 12) return copy("dashboard.greeting.morning");
  if (hour < 17) return copy("dashboard.greeting.afternoon");
  if (hour < 22) return copy("dashboard.greeting.evening");
  return copy("dashboard.greeting.night");
}
