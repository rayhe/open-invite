// OpenInvite mailer — Firebase Cloud Functions (2nd gen) + Resend.
//
//   sendInvitations({eventId, guestIds})  — first invite email per guest
//   sendReminders({eventId, guestIds})    — nudge guests who haven't responded
//   resendWebhook (HTTP)                 — Resend delivery/open/click events
//
// Env (functions/.env, never committed):
//   RESEND_API_KEY, RESEND_FROM, APP_BASE_URL, RESEND_WEBHOOK_SECRET
//
// Webhook setup: Resend dashboard → Webhooks → add
//   https://<region>-<project>.cloudfunctions.net/resendWebhook
// Enable events: email.delivered, email.bounced, email.complained,
// email.opened, email.clicked. Turn on open/click tracking in
// Resend → Domains → your domain → Tracking.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const THEME_COLORS = {
  confetti: "#e8590c", midnight: "#ffd43b", garden: "#2f9e44",
  ocean: "#1971c2", sunset: "#d9480f", minimal: "#111111",
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
    " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function rsvpUrl(base, eventId, guest) {
  return `${base}/rsvp.html?e=${encodeURIComponent(eventId)}&g=${encodeURIComponent(guest.id)}&t=${encodeURIComponent(guest.token)}`;
}

function emailHtml({ ev, guest, base, reminder }) {
  const color = THEME_COLORS[ev.theme] || THEME_COLORS.confetti;
  const url = rsvpUrl(base, ev.id, guest);
  const first = esc((guest.name || "friend").split(" ")[0]);
  const cover = ev.coverImageUrl
    ? `<img src="${esc(ev.coverImageUrl)}" alt="" style="width:100%;max-height:280px;object-fit:cover;display:block;border-radius:16px 16px 0 0;" />` : "";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#faf8f4;font-family:Georgia,serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  ${cover}
  <div style="background:linear-gradient(135deg,${color},${color}cc);${cover ? "" : "border-radius:16px 16px 0 0;"}padding:40px 24px;text-align:center;color:#ffffff;">
    <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:.85;margin-bottom:8px;">You're invited</div>
    <div style="font-size:30px;font-weight:bold;line-height:1.25;">${esc(ev.title)}</div>
    ${ev.hostName ? `<div style="margin-top:8px;opacity:.9;">hosted by ${esc(ev.hostName)}</div>` : ""}
  </div>
  <div style="background:#ffffff;border:1px solid #ece5d8;border-top:none;border-radius:0 0 16px 16px;padding:28px 24px;color:#23201a;">
    <p style="font-size:16px;">Hi ${first},</p>
    <p style="font-size:16px;">${reminder ? "Just a friendly nudge — we haven't heard from you yet and we'd love to know if you can make it." : "We'd love for you to join us."}</p>
    <table style="margin:20px 0;font-size:15px;" cellpadding="6">
      <tr><td style="font-weight:bold;color:#8a8378;font-size:12px;text-transform:uppercase;">When</td><td>${esc(fmtDate(ev.startsAt))}</td></tr>
      ${ev.location ? `<tr><td style="font-weight:bold;color:#8a8378;font-size:12px;text-transform:uppercase;">Where</td><td>${esc(ev.location)}</td></tr>` : ""}
    </table>
    ${ev.description ? `<p style="font-size:15px;color:#555;">${esc(ev.description)}</p>` : ""}
    <div style="text-align:center;margin:28px 0;">
      <a href="${url}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-family:sans-serif;font-weight:bold;font-size:16px;padding:14px 36px;border-radius:999px;">RSVP now</a>
    </div>
    <p style="font-size:12px;color:#8a8378;">Trouble with the button? Paste this link into your browser:<br><span style="word-break:break-all;">${url}</span></p>
    ${ev.rsvpDeadline ? `<p style="font-size:13px;color:#8a8378;">Please respond by ${esc(fmtDate(ev.rsvpDeadline))}.</p>` : ""}
  </div>
  <p style="text-align:center;font-size:11px;color:#b3aa99;margin-top:20px;">Sent with OpenInvite · opens are tracked so your host knows you got this</p>
</div></body></html>`;
}

async function loadEventForCaller(eventId, uid) {
  const snap = await db.collection("events").doc(eventId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
  const ev = { id: snap.id, ...snap.data() };
  if (ev.ownerUid !== uid) throw new HttpsError("permission-denied", "Not your event.");
  return ev;
}

async function mailGuests({ ev, guestIds, reminder }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!apiKey || !from || !base) {
    throw new HttpsError("failed-precondition",
      "Mail not configured — set RESEND_API_KEY, RESEND_FROM, APP_BASE_URL in functions/.env");
  }
  const resend = new Resend(apiKey);
  let sent = 0, failed = 0;
  const errors = [];
  for (const gid of guestIds) {
    try {
      const gref = db.collection("events").doc(ev.id).collection("guests").doc(gid);
      const gsnap = await gref.get();
      if (!gsnap.exists) throw new Error("guest not found");
      const guest = { id: gsnap.id, ...gsnap.data() };
      const csnap = await gref.collection("private").doc("contact").get();
      const email = csnap.exists && csnap.data().email;
      if (!email) throw new Error("no email on file");
      const { data, error } = await resend.emails.send({
        from,
        to: email,
        subject: `${reminder ? "Reminder: " : ""}You're invited: ${ev.title}`,
        html: emailHtml({ ev, guest, base, reminder }),
      });
      if (error) throw new Error(error.message);
      sent++;
      // Map Resend's email id back to this guest for webhook attribution.
      await gref.update({
        resendId: data.id,
        invitedAt: admin.firestore.FieldValue.serverTimestamp(),
        deliveryStatus: "sent",
      });
      await db.collection("mailmap").doc(data.id).set({
        eventId: ev.id, guestId: gid,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      failed++;
      errors.push(`${gid}: ${e.message}`);
    }
  }
  return { sent, failed, errors: errors.slice(0, 10) };
}

