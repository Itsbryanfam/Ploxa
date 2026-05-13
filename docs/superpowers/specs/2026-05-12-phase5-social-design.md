# Phase 5 — Social Layer — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-12 |
| **Phase** | 5 of 7 |
| **Status** | Approved |
| **Goal** | Network-effects layer — follow/unfollow, public profile overview hub, chronological activity feed, threaded one-level comments, lists with reorder, in-app notifications + tri-state email digest, split discovery routes, and report/block/auto-flag moderation. End-of-phase = beta launch milestone with Letterboxd-equivalent social parity. |
| **Verification gate** | Two test accounts can follow each other, see each other's activity in feed, comment on each other's reviews, get notifications, create a list, share its URL. Bidirectional block hides both directions. Auto-flag detects link-density spam. Admin queue resolvable. Weekly digest delivered with working unsubscribe. (10 automated + 5 manual criteria, see verify gate table at end.) |
| **Plan reference** | `~/.claude/plans/smooth-herding-flame.md` (Phase 5 — line 266) |
| **Companion HTML** | `docs/phase5-design.html` (rendered later) |

---

## Context

Phase 4 closed on 2026-05-12 (tag `phase-4-complete`, commit `0f4ea49`). Taste fingerprint + recommendations shipped — vector aggregation, AI narrative, hybrid recommendation engine with mood/time/platform filters, trading-card OG endpoint, daily drift cron. The app is feature-complete as a single-user tracker with an AI taste layer.

Phase 5 turns the dial: the app becomes social. Follow graph, activity feed, comments on reviews, public profile redesign into an overview hub, lists with reorder, in-app notifications + email digest, split discovery routes (`/discover/games`, `/discover/reviews`, `/discover/people`), and basic moderation (report + bidirectional block + rule-based auto-flag).

Pre-Phase-5 infrastructure already landed via the Codex audit fix branch (`audit-fixes-2026-05-13`, merged at `1ce8a38`):
- Migration `0007_pre_phase5_constraints.sql` — `follows` self-block CHECK, `comments.parent_id` FK + same-review trigger, partial unique indexes on reviews and recommendations, notifications inbox index
- Policies `0002_phase5_prep.sql` — defense-in-depth RLS on `review_questions` + `comments`

Testing infrastructure (Vitest + Playwright) landed on 2026-05-13 (commit `78ddbd8`). 132 tests pass in ~12s end-to-end.

Phase 5 is the **beta launch milestone** per the master plan. After Phase 5 the app has Letterboxd-equivalent social feature parity with a distinctive aesthetic + AI taste layer — the unclaimed visual position the project bets on.

**Scope this phase: full master-plan deliverable.** All 9 surfaces named in plan line 266 ship: follow/unfollow, public profile (overview hub), activity feed, threaded comments, lists with reorder, notifications + email digest cadence, split discovery routes, basic moderation. Email digest goes beyond exact plan wording with a tri-state cadence (off/daily/weekly) instead of a single boolean.

This spec was produced via brainstorming on 2026-05-12 (text-only, user on mobile). Decisions recorded inline in the Decision Log; user defaulted to recommendation on 7 of 8 questions, picked the more ambitious split-routes option on the 8th (Q6 Discovery).

---

## Locked Design Principles (apply throughout)

1. **Pull on read, not fanout on write.** Activity feed is computed by UNION-ing live source tables (logs + reviews + lists) at request time. No `activity_events` table. Pull is correct for our scale (10k users, single/double-digit follow graphs); fanout amplifies writes and locks the event schema early.

