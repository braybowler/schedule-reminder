# CLAUDE.md

These general rules apply to every task in this project unless explicitly overridden.
Project-specific rules and context exist below.
Bias: caution over speed on non-trivial work.

## Rule 1 — Think Before Coding
State assumptions explicitly. Ask rather than guess.
Push back when a simpler approach exists. Stop when confused.

## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No abstractions for single-use code.

## Rule 3 — Surgical Changes
Touch only what you must. Don't improve adjacent code.
Match existing style. Don't refactor what isn't broken.

## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Strong success criteria let Claude loop independently.

## Rule 5 — Use the model only for judgment calls
Use for: classification, drafting, summarization, extraction.
Do NOT use for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
If unsure why existing code is structured a certain way, ask.

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

## Schedule-Reminder Specific

Personal Node/TypeScript app. Scrapes ClinicMaster (no API) with headless Playwright and sends an SMS each Sun–Thu at 8:55pm America/Toronto with the next workday's first non-cancelled appointment. Email is the fallback channel; a separate alert email goes to Brayden if the scrape itself breaks.

**Reliability > features.** This thing has to send *something* on every scheduled night — silence is the worst outcome. Prefer defensive fallbacks (retry, alert email, "couldn't fetch" message) over clever logic.

Live plan, phase status, selector notes, and open questions: `/Users/braydenbowler/Documents/Obsidian Vault/schedule-reminder-plan.md` — read before resuming a session.

## Stack

- Node + TypeScript (ESM, `tsx` for runtime, no build step)
- Playwright (chromium, headless) for scraping
- node-cron for scheduling, zod for env validation, pino for logging
- Twilio for SMS, nodemailer (Gmail SMTP) for email fallback + alerts
- Single Docker container, built from `mcr.microsoft.com/playwright` base, pushed to `ghcr.io/braybowler/schedule-reminder` on push to `main`

## Layout

```
src/
  run.ts                  # orchestrates one run: scrape → notify (or alert on failure)
  config/config.ts        # zod-validated env, single source of truth
  logging/logger.ts       # pino instance
  scraping/scraper.ts     # Playwright: login, navigate calendar, extract first non-cancelled appt
  notifications/notifier.ts  # sendSms (Twilio), sendEmail (SMTP)
  notifications/notify.ts # CLI wrapper for ad-hoc message sending
  scraping/scrape.ts      # CLI wrapper for ad-hoc scrape runs
  scheduling/scheduler.ts # node-cron loop — the container entrypoint
```

## Commands

```bash
npm run typecheck              # tsc --noEmit
npm run run-once [YYYY-MM-DD]  # full pipeline once; date defaults to tomorrow in TIMEZONE
npm run scrape  [YYYY-MM-DD]   # scrape only
npm run notify  "message"      # send-only smoke test
npm run schedule               # start cron loop (what the container runs)
```

## Architecture

- `run.ts:runOnce()` is the orchestrator. Returns `appointment`, `empty`, or `error`. On `error` it both notifies the user ("couldn't fetch, check manually") and emails an alert to `ALERT_EMAIL`.
- Scraper returns a discriminated `ScrapeResult` (`appointment | empty | error`) — never throws past its boundary. On any failure it saves a screenshot + HTML to `artifacts/` for postmortem.
- `scrapeFirstAppointmentWithRetry` runs up to 2 attempts with a 5s gap. Each attempt has a 5-minute overall ceiling and 60s per-step timeout (the droplet is meaningfully slower than dev — trade latency for reliability).
- Notifier: SMS first, falls back to email if Twilio call throws. If both fail, `runOnce` throws.
- Config is zod-validated at startup. Missing required keys (`CLINICMASTER_*`) crash the process with a printed field error map.

## Conventions

- **All env access goes through `src/config/config.ts`.** Do not read `process.env` elsewhere.
- Scrape selectors are centralized in `SELECTORS` at the top of `scraper.ts` — change them there, not inline.
- ClinicMaster uses DevExtreme components: `dx-text-box`, `dx-button`, `.dx-scheduler-*`. The outer `<dx-scheduler>` doesn't render reliably in headless chromium — wait on `.dx-scheduler-work-space` instead.
- An appointment is "valid" iff: `cell-container` id starts with `app-`, has a client name, has `data-appdatetime`, and neither the event-cell nor any `.status-point` carries a `cancel` class. Sort by `data-appdatetime` ASC and take the first.
- Logging: structured pino objects, not string concat. `logger.info({ key: value }, 'message')`.
- Errors thrown out of `runOnce` are intentional and cause non-zero exits in CLI mode; the scheduler logs and continues (so one bad night doesn't kill the cron loop).

## Deployment

- Push to `main` → `.github/workflows/deploy.yml` builds the Docker image and pushes `:latest` + `:<sha>` to `ghcr.io/braybowler/schedule-reminder`.
- Droplet pulls `:latest` and runs via `docker-compose.yml` (`restart: unless-stopped`, env from `.env` on the host).
- Same pattern as `wedge-matrix-api`.

## Env vars (see `.env.example`)

- Required: `CLINICMASTER_LOGIN_URL`, `CLINICMASTER_CALENDAR_URL`, `CLINICMASTER_USERNAME`, `CLINICMASTER_PASSWORD`
- SMS (optional but expected in prod): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `NOTIFY_PHONE_NUMBER`
- Email (fallback + alerts): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL`, `ALERT_EMAIL`
- Behavior: `HEADLESS` (default `true`), `LOG_LEVEL` (default `info`), `TIMEZONE` (default `America/Toronto`), `SCHEDULE_CRON` (default `55 20 * * 0-4` — 8:55pm Sun–Thu)
