# Wisurel AI — Automation Platform

Farm business automation for **Wisurel Ogbomosho Farm**: AI receipt/document extraction,
a plain-English "build any automation" engine, WhatsApp-fed daily staff reports, on-demand
report delivery to WhatsApp or email, bank reconciliation, universal file export (Excel, CSV,
PDF, JSON, TXT, Markdown, Word), and an AI assistant — white-labeled, with no "Claude"/
"Anthropic" branding shown to end users. Built to process up to **1,000 documents/24h** via a
batched queue, not one-at-a-time in the browser.

## What's in this zip

```
app.html                                ← the main app (open it in a browser, that's it)
admin.html                              ← admin portal — dashboard, users, AI analytics
index.html                              ← public landing page
wisurel-logo.svg                        ← your logo (wired into all three HTML files)
schema.sql                              ← Supabase database schema (multi-tenant, RLS)
supabase-functions/_shared/             ← shared digest computation, dedup rules, WhatsApp/email senders
supabase-functions/ai-proxy/            ← hides your Anthropic key from the browser
supabase-functions/whatsapp-webhook/    ← receives staff reports; boss can text "report" for an instant digest
supabase-functions/queue-processor/     ← batches up to 1,000 files/24h in the background
supabase-functions/weekly-digest/       ← auto-sends the Monday digest to WhatsApp/email
supabase-functions/send-report/         ← powers the app's "Send to..." buttons (on-demand, any time)
tests/                                  ← automated test suite (npm test)
.github/workflows/test.yml              ← runs the test suite on every push, via GitHub Actions
package.json / playwright.config.js     ← test suite config — not needed to just run the app
scripts/check-edge-functions.sh         ← type-checks the Supabase functions
INTEGRATION-NOTES.md                    ← how the pieces connect (projects, branches, camera upload)
preview-*.png                           ← screenshots of the app as it looks right now
README.md                               ← this file
```

## Two ways to run it

**Right now, zero setup (demo mode):** open `app.html` in any browser, paste an Anthropic API
key into the setup screen. Everything runs client-side with `localStorage`. Good for testing,
not for giving to real users (the key lives in their browser). Automations and Daily Reports
work in this mode too — Automations saves locally, Daily Reports shows labeled example cards
until WhatsApp is connected.

**Production (recommended before real customers use it):** deploy the Supabase backend below,
set `AI_PROXY_URL` near the top of `app.html`'s `<script>` block, and leave `claudeKey` unset.
The key never reaches the browser at that point, and Daily Reports starts showing real data.

---

## 1. Setting up on Termux

Termux can run everything needed to *edit and push* this code. It can't easily run the
Supabase CLI (no official ARM/Android build) — deploy the backend from the Supabase
**web dashboard** instead (steps below), which needs no CLI at all.

```bash
# one-time setup
pkg update && pkg upgrade
pkg install git openssh nodejs-lts

# get the code onto your phone
mkdir -p ~/wisurel && cd ~/wisurel
# (either unzip the file you downloaded, or once it's on GitHub:)
git clone https://github.com/<your-username>/wisurel-ai.git .

# preview app.html locally (Termux has no GUI browser by itself —
# serve it and open the URL in your phone's browser app)
python3 -m http.server 8080
# then open http://localhost:8080/app.html in Chrome/Firefox on the phone
```

If `python3` isn't installed: `pkg install python`.

## 2. Pushing to GitHub

```bash
cd ~/wisurel
git init
git add .
git commit -m "Wisurel AI automation platform"
git branch -M main
git remote add origin https://github.com/<your-username>/wisurel-ai.git
git push -u origin main
```

You'll need a GitHub **Personal Access Token** as your password when pushing from Termux
(GitHub → Settings → Developer settings → Personal access tokens → generate one with `repo` scope).

**Free hosting once it's on GitHub:** Settings → Pages → deploy from `main` branch. Your app
is then live at `https://<your-username>.github.io/wisurel-ai/app.html` — shareable with
staff immediately, no server needed for demo mode.