2. **Material events only in feed.** Status changes (`backlog → playing → completed`, etc.), rating set or changed (not cleared — clearing your rating isn't a positive social signal), review publish, and list publish make the feed. Skip backlog-adds entirely so Steam imports don't dump 200 rows into followers' feeds. Comments/likes/follows fire notifications but never feed rows.

3. **Bidirectional block with logged-out exception.** Blocking auto-breaks mutual follows, cascades to strip prior likes and delete prior comments, and hides both directions when logged in. A logged-out determined viewer can still see public content — we don't gate cookieless traffic by IP/fingerprint (overkill and unreliable). Real harassment protection without misleading "totally invisible" promises.

4. **Block-filter chokepoint, not RLS.** Every social read query passes through `withBlockedFilter(viewerId, query, authorIdColumn)` from `lib/social/_shared/visibility.ts`. We use `service_role` on server (bypasses RLS by design — see audit findings #3/#23), so the filter is an application-layer concern. Forgetting the helper on a read path is a leak; Vitest unit tests guard against drift.

5. **Notification chokepoint, not direct INSERT.** Every social side-effect emits notifications via `lib/social/notifications/emit.ts`. The chokepoint handles: self-notify silence, blocked-pair silence, and ON CONFLICT dedupe (one row per `(user_id, type, target_id, actor_id)` — likes can spam but the inbox doesn't). Never INSERT into `notifications` directly from a server action.

6. **Auto-flag rules, not AI.** Comment moderation is rule-based (link density, all-caps ratio, repeat-char detection, blocklist phrases). <1ms per call, $0 cost, Vitest-friendly. AI moderation has false-positive risk on legitimate harsh reviews ("this game is fucking awful" is valid) and adds 500-2000ms to comment-post latency. Plan said "simple auto-flag"; rules match that.

7. **Tri-state email cadence, weekly default.** `profiles.email_digest_cadence enum('off','daily','weekly')`. One daily cron, one digest template, three sending behaviors. Goes slightly beyond plan wording ("email digest vs in-app only") in the direction of respecting inbox preferences without adding settings-page complexity.

8. **Profile root = overview hub.** `/u/[username]` becomes a multi-section homepage: header → stats strip → taste card snippet → top 3 lists → recent 3 reviews → library shelf (truncated). Each section has "See all →" to a sub-route. Library moves from the root to `/u/[username]` body section (not deleted — just no longer the primary content).

9. **Discovery split into three pages.** `/discover` lands; `/discover/games`, `/discover/reviews`, `/discover/people` are siblings. Better SEO segmentation than a single page; more browsable destination than cockpit cards. Each sub-page runs an on-demand SQL aggregate (popular-games and trending-reviews) or on-demand cosine pass (similar-users) — no precompute, no new materialization table.

10. **Mascot stays in its lane.** Empty-states + celebrations only (digest header pixel, "first list" celebration, "no notifications" empty state). Never near moderation/reporting/blocking — those flows are emotionally fraught and the mascot's celebratory tone would be wrong. Same rule as Phase 4.

---

## Decision Log

Eight clarifying questions locked the architecture before design sections were written.

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | What's the scope envelope? | **Full master-plan scope** | All 9 surfaces, including email digest + auto-flag spam. Matches ambitious-default pattern from Phases 3 & 4. |
| 2 | Activity feed strategy? | **Pull on read** | Cleaner schema, no new table, easier to extend, fits our scale (10k users with small follow graphs). Fanout amplifies writes; hybrid is premature optimization. |
| 3 | Feed unit of activity? | **Material events only** | Status changes + rating set/changed + review publish + list publish. Skip backlog-adds (prevents import-spam from flooding followers). Comments/likes/follows fire notifications, not feed rows. |
| 4 | Block semantics? | **Bidirectional w/ logged-out exception** | Twitter-style. Auto-breaks mutual follows, mutual content invisibility when logged in. Don't try to gate cookieless traffic (unreliable). |
| 5 | Auto-flag approach? | **Rule-based heuristics** | Matches plan's "simple auto-flag" language. <1ms, $0, no false-positive risk on legit reviews. Mod-queue routing (no auto-delete). Can upgrade to AI in a future phase. |
| 6 | Discovery shape? | **Split routes** | `/discover/games`, `/discover/reviews`, `/discover/people` siblings + `/discover` landing. Better SEO than single page, more browsable than cockpit cards. |
| 7 | Comments UI? | **Indented one-level** | Most familiar Reddit-shallow pattern. Easiest mobile scan. Soft-delete preserves "[deleted]" nodes so reply chains stay intact. |
| 8 | Notification preferences? | **Tri-state email cadence** | `off`/`daily`/`weekly` enum on `profiles`. Same template, one daily cron. Goes slightly beyond plan but costs nothing extra in code. |

### Design-section bake-ins (no question — single defensible answer)

- **Block-filter placement:** TypeScript helper, not Postgres VIEW (debug hostility), not RLS (we use service_role on server).
- **List likes table:** Separate `list_likes(user_id, list_id)`, not generalizing `likes` to `reactions(target_type, target_id)`. Avoids touching every existing call site.
- **Profile page shape:** Overview hub with section teasers → sub-routes for deep views.
- **Mascot role:** Empty states + celebrations only.
- **`@username` mentions:** Reuse `review_commented` notification (recipient = mentioned user, deduped against author notification).
- **Wishlist trigger:** Fires when a followed user logs a game where viewer has `log.status='wishlist'`. Wishlist is a log status; no separate table.
- **Email cron cadence:** Single daily 12:00 UTC cron; selects `cadence='daily' OR (cadence='weekly' AND now()::dow = 0)` (Sunday for weekly).
- **Email unsubscribe:** JWT-signed token, no expiry, public route outside `(app)` group.

---

## Information Architecture

### Routes

| Route | Auth | Purpose | Render strategy |
|---|---|---|---|
| `/u/[username]` *(redesign)* | Public-or-owner | Overview hub: header + stats + taste card + recent 3 reviews + top 3 lists + library shelf (truncated) | RSC + client islands for follow button |
| `/u/[username]/lists` *(new)* | Public-or-owner | All of user's public lists (grid) | RSC |
| `/u/[username]/lists/[listSlug]` *(new)* | Public-or-owner (per-list `is_public`) | List detail with reorderable cards (owner) | RSC + client reorder for owner |
| `/u/[username]/followers` *(new)* | Public-or-owner | Followers list with follow-back buttons | RSC |
| `/u/[username]/following` *(new)* | Public-or-owner | Following list | RSC |
| `/home/feed` *(new)* | Required | Activity feed (chronological material events from follows) | RSC with cursor pagination |
| `/notifications` *(new)* | Required | Inbox: unread first, then read; filter chips by type | RSC + client islands for mark-read |
| `/discover` *(new)* | Public | Landing with section previews → links to 3 sub-pages | RSC |
| `/discover/games` *(new)* | Public | Popular games this week (log-count) | RSC, 30-min `unstable_cache` |
| `/discover/reviews` *(new)* | Public | Trending reviews (like-count last 7d) | RSC, 30-min cache + post-block-filter |
| `/discover/people` *(new)* | Required | Similar taste users (on-demand cosine) | RSC, no caching |
| `/lists/new` *(new)* | Required | List creation form | RSC + client form |
| `/lists/[id]/edit` *(new)* | Owner-only | List edit + reorder + add/remove items | RSC + client (@dnd-kit) |
| `/settings/notifications` *(new)* | Required | Cadence radio + "send sample digest" button | RSC + form action |
| `/settings/blocked` *(new)* | Required | Blocked users list + unblock | RSC |
| `/admin/reports` *(new)* | Admin-only | Moderation queue (pending + auto-flagged) | RSC; access via `ADMIN_USER_IDS` env |
| `/unsubscribe` *(new)* | Public (token-gated) | Email unsubscribe confirmation | RSC outside `(app)` group |

### Entry points

1. **Sidebar nav** gains: `Feed`, `Discover`, `Notifications` (with unread-count badge)
2. **Profile page header** gains: `Follow` / `Following ✓` / `Block` overflow + `N followers` / `N following` count links
3. **Review canonical page** gains: `Like` button + count, `Comments` section below body, `Report` overflow menu item
4. **List detail page** gains: `Like` button (no comments — lists are review-adjacent, not discussion threads)
5. **Cockpit dashboard** keeps existing cards; new card: `Recent activity` (last 3 feed items) when user has ≥1 follow
6. **Game detail page** gains: `Add to list` button (modal lets you pick or create a list)
7. **Empty state on `/home/feed` when no follows**: pixel mascot + "Find people to follow →" CTA to `/discover/people`

### Sidebar nav order (final)

Home · **Feed** · Library · Play next · **Discover** · **Notifications** (badge) · *(profile dropdown)*

"Home" stays as the cockpit dashboard. "Feed" is the new social destination. Notifications and Discover are siblings.

---

## Architecture

### Module layout

```
lib/
├── social/
│   ├── _shared/
│   │   ├── visibility.ts         # withBlockedFilter, isBlockedBetween
│   │   ├── cursors.ts            # encode/decode feed cursor
│   │   └── profile-summary.ts    # getProfileSummary(username, viewerId)
│   ├── follows/
│   │   ├── server-actions.ts     # follow, unfollow, getFollowers, getFollowing
│   │   └── triggers.ts           # onFollow → emit new_follower
│   ├── blocks/
│   │   ├── server-actions.ts     # block, unblock, getBlocked
│   │   └── side-effects.ts       # onBlock — break follow, cascade likes/comments
│   ├── feed/
│   │   ├── queries.ts            # buildFeedQuery (UNION ALL over 3 sources)
│   │   └── server-actions.ts     # getFeed(viewerId, cursor)
│   ├── comments/
│   │   ├── server-actions.ts     # create, edit, softDelete, reply
│   │   ├── mentions.ts           # parseMentions, resolveMentionedUserIds
│   │   └── triggers.ts           # onComment → review_commented or comment_replied
│   ├── reactions/
│   │   └── server-actions.ts     # likeReview, likeList, etc.
│   ├── lists/
│   │   ├── server-actions.ts     # CRUD + slug + publish + reorder
│   │   ├── slug.ts               # slugifyTitle + uniqueness
│   │   └── triggers.ts           # onListPublish (feed-relevant)
│   ├── notifications/
│   │   ├── emit.ts               # single chokepoint with ON CONFLICT dedupe
│   │   ├── server-actions.ts     # getInbox, markRead, markAllRead, getUnreadCount
│   │   └── digest.ts             # buildDigest(userId)
│   ├── discovery/
│   │   ├── popular-games.ts      # SQL aggregate: top N by log count last 7d
│   │   ├── trending-reviews.ts   # SQL aggregate: top N by like count last 7d
│   │   └── similar-users.ts      # on-demand cosine sim
│   └── moderation/
│       ├── rules.ts              # checkSpamRules(body)
│       ├── server-actions.ts     # createReport, resolveReport (admin)
│       └── admin.ts              # isAdmin(userId) — env allowlist
└── email/
    └── digest-template.tsx        # React Email template

components/
├── social/        # follow-button, block-action, profile-overview-header, followers-grid
├── feed/          # feed-list, feed-item-log, feed-item-review, feed-item-list, feed-empty-state
├── comments/      # comment-thread, comment-card, comment-composer, flagged-badge
├── lists/         # list-card, list-detail, list-editor (w/ @dnd-kit), add-to-list-modal
├── notifications/ # notification-bell, notification-row, digest-preview
├── discovery/     # popular-games-grid, trending-reviews-list, similar-users-row
└── moderation/    # report-modal, reports-queue, moderation-actions

app/(app)/
├── home/feed/page.tsx
├── notifications/page.tsx
├── discover/{page, games/page, reviews/page, people/page}.tsx
├── lists/{new/page, [id]/edit/page}.tsx
├── settings/{notifications/page, blocked/page}.tsx
├── admin/reports/page.tsx
└── u/[username]/
    ├── page.tsx                  # REDESIGN: overview hub
    ├── lists/page.tsx            # NEW
    ├── lists/[listSlug]/page.tsx # NEW
    ├── followers/page.tsx        # NEW
    └── following/page.tsx        # NEW

app/unsubscribe/route.ts            # public, JWT-gated

supabase/functions/
└── digest-email/index.ts          # daily cron, builds digest, sends via Resend
```

### Schema additions — migration `0008_phase5_social.sql`

Hand-written (like 0007). Drizzle doesn't emit `CREATE TYPE`, `ALTER TYPE … ADD VALUE`, polymorphic FK avoidance, or our intended `notifications_dedupe_uniq` shape cleanly.

```sql
-- ─── Blocks graph (bidirectional with logged-out exception) ─────────
CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_blocker_idx ON blocks (blocked_id, blocker_id);

-- ─── List reactions (parallel to review likes, kept separate) ───────
CREATE TABLE list_likes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, list_id)
);
CREATE INDEX list_likes_list_id_idx ON list_likes (list_id);

-- ─── Moderation reports queue (polymorphic target) ──────────────────
CREATE TYPE report_target_type AS ENUM ('comment','review','list','profile');
CREATE TYPE report_status AS ENUM ('pending','resolved_action_taken','resolved_no_action','auto_flagged');

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type report_target_type NOT NULL,
  target_id uuid NOT NULL,        -- polymorphic, no FK
  reason text NOT NULL,           -- short code: spam|harassment|spoiler|off_topic|other
  details text,
  status report_status NOT NULL DEFAULT 'pending',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolver_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_created_idx ON reports (status, created_at DESC);

-- ─── Lists: slug + published_at + indexes ───────────────────────────
ALTER TABLE lists
  ADD COLUMN slug text NOT NULL DEFAULT '',
  ADD COLUMN published_at timestamptz;
UPDATE lists SET slug = lower(regexp_replace(title,'[^a-z0-9]+','-','gi')) WHERE slug = '';
CREATE UNIQUE INDEX lists_user_slug_uniq ON lists (user_id, slug);
CREATE INDEX lists_user_published_idx ON lists (user_id, published_at DESC) WHERE published_at IS NOT NULL;

-- ─── Logs: feed event tracking (denormalize most-recent transition) ──
ALTER TABLE logs
  ADD COLUMN last_event_at timestamptz,
  ADD COLUMN last_event_type text;  -- 'status_change' | 'rating_set'
UPDATE logs SET last_event_at = updated_at, last_event_type = 'status_change'
  WHERE last_event_at IS NULL;
CREATE INDEX logs_user_event_idx ON logs (user_id, last_event_at DESC)
  WHERE last_event_at IS NOT NULL;

-- ─── Reviews: feed index (idempotent — may exist already) ───────────
CREATE INDEX IF NOT EXISTS reviews_user_published_idx
  ON reviews (user_id, published_at DESC) WHERE published_at IS NOT NULL;

-- ─── Comments: moderation flag + ordering ───────────────────────────
ALTER TABLE comments ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;
CREATE INDEX comments_review_created_idx ON comments (review_id, created_at DESC);

-- ─── Profiles: email digest preference + send timestamp ─────────────
CREATE TYPE email_digest_cadence AS ENUM ('off','daily','weekly');
ALTER TABLE profiles
  ADD COLUMN email_digest_cadence email_digest_cadence NOT NULL DEFAULT 'weekly',
  ADD COLUMN last_digest_sent_at timestamptz;

-- ─── Notification dedupe + enum extension ──────────────────────────
CREATE UNIQUE INDEX notifications_dedupe_uniq
  ON notifications (user_id, type, target_id, actor_id);
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'comment_replied';
```

**Drizzle `schema.ts` mirror** lands in the same commit. `ALTER TYPE … ADD VALUE` and `CREATE TYPE … ENUM` stay only in SQL; Drizzle enums are imported with `pgEnum()` referencing the existing name.

**RLS policies** mirror Phase 4's defense-in-depth pattern in `lib/db/policies/0003_phase5_prep.sql`:
- `blocks` — own rows only (`auth.uid() = blocker_id`)
- `list_likes` — INSERT/DELETE by `user_id`; SELECT to all (for like counts)
- `reports` — INSERT by any authenticated; SELECT by reporter (own) + admin; UPDATE by admin only

### Why this shape

- **Polymorphic `reports.target_id`** (no FK) is right when the type discriminator is small (4 variants) and writes are rare. Adding 4 separate FKs would lock the schema for any future target type. Lookup queries always carry the `target_type` discriminator.
- **`logs.last_event_at` denormalized** (instead of separate `log_events` history) trades transition history for cheap feed queries. We lose "X moved Hades from backlog → playing → completed" as 3 feed rows — only the most recent transition appears. Right tradeoff for Phase 5; can add history later.
- **`comments.is_hidden`** is the auto-flag landing zone. Rules pipeline sets it true. Admin actions on `reports` may also set it. Read queries union `is_hidden = false OR userId = viewer` so authors still see their own hidden content (with a "pending review" badge).
- **`notifications_dedupe_uniq`** enables ON CONFLICT in `emit()` — like-spam collapses into one inbox row with bumped `created_at` and cleared `read_at`. Letterboxd allows duplicates; we don't.

### What I'm explicitly NOT adding

- **No `activity_events` table** — pull-on-read locked at Q2.
- **No `reactions` generalization of `likes`** — parallel `list_likes` is simpler.
- **No `notification_prefs` table** — coarse tri-state lives on `profiles`.
- **No `wishlist` table** — wishlist is still `log.status='wishlist'`.

---

## Four key code shapes

### 1. `withBlockedFilter` — bidirectional block enforcement

Every social read query passes through this. Forgetting it on one path = a leak; Vitest unit tests guard against drift.

```ts
// lib/social/_shared/visibility.ts
export function withBlockedFilter<Q extends PgSelect>(
  viewerId: string | null,
  query: Q,
  authorIdColumn: AnyPgColumn,
): Q {
  if (!viewerId) return query;  // logged-out: no block filtering (Q4 exception)
  return query.where(
    and(
      notExists(db.select({ x: sql`1` }).from(blocks)
        .where(and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, authorIdColumn)))),
      notExists(db.select({ x: sql`1` }).from(blocks)
        .where(and(eq(blocks.blockerId, authorIdColumn), eq(blocks.blockedId, viewerId)))),
    ),
  );
}
```

### 2. `buildFeedQuery` — pull-on-read UNION ALL

```ts
// lib/social/feed/queries.ts (pseudo)
const followeeIds = await db.select({ id: follows.followedId })
  .from(follows).where(eq(follows.followerId, viewerId));
if (followeeIds.length === 0) return { items: [], nextCursor: null };

return db.execute(sql`
  (SELECT 'log'::text AS kind, user_id, last_event_at AS event_at, last_event_type, ...
   FROM logs WHERE user_id = ANY(${followeeIds}) AND last_event_at IS NOT NULL
     AND is_private = false ${cursorClause})
  UNION ALL
  (SELECT 'review'::text, user_id, published_at, NULL, ...
   FROM reviews WHERE user_id = ANY(${followeeIds}) AND published_at IS NOT NULL
     AND is_public = true ${cursorClause})
  UNION ALL
  (SELECT 'list'::text, user_id, published_at, NULL, ...
   FROM lists WHERE user_id = ANY(${followeeIds}) AND published_at IS NOT NULL
     AND is_public = true ${cursorClause})
  ORDER BY event_at DESC LIMIT 50;
`).then(rows => rows.filter(r => !isBlockedBetween(viewerId, r.actorId)));
```

Cursor is `(eventAt, kind, actorId)` triplet base64-encoded — tiebreak prevents missed rows when multiple events share a timestamp. UNION ALL doesn't compose with `notExists` cleanly, so block-filter is applied as a post-hoc row filter (acceptable: max 50 rows, isBlockedBetween is O(1) per check with the right index).

### 3. `checkSpamRules` — pure rule-based auto-flag

```ts
// lib/social/moderation/rules.ts
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const REPEAT_RE = /(.)\1{6,}/;

export function checkSpamRules(body: string): { isFlagged: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const urlCount = (body.match(URL_RE) ?? []).length;
  if (urlCount >= 3) reasons.push("link_density");
  if (body.length >= 30) {
    const letters = body.replace(/[^A-Za-z]/g, "").length || 1;
    const caps = (body.match(/[A-Z]/g) ?? []).length;
    if (caps / letters > 0.7) reasons.push("all_caps");
  }
  if (REPEAT_RE.test(body)) reasons.push("repeat_chars");
  // + blocklist phrase Set check
  return { isFlagged: reasons.length > 0, reasons };
}
```

<1ms per call. Vitest truth-table suite covers boundaries (URL count at 2 vs 3, length at 29 vs 30, caps ratio at 69% vs 70%, repeat count at 6 vs 7).

### 4. `emit` — notification chokepoint

```ts
// lib/social/notifications/emit.ts
export async function emit(args: {
  type: NotificationType;
  recipientUserId: string;
  actorUserId: string;
  targetId: string;
}): Promise<void> {
  if (args.recipientUserId === args.actorUserId) return;
  if (await isBlockedBetween(args.recipientUserId, args.actorUserId)) return;
  await db.insert(notifications).values({
    userId: args.recipientUserId,
    type: args.type,
    targetId: args.targetId,
    actorId: args.actorUserId,
  }).onConflictDoUpdate({
    target: [notifications.userId, notifications.type, notifications.targetId, notifications.actorId],
    set: { createdAt: sql`excluded.created_at`, readAt: null },
  });
}
```

`notifications_dedupe_uniq` index from migration 0008 enables the ON CONFLICT. Bumping `created_at` and clearing `read_at` re-surfaces the notification when a repeat action happens.

---

## Data flows

### Feed read

```
GET /home/feed
   │
   ▼ RSC server component
getFeed(viewerId, cursor=null)
   │
   ├─▶ getFolloweeIds(viewerId) — strips followees who blocked viewer
   │       │
   │       └─ if empty → render <FeedEmptyState/> with "Find people →"
   │
   ├─▶ buildFeedQuery: UNION ALL across logs+reviews+lists
   │       (cursor predicate, ORDER BY event_at DESC LIMIT 50)
   │
   ├─▶ post-hoc block filter on result rows
   │
   ├─▶ hydrate game covers + author profiles (one IN-array fetch each, parallel)
   │
   └─▶ render <FeedList items={...} nextCursor={...} />
```

### Comment post with auto-flag

```
[user submits comment composer]
   │
   ▼ server action createComment(body, reviewId, parentId?)
requireAuth() → viewerId
   │
   ├─▶ Block check: cannot comment if author blocked viewer (or vice versa)
   │
   ├─▶ checkSpamRules(body) → { isFlagged, reasons }
   │
   ├─▶ INSERT comments (..., is_hidden = isFlagged)
   │       same-review trigger from 0007 validates parent_id integrity
   │
   ├─▶ IF isFlagged:
   │       INSERT reports (target_type='comment', status='auto_flagged', reason=reasons[0])
   │
   ├─▶ parseMentions(body) + resolveMentionedUserIds()
   │
   ├─▶ emit notification:
   │       review_commented (review author, only if top-level comment)
   │       comment_replied (parent comment author, if reply)
   │       review_commented (each mentioned user, dedupe-skipped if already emitted)
   │
   └─▶ revalidatePath(`/u/{username}/reviews/{slug}`)
```

### Block enacted

```
POST block(blockedUserId)
   │
   ▼ server action
requireAuth() → blockerUserId
   │
   ├─▶ INSERT blocks (blocker, blocked) ON CONFLICT DO NOTHING
   │
   ├─▶ DELETE follows WHERE (follower=A, followed=B) OR (follower=B, followed=A)
   │
   ├─▶ DELETE list_likes WHERE user_id = blockedUserId
   │       AND list_id IN (SELECT id FROM lists WHERE user_id = blockerUserId)
   │
   ├─▶ DELETE likes WHERE user_id = blockedUserId
   │       AND review_id IN (SELECT id FROM reviews WHERE user_id = blockerUserId)
   │
   ├─▶ DELETE comments WHERE user_id = blockedUserId
   │       AND review_id IN (SELECT id FROM reviews WHERE user_id = blockerUserId)
   │
   └─▶ revalidatePath('/home/feed') + revalidatePath(`/u/{blockerUsername}`)
```

---

## Notifications + email digest pipeline

### Trigger map

| Type | Recipient | Actor | Target | Fires when | Idempotency |
|---|---|---|---|---|---|
| `new_follower` | followed user | follower | follower.id | INSERT into `follows` | Per-(follower,followed) via FK PK |
| `review_liked` | review author | liker | review.id | INSERT into `likes` (not self) | `notifications_dedupe_uniq` |
| `list_liked` | list author | liker | list.id | INSERT into `list_likes` | Same |
| `review_commented` | review author | commenter | review.id | Top-level comment OR mention | Same |
| `comment_replied` | parent author | replier | parent_comment.id | Comment with parent_id NOT NULL | Same |
| `wishlist_logged_by_friend` | wishlister | logger | game.id | Followee transitions `log.status` → `playing` or `completed` on a game where wishlister has `log.status='wishlist'` | Per-(wishlister, type, game, friend) |

### Skip cases
- Self-action
- Actor blocked by recipient (or vice versa)
- Recipient has `cadence='off'` — still records in-app, just skipped in digest

### Inbox UI (`/notifications`)

- Header: "Notifications · N unread · [Mark all read]"
- Filter chips: All / Follows / Reactions / Comments / Wishlist (horizontal scroll on mobile)
- Rows: unread tinted with left accent bar; each row = actor avatar + sentence + `relativeTime` + click area
- Click row → mark single row read + navigate to target
- Empty state: pixel mascot + "No notifications yet. Try saying hi to someone."
- Pagination: server cursor `(created_at, id)` → 50 per page; no virtual scroll for Phase 5

### Email digest

**Cron:** Daily Supabase Edge Function `digest-email` at 12:00 UTC. Selects:

```sql
SELECT user_id, email, email_digest_cadence, last_digest_sent_at
FROM profiles p JOIN auth.users u ON u.id = p.user_id
WHERE
  (email_digest_cadence = 'daily'
   OR (email_digest_cadence = 'weekly' AND extract(dow FROM now()) = 0))
  AND (last_digest_sent_at IS NULL OR last_digest_sent_at < now() - interval '20 hours');
```

**`buildDigest(userId)` returns** `{ since: Date, items: { ... } } | null`. Null if no actionable items since last send. Pure function — easy Vitest.

**Content shape:**
```
Hi @alice,

Here's what happened on Letterboxd for Games since Monday:

[FOLLOWERS]   3 new — @bob @carol @dan
[ACTIVITY]    @bob and @carol liked your review of Hades
              @dan commented on your review of Disco Elysium: "this hit harder..."
[WISHLIST]    @ed just started Outer Wilds — it's on your wishlist
[YOUR WEEK]   You completed Hollow Knight

—
[Update digest preferences] · [Unsubscribe]
```

- React Email template, server-rendered, inline CSS
- 24px mascot pixel in header (only place mascot appears in email)
- Plain-text fallback
- Resend with `RESEND_DIGEST_FROM_ADDRESS` env var (separate sender from transactional auth emails)
- Batch send: 100 recipients/call, concurrency 5

**Unsubscribe flow:**
- Footer link → `https://.../unsubscribe?token=<JWT>`
- JWT signed with `UNSUBSCRIBE_SECRET`, payload `{ userId, iat }`, no expiry
- Route is `app/unsubscribe/route.ts` (outside `(app)` group, no auth required)
- Verifies JWT → sets `email_digest_cadence='off'` → confirmation page with mascot + link to settings

**Scale:** ~1k users at full beta → ~1k weekly emails = ~$0.10/week on Resend (3k/mo free covers us many times over).

---

## Discovery specifics

### `/discover/games` — Popular games this week

```sql
SELECT g.id, g.slug, g.title, g.cover_url, count(l.id) AS log_count
FROM logs l JOIN games g ON g.id = l.game_id
WHERE l.created_at > now() - interval '7 days' AND l.is_private = false
GROUP BY g.id ORDER BY log_count DESC LIMIT ${limit};
```

- 30-minute `unstable_cache` TTL (popularity doesn't need sub-minute freshness)
- Layout: 6-col grid desktop, 2-col mobile
- Public route, OG: "Popular games this week on Letterboxd for Games"

### `/discover/reviews` — Trending reviews

```sql
SELECT r.id, r.body, r.published_at, r.user_id, g.slug, g.title, g.cover_url,
       p.username, p.display_name, count(lk.user_id) AS like_count
FROM likes lk
JOIN reviews r ON r.id = lk.review_id
JOIN games g ON g.id = r.game_id
JOIN profiles p ON p.user_id = r.user_id
WHERE lk.created_at > now() - interval '7 days'
  AND r.is_public = true AND r.published_at IS NOT NULL
  AND p.is_public = true
GROUP BY r.id, g.slug, g.title, g.cover_url, p.username, p.display_name
ORDER BY like_count DESC LIMIT ${limit};
```

- Same 30-minute cache
- Block-filter applied post-query (route-level cache can't be viewer-aware)
- Vertical list of review cards (cover thumbnail + title + hook excerpt + author chip + like count + relative time)

### `/discover/people` — Similar taste users

```ts
const viewerFp = await db.query.tasteFingerprints.findFirst({ where: ... });
if (tierForUser(viewerFp.totalLogsAtGeneration) === 'empty') return [];

const candidates = await db.execute(sql`
  SELECT tf.user_id, tf.genre_vector, tf.theme_vector, tf.mechanic_vector,
         p.username, p.display_name, p.avatar_url, tf.total_logs_at_generation
  FROM taste_fingerprints tf JOIN profiles p ON p.user_id = tf.user_id
  WHERE p.is_public = true AND tf.user_id != ${viewerId}
    AND tf.total_logs_at_generation >= 10
    AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ${viewerId} AND followed_id = tf.user_id)
    AND NOT EXISTS (SELECT 1 FROM blocks WHERE
          (blocker_id = ${viewerId} AND blocked_id = tf.user_id) OR
          (blocker_id = tf.user_id AND blocked_id = ${viewerId}))
  ORDER BY tf.vectors_generated_at DESC LIMIT 500
`);

const scored = candidates.rows.map(c => ({ ...c, similarity: 1 - drift(viewerFp, c) }));
return scored.sort((a,b) => b.similarity - a.similarity).slice(0, limit);
```

- No caching (fingerprints update, freshness matters)
- Reuses Phase 4's `cosineSim` + `drift` from `lib/taste/vectors.ts`
- Auth-required, `noindex` on the route
- Card layout: avatar + display name + username + tier badge + 2-3 resonant genres + Follow button

### Sitemap

- `/discover`, `/discover/games`, `/discover/reviews` — indexed, sitemap entries, refreshed weekly
- `/discover/people` — `noindex` (auth-gated, personalized)

### Performance plan

- All three queries are sub-100ms at expected scale with existing indexes
- If trending-reviews shows in slow query logs at beta scale, materialize via 30-minute cron into a `popular_*_daily` table — deferred until measurement justifies it

---

## Moderation specifics

### Report flow

1. User clicks Report on a comment / review / list / profile
2. `<ReportModal target_type=... target_id=...>` opens
3. Form: reason radio (`spam` | `harassment` | `spoiler` | `off_topic` | `other`) + optional details textarea (max 500 chars)
4. Submit → `createReport(target_type, target_id, reason, details?)` server action
5. Validates target exists; rate-limit 10 reports/user/hour (`lib/ai/rate-limit.ts` pattern adapted)
6. INSERT into `reports` with `status='pending'`
7. Confirmation toast: "Thanks — we'll review this within 48 hours"
8. **No automatic content hiding** from reports alone — requires admin action

### Auto-flag pipeline

- `checkSpamRules(body)` runs synchronously inside `createComment`
- If flagged: INSERT comments with `is_hidden=true` AND INSERT reports with `status='auto_flagged'`
- Author sees `<FlaggedBadge>` on their own comment: "Pending review — only you can see this"
- All other viewers see the comment as filtered (read predicate: `is_hidden = false OR user_id = viewer`)

### Admin queue (`/admin/reports`)

- Access gate: `isAdmin(userId)` checks `userId` against `ADMIN_USER_IDS` env (comma-separated UUIDs)
- Non-admin: `notFound()` — don't leak the route's existence
- Page renders paginated pending + auto-flagged reports, newest first:
  - Target preview (comment body excerpt, review hook, or list title)
  - Reporter (or "Auto-flag: link_density" badge)
  - Reason + details
  - Actions: **[Hide]** (sets `is_hidden=true`, status `resolved_action_taken`) / **[Keep visible]** (status `resolved_no_action`) / **[Open target]**
  - Each action accepts optional `resolver_note`
- Bulk-resolve checkbox column for auto-flag batches

### Edge cases

- Self-report: drop silently (no error toast)
- Reporter blocks the target: still accepted (blocks = visibility, reports = platform health)
- Duplicate reports on same target: allowed; admin queue shows "5 reports filed" count badge
- Reporter deletes account: `reporter_id` becomes null via `ON DELETE SET NULL`; report stays

### Explicitly out of Phase 5

- No user banning (no `auth.users.is_banned` column)
- No content deletion (only hide; original row preserved for audit)
- No appeals flow
- No shadow banning (hidden content is labeled, not silently suppressed)
- No public transparency report

---

## Build sequencing (T1–T29, 6 weeks)

| Week | T# | Task | Verifiable at end |
|---|---|---|---|
| **1 — Foundation** | T1 | Migration `0008_phase5_social.sql` | `pnpm db:check` clean; applied via Supabase MCP |
| | T2 | Drizzle `schema.ts` mirror | TS compiles; types flow into server actions |
| | T3 | Policies `0003_phase5_prep.sql` (defense-in-depth RLS) | Supabase advisors clean |
| | T4 | `lib/social/_shared/visibility.ts` | Vitest covers bidirectional + logged-out exception |
| | T5 | `lib/social/_shared/profile-summary.ts` | Vitest returns expected shape for 4 fixtures |
| **2 — Graph + Profile** | T6 | Follow/unfollow + `onFollow` notification | Playwright: follow → notification + count update |
| | T7 | Block/unblock + cascade side effects | Playwright: block → follow break + comment delete + like strip |
| | T8 | Profile overview hub + follow button + followers/following routes | Visit profile, see all 5 sections + working follow |
| | T9 | `/settings/blocked` + unblock UI | Manual: unblock reflected on profile |
| **3 — Feed** | T10 | `buildFeedQuery` UNION ALL | Unit: row count for fixture data |
| | T11 | `getFeed` with cursor pagination | Unit: cursor encode/decode round-trips |
| | T12 | `/home/feed/page.tsx` + components + empty state | Playwright: follower sees followee events; empty state |
| | T13 | `logs.last_event_at` population in all log mutation paths | Existing Vitest suites still pass; feed shows expected events |
| **4 — Comments + reactions** | T14 | `lib/social/comments/*` (CRUD + mentions) | Unit: mention parse edge cases; mention notification dedupe |
| | T15 | `lib/social/moderation/rules.ts` + `createComment` integration | Unit: 12+ truth-table cases; Playwright: flagged comment goes to flagged state |
| | T16 | `lib/social/reactions/*` (likeReview, likeList) | Playwright: like → notification; double-like is no-op |
| | T17 | `components/comments/*` + wire into review canonical page | Playwright: comment, reply, edit, soft-delete preserves structure |
| **5 — Notifications + email** | T18 | `lib/social/notifications/emit.ts` + dedupe | Unit: dedupe; self-notify silent; blocked-pair silent |
| | T19 | `getInbox` + `/notifications` + sidebar bell w/ polling | Playwright: action → inbox row visible after bell-poll tick |
| | T20 | `lib/social/notifications/digest.ts` | Unit: digest payload shape per cadence |
| | T21 | `lib/email/digest-template.tsx` + plain-text fallback | Snapshot test; manual visual verify in Resend test-mode |
| | T22 | `supabase/functions/digest-email` + cron + `/unsubscribe` route | Manual: trigger function, click unsubscribe |
| **6 — Lists + discovery + moderation + polish** | T23 | `lib/social/lists/*` (CRUD + slug + publish + reorder) | Playwright: create, add games, reorder, publish, share |
| | T24 | `components/lists/*` (incl. @dnd-kit) | Playwright: drag-to-reorder; mobile-touch |
| | T25 | `lib/social/discovery/*` (3 query helpers) | Unit: ordering on fixture data |
| | T26 | `/discover` landing + 3 sub-pages + components | Visit each, verify ordering + SEO meta |
| | T27 | Moderation — report modal, `/admin/reports` queue, admin gate | Playwright: non-admin 404; admin resolves report |
| | T28 | `scripts/verify-phase-5.ts` | All Groups pass or SKIP-with-reason |
| | T29 | Manual gate items + polish + tag `phase-5-complete` | Verify gate table all green |

---

## Testing strategy

### New Vitest unit specs

- `tests/unit/visibility.test.ts` — `withBlockedFilter` composition both directions + logged-out exception
- `tests/unit/cursors.test.ts` — feed cursor encode/decode + tiebreak stability
- `tests/unit/spam-rules.test.ts` — truth table per rule (boundaries at 2/3 URLs, 29/30 chars, 69/70% caps, 6/7 repeats)
- `tests/unit/emit-dedupe.test.ts` — emit() ON CONFLICT semantics with mock db; self-notify silence; blocked-pair silence
- `tests/unit/digest-builder.test.ts` — `buildDigest` payload shape; respects window; empty digest → null
- `tests/unit/slug.test.ts` — slugifyTitle edge cases (Unicode, very long, blank, all symbols)
- `tests/unit/mentions.test.ts` — parseMentions edge cases (code blocks, escapes, deduplication)

### New Playwright E2E specs

- `tests/e2e/follow-and-feed.spec.ts` — A follows B; B publishes review; A sees in feed; A unfollows; A no longer sees future B events
- `tests/e2e/block-cascade.spec.ts` — B comments + likes A's review; A blocks B; comment deleted, like stripped, mutual follow broken
- `tests/e2e/comment-thread.spec.ts` — comment, reply, edit, soft-delete preserves structure
- `tests/e2e/auto-flag.spec.ts` — comment with 3+ URLs auto-flagged; hidden from non-author, visible to author w/ badge
- `tests/e2e/notifications-inbox.spec.ts` — perform 5 actions, see 5 rows; mark-all-read clears badge
- `tests/e2e/lists-flow.spec.ts` — create list, add games, drag-reorder, publish, share URL
- `tests/e2e/admin-gate.spec.ts` — non-admin 404; admin resolves report

### Verify gate

| # | Criterion | Automatable? | Method |
|---|---|---|---|
| 1 | Bidirectional block prevents both directions of social interaction | yes | `block-cascade.spec.ts` |
| 2 | Feed shows material events only from follows in chronological order | yes | `follow-and-feed.spec.ts` |
| 3 | Comments thread 1-level deep with soft-delete preserving structure | yes | `comment-thread.spec.ts` |
| 4 | Auto-flag rules detect spam; flagged comments hidden from non-author | yes | `spam-rules.test.ts` + `auto-flag.spec.ts` |
| 5 | All 6 notification types fire with correct copy + idempotency | yes | `emit-dedupe.test.ts` + `notifications-inbox.spec.ts` |
| 6 | Email digest builds correct payload + unsubscribe JWT verifies | partial | `digest-builder.test.ts` + M1 |
| 7 | Discovery routes return correct ordering | yes | unit tests on each query helper |
| 8 | Lists CRUD + drag-reorder + publish + share URL | yes | `lists-flow.spec.ts` |
| 9 | Profile overview hub renders header + all 5 content sections (stats, taste card, top lists, recent reviews, library shelf) | yes | `verify-phase-5.ts` group check |
| 10 | Admin queue env-gated; non-admin gets 404 | yes | `admin-gate.spec.ts` |
| **M1** | Real digest email delivered to test inbox, unsubscribe round-trip | manual | Trigger cron via Supabase MCP; check Resend dashboard |
| **M2** | Visual rendering on all breakpoints (desktop + mobile) | manual | Self-test + DevTools mobile emulation |
| **M3** | `@-mention` autocomplete UX (debounce, ordering, mobile keyboard) | manual | Type `@` in composer; mobile too |
| **M4** | Drag-to-reorder list items on touch + mouse | manual | iPhone + desktop |
| **M5** | Notification bell badge updates without page refresh (60s polling) | manual | Two tabs, perform action, watch other tab |

**Automated total:** 10. **Manual total:** 5. Same shape as Phase 4 (8 + 4).

---

## Open questions to address during implementation

These don't block the design but should be decided early in implementation:

1. **Admin allowlist mechanism long-term** — `ADMIN_USER_IDS` env is fine for beta (1-3 admins, single deploy). If beta scales, consider a `user_roles(user_id, role)` table.

2. **Polling interval for bell-icon unread count** — 60s is the proposed default. May tune up/down during beta based on perceived staleness vs API call volume.

3. **List slug collision on title rename** — current spec preserves the original slug; a renamed list keeps its old URL. Confirm vs regenerating during T23.

4. **Wishlist trigger cooldown** — if a user has 50 followees and they all log the same wishlisted game in a week, the wishlister gets 50 notifications. Consider folding into a single "5 of your friends are playing Outer Wilds" notification. Defer to measurement; current spec emits per-friend.

5. **Email digest "send sample"** — preview button in `/settings/notifications` invokes `buildDigest` against the user's own data and renders it inline. Worth shipping in T21 to ease beta debug, or defer to Phase 6.

---

## What's explicitly NOT in Phase 5

- ❌ Native iOS/Android apps (still PWA-only per master plan)
- ❌ DMs / direct messages
- ❌ Real-time websocket inbox or feed (polling only)
- ❌ User banning (no `auth.users.is_banned` column)
- ❌ Content deletion by admin (only hide; preserve audit trail)
- ❌ Appeals flow for moderation actions
- ❌ Shadow banning
- ❌ Public transparency report
- ❌ Per-type notification toggles (coarse tri-state cadence only)
- ❌ Realtime notification push
- ❌ Activity feed beyond material events (no like/comment/follow feed rows)
- ❌ AI content moderation (rules only)
- ❌ Group lists / collaborative lists
- ❌ List comments (only list likes; reviews remain the discussion surface)
- ❌ Reply-to-reply (depth > 1)
- ❌ Hashtags / topic-based discovery
- ❌ User mention notifications outside comments (no profile-page mentions, etc.)

---

## References

### Verified existing infrastructure
- Migration `0007_pre_phase5_constraints.sql` — `follows` no-self CHECK, `comments` parent_id FK + same-review trigger, partial unique indexes
- Policies `0002_phase5_prep.sql` — defense-in-depth RLS on `review_questions` + `comments`
- Phase 4 spec at `docs/superpowers/specs/2026-05-12-phase4-taste-recs-design.md`
- Test infrastructure at `tests/` (Vitest + Playwright, see `memory/tests_setup_2026_05_13.md`)
- AI router pattern at `lib/ai/router.ts` (used for `lib/ai/rate-limit.ts` pattern in `createReport`)
- Existing `cosineSim` + `drift` at `lib/taste/vectors.ts` (reused by `discovery/similar-users`)

### Master plan reference
- `~/.claude/plans/smooth-herding-flame.md` Phase 5 (line 266)

### Aesthetic references (carried from Phase 4)
- Raycast, Linear, Vercel — premium UI
- Sabotage Studio, Eastward — pixel art accents
- Duolingo, Granola — mascot done well
