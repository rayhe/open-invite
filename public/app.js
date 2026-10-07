/* OpenInvite shared client helpers. Load after firebase-config.js + Firebase SDK compat scripts. */
(function () {
  "use strict";

  var THEMES = {
    confetti: { name: "Confetti", bg: "#e8590c", bg2: "#f76707", dots: ["#e8590c", "#ffd43b", "#3bc9db"] },
    midnight: { name: "Midnight", bg: "#1d2030", bg2: "#14161f", dots: ["#ffd43b", "#4c6ef5", "#1d2030"] },
    garden:   { name: "Garden", bg: "#2f9e44", bg2: "#2b8a3e", dots: ["#2f9e44", "#94d82d", "#e6fcf5"] },
    ocean:    { name: "Ocean", bg: "#1971c2", bg2: "#1864ab", dots: ["#1971c2", "#66d9e8", "#e7f5ff"] },
    sunset:   { name: "Sunset", bg: "#d9480f", bg2: "#e8590c", dots: ["#d9480f", "#ffa94d", "#ffd8a8"] },
    minimal:  { name: "Minimal", bg: "#111111", bg2: "#333333", dots: ["#111111", "#888888", "#e8e8e8"] }
  };

  var app = null, auth = null, db = null, functions = null;

  function initFirebase() {
    if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey ||
        window.FIREBASE_CONFIG.apiKey.indexOf("YOUR_") === 0) {
      throw new Error("Missing Firebase config — copy public/firebase-config.example.js to public/firebase-config.js");
    }
    app = firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    functions = firebase.functions();
    return { app: app, auth: auth, db: db, functions: functions };
  }

  // Anonymous sign-in; returns the persistent uid for this browser.
  function ensureHost() {
    return auth.signInAnonymously().then(function (cred) { return cred.user.uid; });
  }
  function currentUid() { return auth.currentUser && auth.currentUser.uid; }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
  function fmtTime(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function newToken() {
    var a = new Uint8Array(24);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256 | 0; });
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function rsvpUrl(eventId, guestId, token) {
    return location.origin + "/rsvp.html?e=" + encodeURIComponent(eventId) +
      "&g=" + encodeURIComponent(guestId) + "&t=" + encodeURIComponent(token);
  }

  // Minimal .ics download for "Add to calendar".
  function downloadICS(ev) {
    function icsDate(d) {
      function p(n) { return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "T" +
             p(d.getHours()) + p(d.getMinutes()) + "00";
    }
    var start = ev.startsAt.toDate ? ev.startsAt.toDate() : new Date(ev.startsAt);
    var end = new Date(start.getTime() + 2 * 3600 * 1000);
    var ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenInvite//EN", "BEGIN:VEVENT",
      "UID:" + ev.id + "@openinvite",
      "DTSTAMP:" + icsDate(new Date()),
      "DTSTART:" + icsDate(start),
      "DTEND:" + icsDate(end),
      "SUMMARY:" + (ev.title || "Invitation").replace(/[,;]/g, " "),
      "LOCATION:" + String(ev.location || "").replace(/[,;]/g, " "),
      "DESCRIPTION:" + String(ev.description || "").replace(/[,;\\n]/g, " ").slice(0, 500),
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    var blob = new Blob([ics], { type: "text/calendar" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "invitation.ics";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function parseCSV(text) {
    // Minimal CSV: name,email per line; handles quoted fields.
    var rows = [], row = [], cur = "", q = false;
    text += "\n";
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (cur !== "" || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; }
      } else cur += c;
    }
    return rows.map(function (r) { return { name: (r[0] || "").trim(), email: (r[1] || "").trim() }; })
               .filter(function (r) { return r.name || r.email; });
  }

  function applyTheme(name) {
    document.body.setAttribute("data-theme", THEMES[name] ? name : "confetti");
  }

  window.OI = {
    THEMES: THEMES,
    initFirebase: initFirebase, ensureHost: ensureHost, currentUid: currentUid,
    toast: toast, esc: esc, fmtDate: fmtDate, fmtTime: fmtTime,
    newToken: newToken, rsvpUrl: rsvpUrl, downloadICS: downloadICS,
    parseCSV: parseCSV, applyTheme: applyTheme,
    get db() { return db; }, get auth() { return auth; }, get functions() { return functions; }
  };
})();
