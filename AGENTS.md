# AGENTS.md — OpenInvite

> **If you are an AI agent (Muse, Claude, or similar), this file is your runbook.**
> You can run the *entire* OpenInvite workflow on a user's behalf from chat:
> create the event, generate cover art, add guests, send invitations, track
> the funnel, and send reminders. No browser needed.

## What this is

Open-source digital invitations — a self-hosted Paperless Post clone.
**Stack:** Firebase Hosting (static frontend) + Firestore + Cloud Functions (Node 20) + Resend (email) + Firebase Storage (cover art).

Live repo: https://github.com/rayhe/open-invite

## One-time setup (per machine)

```bash
cd scripts && npm install          # firebase-admin, one time

export GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
export FIREBASE_PROJECT=<firebase-project-id>
export RESEND_API_KEY=re_...
export RESEND_FROM="Your Name <invites@yourdomain.com>"
export APP_BASE_URL=https://<firebase-project-id>.web.app
# Optional: makes the web dashboard treat the user's browser as the event
# owner. Get the value from the event page console:  OI.currentUid()
export OPENINVITE_OWNER_UID=<uid>
```

How to get each value:
- **Service account JSON:** Firebase console → Project settings → Service accounts → Generate new private key. **Never commit it. Never paste it into chat.**
- **Resend API key:** [resend.com/api-keys](https://resend.com/api-keys). A send-only restricted key is enough.
- **RESEND_FROM:** must use a domain verified in Resend → Domains. Until the domain is verified, Resend only delivers to the account owner's address — fine for testing, tell the user.
- **APP_BASE_URL:** the Firebase Hosting URL (or custom domain).

## Deploying the app itself (only needed once, or after code changes)

```bash
cp .env.example functions/.env        # then fill in RESEND_* + APP_BASE_URL
cp public/firebase-config.example.js public/firebase-config.js   # paste web config
firebase use --add && firebase deploy
```

Enable **delivery analytics**: Resend → Domains → Tracking (turn on opens + clicks), then Resend → Webhooks → add `https://<region>-<project>.cloudfunctions.net/resendWebhook` with events `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`. Put the signing secret in `functions/.env` as `RESEND_WEBHOOK_SECRET` and redeploy functions.

## The full invitation flow (do this for the user)

### 1. Nail down the details (ask, don't guess)

You need: **event title, date, time, location, host name**, and the **guest list** (names + emails). Optional: description, RSVP deadline, theme, +1s/maybe toggles.

If the user says "Saturday", resolve it to an actual date and confirm. Never invent guest emails.

### 2. Create the event

```bash
node scripts/admin.js create-event \
  --title "Maya's 7th Birthday" \
  --date 2026-10-25 --time 13:00 \
  --location "Winter Lodge, Palo Alto" \
  --host "The He Family" \
  --description "Ice skating, then cake at 2." \
  --theme confetti
```

Themes: `confetti` `midnight` `garden` `ocean` `sunset` `minimal`.
Prints `eventId` + the host dashboard URL. **Save the eventId** — every later command needs it.

### 3. Generate cover art (recommended)

Generate a **landscape** image (~1536×1024) matching the event vibe. Keep it **text-free** (rendered text looks bad) and appropriate for the audience. Then:

```bash
node scripts/admin.js set-cover --event <ID> --file /tmp/cover.png
```

The cover appears on the invitation email, the RSVP page, and the dashboard.

### 4. Add guests

```bash
node scripts/admin.js add-guests --event <ID> --file guests.csv
# or inline:
node scripts/admin.js add-guests --event <ID> --csv "Ada Lovelace,ada@example.com
Grace Hopper,grace@example.com"
```

CSV format: `Name,email` per line.

### 5. SEND — the guardrailed step

**Never send without explicit user approval of the exact recipient list.** Show the user:

> Ready to send "Maya's 7th Birthday" to 18 guests: Ada Lovelace, Grace Hopper, … — okay to send?

Only after a clear yes:

```bash
node scripts/admin.js send --event <ID>
```

- First run: **send a test to the user's own email first**, have them confirm it looks right.
- One approval = one send. Never re-send unprompted.
- Reminders later: `node scripts/admin.js send --event <ID> --remind --only-pending` (also needs approval).

### 6. Report + track

```bash
node scripts/admin.js stats --event <ID>        # Sent → Delivered → Opened → Visited → Responded
node scripts/admin.js list-guests --event <ID>  # per-guest detail
```

Give the user the dashboard URL and the funnel numbers. Bounced emails (⚠️) mean a bad address — flag them so the user can fix and resend individually:

```bash
node scripts/admin.js send --event <ID> --guest <GUEST_ID>
```

A few days before the event, proactively offer: "12 of 18 responded — want me to nudge the other 6?"

## How tracking works (so you can explain it)

| Signal | Source |
|---|---|
| Sent | recorded by the mailer |
| Delivered / bounced | Resend webhook → `resendWebhook` function |
| Email opened | Resend open-tracking pixel (disclosed in the email footer) |
| Link visited | first-party timestamp when the guest opens their RSVP link |
| Responded | the guest's RSVP |

The dashboard renders this as a funnel plus per-guest icons. Hosts can also manually override a guest's RSVP status (e.g. someone replied by text).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `send` succeeds but nobody receives mail | Sending domain not verified in Resend — only the account owner's address gets mail |
| Funnel stuck at "Sent" | Webhook not registered, or open/click tracking off in Resend → Domains |
| `set-cover` fails | Storage not enabled in the Firebase project, or wrong bucket (`FIREBASE_STORAGE_BUCKET` env overrides the default) |
| Dashboard says "viewing as guest" | `OPENINVITE_OWNER_UID` doesn't match the browser's anonymous uid (`OI.currentUid()` in console) |
| `admin.js` auth errors | `GOOGLE_APPLICATION_CREDENTIALS` missing/invalid, or `FIREBASE_PROJECT` wrong |

## Security notes (don't break these)

- Guest emails live in a Firestore `private/` subcollection readable only by the event owner. **Never print guest emails in chat** unless the user explicitly asks.
- RSVP links contain unguessable tokens — treat them like passwords; only share a guest's link with that guest.
- The `mailmap/` collection maps Resend email ids to guests for webhook attribution; it's write-only from the mailer.
- Before a *production* deploy (real guests), the Firestore rules need the planned hardening: guest docs should be owner-only with token validation done server-side instead of the current public-read + token-echo pattern.

## Example session

> **User:** Send birthday invites for Maya's party Saturday 1pm at Winter Lodge to the class parents list.
>
> **You:** Confirm Saturday = Oct 31, ask for the guest list (accept a paste), generate cover art (birthday, ice skating, confetti, no text), run `create-event` → `set-cover` → `add-guests`, show the 18 recipients, get explicit approval, send a test to the user first, then `send` to all, report the dashboard URL + funnel. Days later: "14 of 18 responded — nudge the rest?"
