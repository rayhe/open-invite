#!/usr/bin/env node
// OpenInvite admin CLI — lets Muse orchestrate the entire invitation flow
// without a browser: create event, add guests, set cover art, send mail,
// check the analytics funnel, send reminders.
//
//   npm install        # installs firebase-admin (once)
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
//   export FIREBASE_PROJECT=your-project-id
//   export RESEND_API_KEY=re_... RESEND_FROM="Name <invites@yourdomain>"
//   export APP_BASE_URL=https://your-project.web.app
//   # optional: OPENINVITE_OWNER_UID=<your browser's anonymous uid>
//   #   (event page console: OI.currentUid()) so the web dashboard
//   #   treats you as owner. Without it, manage via this CLI.
//
// Commands:
//   create-event --title T --date YYYY-MM-DD --time HH:MM --location L --host H [opts]
//   add-guests   --event ID (--csv "Name,email\n...") | (--file guests.csv)
//   set-cover    --event ID --file ./cover.png
//   send         --event ID [--only-pending] [--remind] [--guest ID ...]
//   stats        --event ID
//   list-guests  --event ID

const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { emailHtml } = require("./email-template");

const projectId = process.env.FIREBASE_PROJECT;
if (!projectId) { console.error("Set FIREBASE_PROJECT"); process.exit(1); }
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
const db = admin.firestore();
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.includes(name); }
function need(name, v) { if (!v) { console.error(`Missing ${name}`); process.exit(1); } return v; }

async function getEvent(id) {
  const snap = await db.collection("events").doc(id).get();
  if (!snap.exists) { console.error("Event not found: " + id); process.exit(1); }
  return { id: snap.id, ...snap.data() };
}

async function createEvent() {
  const title = need("--title", arg("--title"));
  const date = need("--date", arg("--date"));
  const time = arg("--time", "15:00");
  const startsAt = new Date(`${date}T${time}:00`);
  if (isNaN(startsAt)) { console.error("Bad date/time"); process.exit(1); }
  const deadline = arg("--deadline");
  const ref = db.collection("events").doc();
  await ref.set({
    title,
    hostName: arg("--host", ""),
    startsAt: admin.firestore.Timestamp.fromDate(startsAt),
    location: arg("--location", ""),
    locationUrl: arg("--location-url", ""),
    description: arg("--description", ""),
    rsvpDeadline: deadline ? admin.firestore.Timestamp.fromDate(new Date(`${deadline}T23:59:00`)) : null,
    allowPlusOnes: !flag("--no-plus-ones"),
    allowMaybe: !flag("--no-maybe"),
    theme: arg("--theme", "confetti"),
    coverImageUrl: arg("--cover-url", ""),
    published: true,
    ownerUid: process.env.OPENINVITE_OWNER_UID || "admin-cli",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  console.log(JSON.stringify({
    eventId: ref.id,
    dashboard: `${base}/event.html?id=${ref.id}`,
  }, null, 2));
}

function parseCsv(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(",");
    return { name: (i < 0 ? l : l.slice(0, i)).trim(), email: (i < 0 ? "" : l.slice(i + 1)).trim() };
  }).filter((r) => r.name || r.email);
}

