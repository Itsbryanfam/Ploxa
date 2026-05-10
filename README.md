# Letterboxd for Games

An AI-first game tracker with a pixel-art mascot. Premium UI inspired by Raycast, social features inspired by Letterboxd, AI-driven taste fingerprints + reviews + year-in-review retrospectives.

> **Status: Phase 0 — Foundation.** See [docs/plan.html](docs/plan.html) (open in browser) or `C:\Users\corte\.claude\plans\smooth-herding-flame.md` for the full roadmap.

## Quick start (developers)

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment variables (see "External accounts" below)
cp .env.example .env.local
# then fill in the values

# 3. Push the database schema to Supabase
pnpm db:push

# 4. Run the dev server
pnpm dev
```

Open <http://localhost:3000>.

## External accounts you need

You'll need to create accounts on these services. Each has a generous free tier sufficient for development and early users.

| Service | What for | When you need it | Sign up |
|---------|----------|------------------|---------|
| **Supabase** | Auth + Postgres + Storage | **Phase 0 (now)** | <https://supabase.com> |
| **Vercel** | Hosting (web + serverless) | Phase 0 (for staging deploys) | <https://vercel.com> |
| **GitHub** | Source control + CI | Phase 0 | already set up ✓ |
| **RAWG** | Game catalog API | Phase 1 | <https://rawg.io/apidocs> |
| **Cerebras** | Primary AI provider (free) | Phase 2 | <https://cloud.cerebras.ai> |
| **Groq** | AI fallback (free) | Phase 2 | <https://console.groq.com> |
| **Cloudflare** | AI fallback + Workers | Phase 2 | <https://dash.cloudflare.com> |
| **DeepSeek** | Paid AI overflow | Phase 2+ | <https://platform.deepseek.com> |
| **Resend** | Transactional email | Phase 5 (Supabase covers Phase 0–4) | <https://resend.com> |

Only **Supabase** (and optionally Vercel + GitHub) is needed to run Phase 0 locally. Everything else can wait.

## Setting up Supabase (Phase 0)

1. Go to <https://app.supabase.com> → **New project**
2. Pick a project name (e.g. `letterboxd-for-games-dev`), set a strong DB password, choose the closest region
3. Once provisioned, go to **Settings → API**:
   - Copy `Project URL` → `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`
   - Copy `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)
4. Go to **Settings → Database → Connection pooling**:
   - Use the **Transaction** mode connection string (port `6543`)
   - Add `?sslmode=require` at the end → `DATABASE_URL`
5. Run `pnpm db:push` to create all tables
6. (Optional) Go to **Authentication → Email Templates** to customize the magic link / signup email

## Project structure

```
app/                    # Next.js App Router pages
  (auth)/               # Login + signup (route group)
  (app)/                # Authenticated routes (dashboard, library, etc.)
  auth/callback/        # OAuth + magic link callback
components/
  mascot/               # Mascot component, state machine, store
  ui/                   # Base UI primitives (button, input, card)
lib/
  ai/                   # AI provider router (Phase 2)
  db/                   # Drizzle schema + migrations
  rawg/                 # RAWG API wrapper (Phase 1)
  supabase/             # Supabase clients (server, browser, middleware)
  env.ts                # Validated environment variables
  utils.ts              # Shared utilities (cn, slugify, relativeTime)
docs/
  plan.html             # Human-readable plan (open in browser)
middleware.ts           # Next.js middleware (auth refresh + route protection)
```

## Useful commands

```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm typecheck        # TypeScript check
pnpm lint             # ESLint
pnpm db:push          # Push schema changes to Supabase
pnpm db:generate      # Generate migration from schema
pnpm db:migrate       # Apply migrations
pnpm db:studio        # Open Drizzle Studio (DB browser)
```

## Verification (Phase 0 done when…)

- [x] `pnpm dev` boots the app
- [ ] You can sign up at `/signup`
- [ ] You can log in at `/login` (password OR magic link)
- [ ] Mascot animates on the homepage
- [ ] Visiting `/dashboard` while logged in shows the mascot celebrating
- [ ] Logging out returns you to the homepage
