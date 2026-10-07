// Canonical invitation email template for OpenInvite.
//
// Used by scripts/admin.js (Muse orchestration CLI). functions/index.js
// carries a copy because Cloud Functions deploys package only the
// functions/ directory — keep the two in sync when editing.

const THEME_COLORS = {
  confetti: "#e8590c", midnight: "#ffd43b", garden: "#2f9e44",
  ocean: "#1971c2", sunset: "#d9480f", minimal: "#111111",
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d.seconds * 1000);
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
    " at " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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

module.exports = { emailHtml, rsvpUrl };