## 3. Deploying the backend (Supabase — no CLI needed)

1. Create a free project at supabase.com.
2. **SQL Editor** → paste all of `schema.sql` → Run.
3. Run this once (replace nothing, it's ready as-is):
   ```sql
   insert into organizations (name, slug, primary_color)
   values ('Wisurel Ogbomosho Farm', 'wisurel', '#22C55E');
   ```
   Copy the `id` it returns — that's your `ORG_ID`.
4. **Storage** → create a bucket named `wisurel-files` (used for uploaded receipts and
   WhatsApp media).
5. **Edge Functions** → Create `ai-proxy` → paste `supabase-functions/ai-proxy/index.ts` → Deploy.
6. **Edge Functions → ai-proxy → Secrets** → add `MODEL_API_KEY` = your Anthropic key
   (starts `sk-ant-`).
7. Copy your function's URL (looks like `https://xxxx.functions.supabase.co/ai-proxy`) and your
   project's `SUPABASE_URL` / anon key from **Settings → API**.
8. In `app.html`, set:
   ```js
   const SB_URL  = 'https://xxxx.supabase.co';
   const SB_ANON = '<your anon key>';
   const AI_PROXY_URL = 'https://xxxx.functions.supabase.co/ai-proxy';
   const ORG_ID = '<the id from the organizations row you inserted>';
   ```
9. Push that change to GitHub — done. The app now runs on your database, and the AI key
   is only ever visible to your Supabase project, never to a browser.

## 4. Connecting WhatsApp (Daily Reports)

Uses Meta's official WhatsApp Cloud API — free, no third party needed.

1. Deploy the webhook: **Edge Functions** → create `whatsapp-webhook` → paste
   `supabase-functions/whatsapp-webhook/index.ts` → Deploy **with "Enforce JWT" turned off**
   (Meta can't send your Supabase auth token).
2. Secrets for this function:
   ```
   WHATSAPP_VERIFY_TOKEN = <any string you make up, e.g. "wisurel-verify-2026">
   WHATSAPP_ACCESS_TOKEN = <from Meta App dashboard, step 4 below>
   WHATSAPP_PHONE_NUMBER_ID = <from Meta App dashboard, optional — enables auto-reply>
   WISUREL_ORG_ID = <same ORG_ID as above>
   ```
3. Go to developers.facebook.com → **Create App** → type "Business" → add the **WhatsApp**
   product. Meta gives you a free test phone number immediately.
4. In the WhatsApp product's **API Setup** page, copy the temporary access token into
   `WHATSAPP_ACCESS_TOKEN` (for production, generate a permanent token under System Users).
5. Under **Configuration**, set:
   - Callback URL: your deployed function's URL
   - Verify token: the same string as `WHATSAPP_VERIFY_TOKEN`
   - Click "Verify and Save", then **Subscribe** to the `messages` webhook field.
6. Add your staff's numbers as test recipients (Meta requires this until your app is verified
   for production use — a quick review Meta does for free).
7. Have a staff member send a WhatsApp message to the test number. It should appear on the
   **Daily Reports** page within a few seconds, summarized by AI.

## 5. Scaling to 1,000 receipts/24h (queue processor)

Right now, receipts uploaded through the browser are processed one at a time, live. For real
volume, route uploads through the job queue instead so the queue-processor handles the load:

1. Deploy `queue-processor` the same way as the other functions (Enforce JWT can stay on,
   since only your own cron calls it).
2. In the Supabase **SQL Editor**, enable scheduling and point it at your function:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('process-wisurel-queue', '*/1 * * * *', $$
     select net.http_post(
       url := 'https://xxxx.functions.supabase.co/queue-processor',
       headers := '{"Content-Type":"application/json"}'::jsonb
     );
   $$);
   ```
3. Have uploads insert a row into `jobs` (type `process_file`) instead of calling the AI
   directly — the queue processor picks it up within a minute, in batches of 5. Adjust
   `BATCH_SIZE` in the function if your Anthropic usage tier allows more parallel calls.

At 5 files/batch, once/minute, that's a ceiling of ~7,200 files/day — comfortably above the
1,000/day target, with room for retries (each job gets up to 3 attempts before being marked
`failed` for manual review).

## APIs you need, and where to get each one

| Need | Where | Notes |
|---|---|---|
| AI extraction/chat | console.anthropic.com → API Keys | Only needed as a Supabase **secret** in production — not in the browser |
| Database + auth + edge function hosting | supabase.com | Free tier is enough to start |
| WhatsApp inbound reports + digest sending | developers.facebook.com (Meta) | Free tier includes a test number; production sending has a small per-conversation cost after your first 1,000 conversations/month |
| (Optional) Custom domain | any registrar | Point it at GitHub Pages or wherever you host `app.html` |
| (Optional) WhatsApp share button | none — uses the phone's native Share sheet | No API key needed, works out of the box on mobile browsers |

No other API keys are required for what's built so far.

## 6. Bank Reconciliation & Weekly Digest (no extra setup)

Both are pages inside `app.html` and work immediately with whatever's already in your ledger —
no separate deployment needed. **Reconciliation**: upload a bank statement CSV/Excel export on
the Reconciliation page; it matches by amount + date against your processed receipts and flags
anything that doesn't line up. **Weekly Digest**: auto-computed summary (spend by category, staff
report compliance, flagged issues) with a one-tap "Send to WhatsApp" button.

To make the digest send itself automatically every Monday instead of requiring a tap:

1. Deploy `weekly-digest` the same way as the other functions.
2. Secrets: reuse `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` from the webhook setup,
   plus `DIGEST_RECIPIENTS` = comma-separated numbers (e.g. `+2348012345678,+2348099999999`) —
   typically just the owner/manager, not the whole staff list.
3. Schedule it:
   ```sql
   select cron.schedule('wisurel-weekly-digest', '0 7 * * 1', $$
     select net.http_post(
       url := 'https://xxxx.functions.supabase.co/weekly-digest',
       headers := '{"Content-Type":"application/json"}'::jsonb
     );
   $$);
   ```
   That's 7am every Monday — adjust the cron expression for a different time.

## 7. Admin Portal (`admin.html`)

A separate file — global dashboard (active projects, total token usage, files processed, job
queue health), user management (activate/deactivate accounts), and an AI Analytics chat that
answers plain-English questions about usage by querying your real Supabase data (never invented
numbers).

**Sign-in is automatic based on configuration** — no separate step needed:
1. **Not yet configured** (`SB_URL` still says `YOUR_PROJECT_REF`): shows a passcode-only gate,
   default `wisurel2026`. Fine for you alone, testing. **Change `ADMIN_PASSCODE`** near the top
   of the `<script>` block before sharing this file with anyone.
2. **Once configured** (same `SB_URL` / `SB_ANON` / `AI_PROXY_URL` / `ORG_ID` values as
   `app.html`): the passcode gate is replaced automatically by a real email/password sign-in,
   checked against `profiles.role in ('owner','admin')` — the RLS policies in `schema.sql`
   already assume this shape. Anyone without that role is signed back out immediately, even if
   their password is correct. Create admin accounts the same way you'd create any Supabase Auth
   user (dashboard → Authentication → Add user), then set their `profiles.role` to `owner` or
   `admin` via the SQL editor.

## 8. Landing Page (`index.html`)

A standalone marketing page — hero, feature grid, how-it-works, and pricing tiers — linking to
`app.html` and `admin.html`. Uses `preview-dashboard.png` as the hero screenshot; swap that image
for a fresh one anytime the app's UI changes meaningfully. No setup required — it's static.

## 9. Sending reports on demand — to the boss, over WhatsApp or email

This is the piece that makes reporting a two-way thing instead of a one-way schedule. Three ways
a report reaches someone, beyond the automatic Monday send:

**A. The operator taps a button in the app.** Weekly Digest and Daily Reports both grow a
"Send to [name]" button for every person you've added under Settings → Report Recipients. One
tap, delivered instantly to their own WhatsApp or email — not the operator's phone, the actual
backend sends it.

**B. The boss just asks for it.** Anyone already in Report Recipients (channel = WhatsApp) can
text the business WhatsApp number the word **"report"**, **"status"**, **"digest"**, or
**"update"** and get the current numbers texted straight back within seconds — no operator
involved. Add "today" to the message (e.g. "status today") to get just today's numbers instead
of the week.

**C. Automatic, every Monday.** Anyone with "Auto Monday" checked in Settings gets the digest
without anyone lifting a finger — this is the existing `weekly-digest` cron job.

### Setup

1. **WhatsApp sending** reuses the `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` secrets
   from section 4 — nothing new needed if you already set those up.
2. **Email sending** uses Resend (resend.com — free tier is generous). Sign up, verify a sending
   domain (or use their shared test domain while trying this out), grab an API key, then:
   ```
   supabase secrets set RESEND_API_KEY=re_...
   supabase secrets set REPORT_FROM_EMAIL=reports@yourdomain.com
   ```
3. Deploy the new functions:
   ```
   supabase functions deploy send-report
   ```
   (`weekly-digest` and `whatsapp-webhook` also changed — redeploy both if you already deployed
   them earlier: `supabase functions deploy weekly-digest` and
   `supabase functions deploy whatsapp-webhook --no-verify-jwt`.)
4. In `app.html`, set:
   ```js
   const SEND_REPORT_URL = 'https://xxxx.functions.supabase.co/send-report';
   ```
5. Add people under **Settings → Report Recipients** in the app — label, contact (E.164 phone
   for WhatsApp, email address for email), and tick "Auto Monday" for anyone who should get the
   scheduled send too. That's it — the "Send to..." buttons and the WhatsApp trigger-word reply
   both read from this same list, so adding someone once covers all three delivery paths.

### Note on the shared code

`weekly-digest`, `send-report`, and `whatsapp-webhook` all import from
`supabase-functions/_shared/digest.ts` and `_shared/notify.ts` — one place computes "what's
going on" and one place knows how to deliver it, so the three never disagree on numbers. When
deploying via the Supabase dashboard's function editor (rather than the CLI), copy `_shared/`
alongside each function that imports from it, since the dashboard editor deploys one function's
files at a time.

## 10. Duplicate detection — automations and receipts both

Two separate checks, both automatic, no setup required:

**A. "Does this automation already exist?"** When creating a new automation from a plain-English
prompt, the description is compared against every existing automation (and the built-in Receipt
Processor) using word-overlap similarity. A strong match pauses creation and asks: continue the
existing one, or confirm this is genuinely different and create it anyway. This is what stops
"track feed deliveries" and "feed delivery tracking" from becoming two separate, half-filled
automations.

**B. "Have I already processed this receipt?"** Two layers, checked in order:
1. **Exact file match** — every upload is SHA-256 hashed client-side before it's sent anywhere.
   The same photo/PDF uploaded twice (different filename, identical bytes) is flagged in the
   upload queue immediately, before an AI call is even made — with a "Process anyway" override
   for the rare legitimate case (e.g. a template file reused on purpose).
2. **Fuzzy transaction match** — even a *different* photo of the same receipt, or the same
   transaction typed in twice, is caught: same date, amount within a few cents, and similar
   enough description. Skipped transactions are counted and reported in the toast/activity log
   rather than silently dropped, so nothing disappears without a trace.

Both checks run identically whether you're in demo mode (client-side, `localStorage`) or
production (server-side, in `queue-processor` against the real `files` and `workflow_rows`
tables) — the same `_shared/dedupe.ts` matching rules back both paths, so a receipt processed
live in the browser and one processed by the background queue get judged the same way.

Manual row entry in a custom automation gets a lighter version of the same idea — an exact
match across all columns prompts a confirmation before adding it again.

## 11. Receipt batching — "Update vs Branch" for the Receipt Processor

The Receipt Processor now has the same Update-vs-Branch choice originally designed for
Automations. At the top of the page, a branch picker shows **"Main Ledger"** by default —
everything you upload goes there, same as before (the Update path).

Click **"+ Start new batch"** to isolate a set of receipts under their own label (e.g.
"Receipts – September 2026") — a fresh, empty ledger that doesn't touch anything in Main
Ledger or any other batch (the Branch path). Switch between batches anytime from the picker;
rename or delete any non-main batch from the buttons next to it. This works identically in
demo mode (stored in `localStorage`) and production (backed by `project_branches` and a new
`branch_id` column on `jobs`, so receipts processed through the background queue land in
whichever batch was active when they were uploaded — not always the main ledger).

## 12. Real `.docx` export

The Word export now produces a genuine OOXML `.docx` file via `html-docx-js`, loaded from a
CDN — opens natively in Word, Google Docs, and LibreOffice with no "this file may be
corrupted" warning. If that CDN is ever unreachable, it falls back automatically to the
previous HTML-based `.doc` format, so exporting never breaks — it just loses native styling
in that edge case.

## 13. Self-serve signup — invite-code gated

The signup form on the auth screen wires all the way through now, and is gated by invite codes
at the database level (not just hidden in the UI — an invalid code can't create an account,
full stop).

**A real bug got fixed here too:** demo mode used to skip the Sign in / Create account screen
entirely and jump straight to the one-time API-key setup, so the signup form — invite-code
field included — was unreachable without editing `localStorage` by hand. `init()` now shows
the auth screen first in demo mode too (both Sign in and Create account are instant local
no-ops there, so this adds one tap, not real friction), and a returning visitor who already
has a saved API key still skips straight into the app exactly as before. Two tests in
`tests/app-smoke.spec.js` guard against this regressing again.

### Google sign-in and magic links — what's real and what isn't

Both buttons on the auth screen call genuinely correct Supabase methods
(`signInWithOAuth({provider:'google'})` and `signInWithOtp({email})`) — but three things have
to be true before either one actually works, and only one of them was something I could fix
from here:

1. **Google OAuth must be configured in your Supabase dashboard** (Authentication → Providers
   → Google), which needs a Google Cloud OAuth client you create yourself — this can't be
   done from code, it needs your own Google Cloud project.
2. **The app must be hosted at a real `https://` URL**, not opened as a local file — OAuth
   providers reject `file://` as a redirect target. This works once deployed (GitHub Pages,
   your own domain, etc.), not when you're just opening `app.html` directly.
3. **The invite-code trigger would have rejected every Google/magic-link signup outright** —
   this was a real bug, now fixed. `handle_new_user()` only had one path, which required an
   invite code at signup time; Google and magic-link accounts never pass through the custom
   form where that code is collected, so every one of them would have failed immediately with
   "An invite code is required." Fixed by giving the trigger two paths: the signup form's
   invite code still validates immediately as before, but an account with no code at signup
   time (OAuth, magic link) is now created *pending* instead — authenticated, but with no
   `org_id` and `is_active = false`, so RLS blocks it from seeing any of your data. Right after
   login, the app checks for this and shows a **"One more step"** screen prompting for an
   invite code before letting them any further in (`redeem_invite_code()` in `schema.sql`,
   called from `routeAfterAuth()` in `app.html`). Four tests in
   `tests/invite-redemption.spec.js` cover this.

So: the code is correct and the invite gate now works uniformly across every sign-in method —
but #1 and #2 are genuinely yours to complete before Google sign-in does anything at all.

**How it works:** `schema.sql` includes an `invite_codes` table and a trigger
(`handle_new_user()`/`on_auth_user_created`) that runs on every signup. No code, or an
invalid/expired/exhausted one, and the trigger raises an exception — which rolls back the
*entire* signup, including the `auth.users` row, so there's no dangling half-created account
to clean up. A valid code creates the matching `profiles` row automatically, with whatever
org and role that code was set up to grant.

**Generating codes:** open the Admin Portal's new **Invite Codes** page — set a label, pick
the role the code grants (member/admin/owner), how many people can use it, and an optional
expiry. Generate, and the code is copied to your clipboard ready to send. No SQL needed after
initial setup.

**Bootstrapping the very first account (yours):** since every signup needs a code, including
the first one, `schema.sql`'s seed section walks through creating a one-time owner code via
the SQL editor before the Admin Portal even exists to make codes for you. It consumes itself
(max_uses: 1) after you sign up with it.

This is scoped for what Wisurel actually is right now — one farm, one organization, invite
codes controlling who joins it. If you ever turn this into a multi-tenant product for other
businesses (see the "Resell it" tier on the landing page), invite codes are exactly the
mechanism you'd extend — a code tied to a *specific* org instead of assuming there's only one,
which the schema already supports (`invite_codes.org_id`); the only change needed is removing
the "only organization" assumption elsewhere.

## 14. Automated test suite

Every check that's been run by hand before each release — syntax validation, full page
navigation with zero console errors, the duplicate-detection logic, bank reconciliation
matching, receipt branching — is now a real test suite in `tests/`, runnable with:
```bash
npm install
npx playwright install --with-deps chromium
npm test                      # app.html, admin.html, index.html smoke tests
npm run test:edge-functions   # type-checks every Supabase Edge Function
npm run test:all              # both
```
`.github/workflows/test.yml` runs all of it automatically on every push to `main` and every
pull request — so a change that breaks something gets caught in CI, not by a user. If you're
not using GitHub Actions, the same commands work anywhere Node is installed (Termux included,
though installing Playwright's browser binary there may be more trouble than it's worth on a
phone — this is realistically a "run before deploying from a laptop" tool, or let CI handle it).

## Still ahead (not in this drop)

- Multi-project "Update vs Branch" specifically for **custom Automations** already existed;
  it's now also live for the Receipt Processor (section 11) — the one thing still not branched
  is Daily Reports, which doesn't really need it (each report is already its own record)
- Time-series usage charting on the admin dashboard (currently shows a running total; a proper
  chart needs a few weeks of `usage_events` data to be worth plotting)
- PDF attachments on emailed reports (currently HTML body only — an attached PDF would need a
  PDF-generation step added to `_shared/digest.ts`'s email path)
- Multi-tenant signup, where an invite code selects *which* organization you're joining
  (section 13 — currently single-org by design, since Wisurel is one farm)
- Revoking or manually expiring an already-issued invite code from the Admin Portal (right now
  you can generate codes and watch their usage, but not kill one early — set `max_uses` low if
  you want a code to expire quickly on its own)
- **Google OAuth provider setup in your Supabase dashboard, and hosting the app at a real
  `https://` URL** — see section 13's "what's real and what isn't." The code is correct and
  the invite-gate bug that would have blocked it is fixed, but these two external setup steps
  are yours to complete; I can't do either from here.

**Now done:** receipt processing auto-switches to the background job queue once a real backend
is configured; the Dashboard's "Needs attention" panel surfaces issues flagged in Daily Reports;
Bank Reconciliation and Weekly Digest are live in the app; the full Admin Portal is built with
real Supabase-role auth (not just a passcode); the public landing page is live; reports can be
sent on demand to WhatsApp or email; the Receipt Processor supports batching; Word export is
real OOXML; signup is invite-code gated at the database level — now uniformly across the
password form *and* Google/magic-link — with a full Admin Portal panel to generate and track
codes; and all of it is now covered by an automated test suite instead of manual verification
alone.

Ask for any of these next and I'll build it the same way — working code, screenshot, zip.
