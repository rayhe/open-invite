# OpenInvite

Open-source digital invitations. A self-hosted [Paperless Post](https://www.paperlesspost.com) clone built on **Firebase + Resend**.

Create beautiful event invitations, email them to your guest list, and track RSVPs in real time. No per-invite fees, no ad trackers. Your data stays in your Firebase project.

## Features

- **Event builder** — title, date/time, location, description, 6 design themes, cover image, RSVP deadline, +1s and "maybe" toggles
- **Cover art** — upload a photo or have Muse generate one; it appears on the email, RSVP page, and dashboard
- **Guest list** — add guests manually or import CSV; each guest gets a unique, unguessable RSVP link
- **Email invitations via Resend** — themed HTML emails with one-tap RSVP buttons
- **Delivery analytics** — Paperless Post-style tracking page: Sent → Delivered → Opened → Link visited → Responded, per guest, powered by Resend webhooks
- **RSVP pages** — accept / decline / maybe, party size, dietary notes, message to host, add-to-calendar (.ics download)
- **Host dashboard** — live counts, per-guest status + tracking, manual status override (for text replies), resend individual invites, nudge non-responders, export CSV
- **Muse orchestration** — run the whole flow from chat with `scripts/admin.js` (see `~/workspace/skills/open-invite/SKILL.md`)
- **Privacy-first** — no ad trackers, guest emails never exposed publicly, open tracking disclosed in every email

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────┐
│  Static web │─────▶│    Firestore     │◀─────│ Cloud        │
│  (Firebase  │      │  events, guests, │      │ Functions    │
│   Hosting)  │      │  rsvps           │      │ (Node 20)    │
└─────────────┘      └──────────────────┘      └──────┬───────┘
                                                     │ Resend API
                                                     ▼
                                              ┌──────────────┐
                                              │  Guest inbox │
                                              └──────────────┘
```

- **Frontend:** vanilla HTML/CSS/JS, zero build step, Firebase JS SDK via CDN
- **Backend:** three Firebase Cloud Functions (2nd gen) — `sendInvitations` / `sendReminders` send mail through Resend, `resendWebhook` receives Resend delivery/open/click events and writes per-guest analytics. The API key never touches the browser.
- **Auth:** Firebase Anonymous auth for hosts (one click, no passwords); guests use capability URLs (unguessable tokens)
- **Cost:** free on Firebase Spark/Blaze free tiers + Resend's free tier (3,000 emails/month) for typical family/party use

## Quickstart

### 1. Prerequisites

- Node 20+, Firebase CLI (`npm i -g firebase-tools`)
- A [Firebase project](https://console.firebase.google.com) with Firestore, Hosting, and Functions enabled
- A [Resend](https://resend.com) account + API key, and a verified sending domain

### 2. Configure

```bash
cp .env.example functions/.env
# edit functions/.env:
#   RESEND_API_KEY=re_...
#   RESEND_FROM="Invitations <invites@yourdomain.com>"
#   APP_BASE_URL="https://yourproject.web.app"
#   RESEND_WEBHOOK_SECRET=whsec_...   (Resend → Webhooks → Signing Secret)

cp public/firebase-config.example.js public/firebase-config.js
# paste your Firebase web config
```

### 2b. Enable delivery analytics (optional but recommended)

1. **Resend → Domains → your domain → Tracking** — turn on open and click tracking.
2. **Resend → Webhooks** — add `https://<region>-<project>.cloudfunctions.net/resendWebhook`, subscribe to `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`.
3. Copy the webhook **Signing Secret** into `functions/.env` as `RESEND_WEBHOOK_SECRET` and redeploy functions.

The dashboard funnel (Sent → Delivered → Opened → Link visited → Responded) populates as webhooks arrive. "Link visited" is recorded first-party when a guest opens their RSVP link — no pixel needed for that one.

> **Note:** `functions/.env` and `public/firebase-config.js` are gitignored. Never commit keys.

### 3. Deploy

```bash
firebase login
firebase use --add            # select your project
firebase deploy               # hosting + firestore rules + functions
```

### 4. Use it

Open your Hosting URL → **Create an invitation** → add guests → **Send invitations**.

## Email deliverability

Resend requires a verified domain to send to arbitrary recipients (its free tier includes one domain + 3,000 emails/month). Verify yours at [resend.com/domains](https://resend.com/domains) — it's three DNS records. Until then, Resend only delivers to the account owner's address, which is fine for testing.

The included example key scope is **send-only** (`restricted_api_key`), which is all this app needs. Domain management uses the Resend dashboard.

## Analytics & privacy

The host dashboard shows a per-guest funnel: **Sent → Delivered → Opened → Link visited → Responded**. Sources:

| Signal | How | Privacy note |
|---|---|---|
| Sent | recorded when the mailer accepts the email | — |
| Delivered / bounced | Resend webhook | standard mail-server feedback |
| Email opened | Resend open-tracking pixel | disclosed in the email footer ("opens are tracked so your host knows you got this") |
| Link visited | first-party timestamp when the guest opens their RSVP link | no pixel; only that *a* visit happened |
| Responded | the guest's RSVP | — |

Guest emails live in a `private/` subcollection readable only by the event owner. Bounced addresses are flagged (⚠️) so hosts can fix them. No ad networks, no third-party analytics, no cross-event tracking.

## Security model

- Hosts authenticate with Firebase Anonymous auth; each event stores its creator's `ownerUid`, and Firestore rules only let the owner read guest emails and manage the event.
- Guest documents expose only `name` + RSVP status publicly. Emails live in a `private/` subcollection readable only by the owner.
- RSVP writes require echoing the guest's secret token (`request.resource.data.token == resource.data.token` in `firestore.rules`), so only someone holding the invite link can respond.
- Cloud Functions verify `request.auth.uid == event.ownerUid` before sending any mail.

## Project layout

```
public/                 static frontend (Firebase Hosting)
  index.html            landing + my events
  create.html           event builder
  event.html            host dashboard
  rsvp.html             guest RSVP page
  app.js / styles.css   shared JS + CSS
  firebase-config.js     your Firebase web config (gitignored)
functions/              Cloud Functions (Resend mailer + webhooks)
  index.js              sendInvitations, sendReminders, resendWebhook
  .env                  RESEND_API_KEY etc (gitignored)
scripts/                Muse orchestration CLI (firebase-admin)
  admin.js              create-event, add-guests, set-cover, send, stats
  email-template.js     canonical email template (keep functions copy in sync)
  package.json
firebase.json           hosting + functions + firestore + storage config
firestore.rules         security rules (see "Security model")
storage.rules           cover-image upload rules (owner-only writes)
mailmap/                (Firestore) Resend email-id → guest mapping for webhooks
```

## Orchestrating with Muse

`scripts/admin.js` lets an AI agent run the entire flow from chat — no browser needed:

```bash
cd scripts && npm install
export GOOGLE_APPLICATION_CREDENTIALS=~/path/to/service-account.json
export FIREBASE_PROJECT=your-project
export RESEND_API_KEY=re_... RESEND_FROM="You <invites@yourdomain.com>"
export APP_BASE_URL=https://your-project.web.app

node admin.js create-event --title "Maya's 7th" --date 2026-10-25 --time 13:00 --location "Winter Lodge" --host "The He Family"
node admin.js set-cover --event <ID> --file /tmp/cover.png   # AI-generated art
node admin.js add-guests --event <ID> --file guests.csv
node admin.js send --event <ID>                              # after user confirms recipients
node admin.js stats --event <ID>                             # the funnel
```

A full runbook lives in `~/workspace/skills/open-invite/SKILL.md`. Guardrail: never send without the user confirming the exact recipient list.

> **AI agents:** `AGENTS.md` at the repo root is the canonical orchestration manual — setup, full flow, guardrails, troubleshooting, and an example session. The workspace skill above is a thin local supplement; if they disagree, `AGENTS.md` wins.

## Roadmap

- [x] Cover images (upload or AI-generated) via Firebase Storage
- [x] Delivery/open analytics via Resend webhooks
- [ ] Google sign-in for hosts (upgrade from anonymous auth)
- [ ] Recurring reminders / auto-nudge schedule
- [ ] Shareable links (Paperless Post has these; explicitly untracked)
- [ ] Guest messaging (message all / message non-responders)
- [ ] Guest tags for list segmentation
- [ ] SMS invites via a second provider
- [ ] iCal feed per event

## Why open-source this?

Paperless Post charges per invite pack and locks your guest list in their silo. OpenInvite costs ~$0 at family scale, tracks only what the host needs (delivery + opens, disclosed in the email), and the whole thing fits in one repo you can read in an afternoon.

## License

MIT — see [LICENSE](LICENSE).
