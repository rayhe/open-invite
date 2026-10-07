# OpenInvite

Open-source digital invitations. A self-hosted [Paperless Post](https://www.paperlesspost.com) clone built on **Firebase + Resend**.

Create beautiful event invitations, email them to your guest list, and track RSVPs in real time. No per-invite fees, no tracking pixels, no ads. Your data stays in your Firebase project.

## Features

- **Event builder** — title, date/time, location, description, 6 design themes, RSVP deadline, +1s and "maybe" toggles
- **Guest list** — add guests manually or import CSV; each guest gets a unique, unguessable RSVP link
- **Email invitations via Resend** — themed HTML emails with one-tap RSVP buttons
- **RSVP pages** — accept / decline / maybe, party size, dietary notes, message to host, add-to-calendar (.ics download)
- **Host dashboard** — live counts, per-guest status, resend individual invites, nudge non-responders, export CSV
- **Privacy-first** — no tracking pixels, no third-party analytics, guest emails never exposed publicly

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
- **Backend:** two Firebase Cloud Functions (2nd gen) that send mail through Resend — the API key never touches the browser
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

cp public/firebase-config.example.js public/firebase-config.js
# paste your Firebase web config
```

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
functions/              Cloud Functions (Resend mailer)
  index.js              sendInvitations, sendReminders + email template
  .env                  RESEND_API_KEY etc (gitignored)
firebase.json           hosting + functions + firestore config
firestore.rules         security rules (see "Security model")
```

## Roadmap

- [ ] Google sign-in for hosts (upgrade from anonymous auth)
- [ ] Recurring reminders / auto-nudge schedule
- [ ] Photo uploads for covers (Firebase Storage)
- [ ] SMS invites via a second provider
- [ ] iCal feed per event

## Why open-source this?

Paperless Post charges per invite pack, pixels your guests for ad targeting, and locks your guest list in their silo. OpenInvite costs ~$0 at family scale, sends clean emails with no trackers, and the whole thing fits in one repo you can read in an afternoon.

## License

MIT — see [LICENSE](LICENSE).