exports.sendInvitations = onCall({ region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const { eventId, guestIds } = req.data || {};
  if (!eventId || !Array.isArray(guestIds) || !guestIds.length) {
    throw new HttpsError("invalid-argument", "eventId and guestIds[] required.");
  }
  const ev = await loadEventForCaller(eventId, req.auth.uid);
  return mailGuests({ ev, guestIds: guestIds.slice(0, 200), reminder: false });
});

exports.sendReminders = onCall({ region: "us-central1" }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const { eventId, guestIds } = req.data || {};
  if (!eventId || !Array.isArray(guestIds) || !guestIds.length) {
    throw new HttpsError("invalid-argument", "eventId and guestIds[] required.");
  }
  const ev = await loadEventForCaller(eventId, req.auth.uid);
  return mailGuests({ ev, guestIds: guestIds.slice(0, 200), reminder: true });
});

// ---- Resend webhooks: delivery + open + click tracking -------------------
// Resend signs webhooks (Svix). Configure RESEND_WEBHOOK_SECRET from the
// Resend dashboard (Webhooks → your endpoint → Signing Secret).

function verifySvix(rawBody, headers, secret) {
  try {
    const id = headers["svix-id"], ts = headers["svix-timestamp"], sig = headers["svix-signature"];
    if (!id || !ts || !sig || !secret) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // stale
    const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
    return String(sig).split(" ").some((s) => {
      const v = s.split(",")[1];
      return v && v.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected));
    });
  } catch { return false; }
}

exports.resendWebhook = onRequest({ region: "us-central1" }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("method not allowed"); return; }
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret && !verifySvix(req.rawBody.toString("utf8"), req.headers, secret)) {
    res.status(401).send("bad signature"); return;
  }
  const { type, data } = req.body || {};
  const emailId = data && data.email_id;
  if (!type || !emailId) { res.status(200).send("ignored"); return; }

  try {
    const mmap = await db.collection("mailmap").doc(emailId).get();
    if (!mmap.exists) { res.status(200).send("unknown email"); return; }
    const { eventId, guestId } = mmap.data();
    const gref = db.collection("events").doc(eventId).collection("guests").doc(guestId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch = {};
    if (type === "email.delivered") { patch.deliveryStatus = "delivered"; patch.deliveredAt = now; }
    else if (type === "email.bounced") { patch.deliveryStatus = "bounced"; patch.bouncedAt = now; }
    else if (type === "email.complained") { patch.deliveryStatus = "complained"; }
    else if (type === "email.opened") { patch.emailOpenedAt = now; }
    else if (type === "email.clicked") { patch.linkClickedAt = now; }
    if (Object.keys(patch).length) await gref.update(patch);
    res.status(200).send("ok");
  } catch (e) {
    console.error("webhook failed", e);
    res.status(500).send("error");
  }
});