async function addGuests() {
  const eventId = need("--event", arg("--event"));
  await getEvent(eventId);
  let rows = [];
  if (arg("--file")) rows = parseCsv(fs.readFileSync(arg("--file"), "utf8"));
  else if (arg("--csv")) rows = parseCsv(arg("--csv"));
  else { console.error("Provide --csv or --file"); process.exit(1); }
  const col = db.collection("events").doc(eventId).collection("guests");
  let n = 0;
  for (const r of rows) {
    const ref = col.doc();
    const batch = db.batch();
    batch.set(ref, {
      name: r.name, token: crypto.randomBytes(16).toString("hex"),
      rsvpStatus: "pending", partySize: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (r.email) batch.set(ref.collection("private").doc("contact"), { email: r.email });
    await batch.commit();
    n++;
  }
  console.log(`Added ${n} guest(s) to ${eventId}`);
}

async function setCover() {
  const eventId = need("--event", arg("--event"));
  const file = need("--file", arg("--file"));
  await getEvent(eventId);
  const bucket = admin.storage().bucket(bucketName);
  const dest = `covers/${eventId}/cover${path.extname(file) || ".png"}`;
  await bucket.upload(file, { destination: dest, metadata: { contentType: "image/png" } });
  await bucket.file(dest).makePublic();
  const url = `https://storage.googleapis.com/${bucketName}/${dest}`;
  await db.collection("events").doc(eventId).update({ coverImageUrl: url });
  console.log("Cover set:", url);
}

async function sendResend({ from, to, subject, html }) {
  const key = need("RESEND_API_KEY", process.env.RESEND_API_KEY);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || JSON.stringify(body));
  return body.id;
}

async function send() {
  const eventId = need("--event", arg("--event"));
  const ev = await getEvent(eventId);
  const remind = flag("--remind");
  const base = need("APP_BASE_URL", process.env.APP_BASE_URL).replace(/\/$/, "");
  const from = need("RESEND_FROM", process.env.RESEND_FROM);
  let ids = [];
  const onlyIds = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--guest" && process.argv[i + 1]) onlyIds.push(process.argv[i + 1]);
  }
  const snap = await db.collection("events").doc(eventId).collection("guests").get();
  snap.forEach((d) => {
    const g = d.data();
    if (onlyIds.length && !onlyIds.includes(d.id)) return;
    if (flag("--only-pending") && g.rsvpStatus && g.rsvpStatus !== "pending") return;
    ids.push({ id: d.id, ...g });
  });
  let sent = 0, failed = 0;
  for (const g of ids) {
    try {
      const csnap = await db.collection("events").doc(eventId)
        .collection("guests").doc(g.id).collection("private").doc("contact").get();
      const email = csnap.exists && csnap.data().email;
      if (!email) throw new Error("no email on file");
      const emailId = await sendResend({
        from, to: email,
        subject: `${remind ? "Reminder: " : ""}You're invited: ${ev.title}`,
        html: emailHtml({ ev, guest: g, base, reminder: remind }),
      });
      const gref = db.collection("events").doc(eventId).collection("guests").doc(g.id);
      await gref.update({
        resendId: emailId, invitedAt: admin.firestore.FieldValue.serverTimestamp(), deliveryStatus: "sent",
      });
      await db.collection("mailmap").doc(emailId).set({
        eventId, guestId: g.id, sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      sent++;
      console.log(`  ✓ ${g.name} <${email}>`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${g.name}: ${e.message}`);
    }
  }
  console.log(`Sent ${sent}, failed ${failed}`);
}

async function stats() {
  const eventId = need("--event", arg("--event"));
  await getEvent(eventId);
  const snap = await db.collection("events").doc(eventId).collection("guests").get();
  const f = { invited: 0, sent: 0, delivered: 0, bounced: 0, opened: 0, visited: 0, accepted: 0, maybe: 0, declined: 0, pending: 0, heads: 0 };
  snap.forEach((d) => {
    const g = d.data();
    f.invited++;
    if (g.invitedAt) f.sent++;
    if (g.deliveryStatus === "delivered" || g.deliveredAt) f.delivered++;
    if (g.deliveryStatus === "bounced") f.bounced++;
    if (g.emailOpenedAt) f.opened++;
    if (g.linkOpenedAt || g.linkClickedAt) f.visited++;
    const s = g.rsvpStatus || "pending";
    if (f[s] != null) f[s]++;
    if (s === "accepted") f.heads += 1 + (g.partySize || 0);
  });
  console.log(`Funnel for ${eventId}:`);
  console.log(`  Sent ${f.sent} → Delivered ${f.delivered} → Opened ${f.opened} → Link visited ${f.visited}`);
  console.log(`  Accepted ${f.accepted} · Maybe ${f.maybe} · Declined ${f.declined} · Pending ${f.pending}`);
  console.log(`  Expected heads (incl. +1s): ${f.heads}${f.bounced ? ` · ⚠️ ${f.bounced} bounced` : ""}`);
}

async function listGuests() {
  const eventId = need("--event", arg("--event"));
  await getEvent(eventId);
  const snap = await db.collection("events").doc(eventId).collection("guests").orderBy("createdAt").get();
  snap.forEach((d) => {
    const g = d.data();
    console.log(`${d.id}  ${g.name}  [${g.rsvpStatus || "pending"}]  delivery=${g.deliveryStatus || "-"}  opened=${g.emailOpenedAt ? "yes" : "-"}  visited=${g.linkOpenedAt ? "yes" : "-"}`);
  });
}

(async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === "create-event") await createEvent();
    else if (cmd === "add-guests") await addGuests();
    else if (cmd === "set-cover") await setCover();
    else if (cmd === "send") await send();
    else if (cmd === "stats") await stats();
    else if (cmd === "list-guests") await listGuests();
    else { console.error("Commands: create-event, add-guests, set-cover, send, stats, list-guests"); process.exit(1); }
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exit(1);
  }
})();
