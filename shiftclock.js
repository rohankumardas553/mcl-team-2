/* shiftclock.js - the ONE definition of IST time, shift and Operational Day for every page.
 *
 * Shifts are fixed in Indian Standard Time (Asia/Kolkata, UTC+05:30, no daylight saving):
 *   First  05:00 (inclusive) - 13:00 (exclusive)
 *   Second 13:00 (inclusive) - 21:00 (exclusive)
 *   Night  21:00 (inclusive) - 05:00 (exclusive) the next morning
 * Operational Day: 05:00 IST on date D up to 04:59:59 IST on D+1 (so 02:30 IST on 02 Oct is Operational Day 01 Oct).
 *
 * Everything is worked out from a UTC millisecond value plus the fixed +05:30 offset. It never reads the
 * device timezone, so a phone set to another timezone gives the same answer. The device clock itself can still be
 * wrong, so pages ask the database for the trusted time once (sync) and use the difference.
 * The database repeats the shift check when a new exception is saved (10-ist-shift-control.sql).
 */
(function (root) {
  "use strict";
  var IST_OFFSET = 330 * 60 * 1000;           // +05:30
  var HOUR = 3600 * 1000, DAY = 24 * HOUR;
  var SHIFTS = ["First", "Second", "Night"];
  var START_HOUR = { First: 5, Second: 13, Night: 21 };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function toMs(t) { return t instanceof Date ? t.getTime() : typeof t === "string" ? Date.parse(t) : t; }

  // IST wall-clock parts of an instant.
  function parts(t) {
    var d = new Date(toMs(t) + IST_OFFSET);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds() };
  }
  function key(p) { return p.y + "-" + pad2(p.m) + "-" + pad2(p.d); }       // "2026-10-01"
  function labelOfKey(k) { var a = k.split("-"); return a[2] + " " + MONTHS[+a[1] - 1] + " " + a[0]; }  // "01 Oct 2026"

  function shiftAt(t) {
    var h = parts(t).hh;
    return h >= 5 && h < 13 ? "First" : h >= 13 && h < 21 ? "Second" : "Night";
  }
  // Operational Day key (IST date of the instant minus 5 hours).
  function opDayAt(t) { return key(parts(toMs(t) - 5 * HOUR)); }

  // Everything a page needs to say about an instant.
  function info(t) {
    var ms = toMs(t), p = parts(ms), s = shiftAt(ms), od = opDayAt(ms);
    return { ms: ms, shift: s, opDay: od, opDayLabel: labelOfKey(od), istDate: key(p), istDateLabel: labelOfKey(key(p)),
             time: pad2(p.hh) + ":" + pad2(p.mm), asOf: labelOfKey(key(p)) + ", " + pad2(p.hh) + ":" + pad2(p.mm) + " IST",
             shiftStart: pad2(START_HOUR[s]) + ":00" };
  }

  // Which shifts may be looked at for one Operational Day, given the current instant.
  // Past day: all three. Today: only shifts that have started (First always, Second from 13:00, Night from 21:00).
  // Future day: none. Never a zero for a shift that has not happened.
  function availability(nowInfo, dayKey) {
    var out = {};
    SHIFTS.forEach(function (s) {
      var ok;
      if (dayKey < nowInfo.opDay) ok = true;
      else if (dayKey > nowInfo.opDay) ok = false;
      else ok = s === "First" || (s === "Second" && nowInfo.shift !== "First") || (s === "Night" && nowInfo.shift === "Night");
      out[s] = { available: ok, from: pad2(START_HOUR[s]) + ":00 IST" };
    });
    return out;
  }

  // Next shift boundary (05:00, 13:00 or 21:00 IST) strictly after the instant.
  function nextBoundary(t) {
    var ms = toMs(t), p = parts(ms);
    var dayStart = ms - (p.hh * HOUR + p.mm * 60000 + p.ss * 1000) - (ms % 1000 + 1000) % 1000;   // IST midnight (ms precision)
    var cands = [5, 13, 21, 29].map(function (h) { return dayStart + h * HOUR; });
    for (var i = 0; i < cands.length; i++) if (cands[i] > ms) return cands[i];
    return cands[3];
  }

  // Operational Day key (IST date, 05:00 rule) of a stored created_at.
  function opDayOfRow(createdAt) { return opDayAt(createdAt); }

  // Date and time of a stored timestamp, always in IST ("01 Oct, 17:30"). Never the device timezone.
  function fmt(t) {
    var p = parts(t);
    return pad2(p.d) + " " + MONTHS[p.m - 1] + ", " + pad2(p.hh) + ":" + pad2(p.mm);
  }

  // ---- shift windows and handover helpers
  function dayKeyShift(key, n) {                                         // add n days to a "YYYY-MM-DD" key
    var a = key.split("-"), d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n));
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function opDayStartMs(key) { var a = key.split("-"); return Date.UTC(+a[0], +a[1] - 1, +a[2], 5, 0, 0) - IST_OFFSET; }   // 05:00 IST
  var SHIFT_OFFSET_H = { First: 0, Second: 8, Night: 16 };
  // [start, end) of one shift of one Operational Day, in UTC milliseconds. Night runs 21:00 -> 05:00 the next morning.
  function shiftWindow(opDayKey, shift) {
    var s = opDayStartMs(opDayKey) + SHIFT_OFFSET_H[shift] * HOUR;
    return { startMs: s, endMs: s + 8 * HOUR };
  }
  // The shift that has just ended: Second -> First (same day), Night -> Second (same day),
  // First -> Night of the PREVIOUS Operational Day (it started at 21:00 IST the evening before).
  function previousShift(nowInfo) {
    var shift = nowInfo.shift === "Second" ? "First" : nowInfo.shift === "Night" ? "Second" : "Night";
    var day = nowInfo.shift === "First" ? dayKeyShift(nowInfo.opDay, -1) : nowInfo.opDay;
    var w = shiftWindow(day, shift);
    return { shift: shift, opDay: day, opDayLabel: labelOfKey(day), startMs: w.startMs, endMs: w.endMs };
  }
  function shortLabelOfKey(k) { var a = k.split("-"); return a[2] + " " + MONTHS[+a[1] - 1]; }          // "30 Sep"
  // Factual age: "less than 1 min", "18 min", "1 h 35 min", "2 h", "1 d 3 h". Never negative.
  function ageText(ms) {
    if (!(ms >= 60000)) return "less than 1 min";
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return r ? h + " h " + r + " min" : h + " h";
    var d = Math.floor(h / 24), hh = h % 24;
    return hh ? d + " d " + hh + " h" : d + " d";
  }

  var api = { IST_OFFSET: IST_OFFSET, SHIFTS: SHIFTS, parts: parts, shiftAt: shiftAt, opDayAt: opDayAt, opDayOfRow: opDayOfRow,
              info: info, availability: availability, nextBoundary: nextBoundary, labelOfKey: labelOfKey, fmt: fmt,
              shiftWindow: shiftWindow, previousShift: previousShift, dayKeyShift: dayKeyShift, shortLabelOfKey: shortLabelOfKey, ageText: ageText };

  // ---- browser part: trusted time, periodic re-sync and a "something changed" watcher
  var offset = 0, synced = false, lastSyncAt = 0, theDb = null, syncing = null;
  var RESYNC_MS = 30 * 60 * 1000;            // re-ask the database about every 30 minutes while the page is active
  api.now = function () { return Date.now() + offset; };
  api.isSynced = function () { return synced; };
  api.offset = function () { return offset; };
  // Ask the database for its clock. On success the offset is replaced. On ANY failure the last trusted offset is kept
  // (it is never replaced by an untrusted device value), and false is returned.
  api.sync = function (db) {
    if (db) theDb = db;
    if (!theDb) return Promise.resolve(false);
    if (syncing) return syncing;
    syncing = (async function () {
      try {
        var t0 = Date.now();
        var res = await theDb.rpc("shift_clock");
        var t1 = Date.now();
        if (res.error || !res.data || !res.data.now) return false;
        var server = Date.parse(res.data.now);
        if (isNaN(server)) return false;
        offset = server - Math.round((t0 + t1) / 2);
        synced = true;
        lastSyncAt = Date.now();
        return true;
      } catch (e) { return false; }
      finally { syncing = null; }
    })();
    return syncing;
  };
  // The database named the current shift in an error message ("The current shift is Second (since 13:00 IST), ...").
  // That is authoritative, so it is used for an immediate correction when a re-sync is not possible. Valid for 10 minutes.
  var authoritative = null;
  api.setAuthoritativeShift = function (shift) { authoritative = SHIFTS.indexOf(shift) >= 0 ? { shift: shift, at: Date.now() } : null; };
  api.authoritativeShift = function () { return authoritative && Date.now() - authoritative.at < 10 * 60 * 1000 ? authoritative.shift : null; };
  api.shiftFromError = function (message) {
    var m = /current shift is (First|Second|Night)/i.exec(message || "");
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : null;
  };

  // Calls onChange(newInfo, oldInfo) when the shift or the Operational Day changes. Cheap check every 15 s.
  // Re-syncs with the database when: the tab becomes visible again, the network comes back, 30 minutes have passed,
  // or the device clock jumped (sleep/wake, or the clock was changed by hand: the 15 s tick took far more or less than 15 s).
  // Returns a stop function.
  api.watch = function (onChange) {
    var last = info(api.now()), lastTick = Date.now();
    function check() {
      var cur = info(api.now());
      if (cur.shift !== last.shift || cur.opDay !== last.opDay) { var old = last; last = cur; onChange(cur, old); }
    }
    async function resyncThenCheck() { await api.sync(); check(); }
    function tick() {
      var nowDev = Date.now(), gap = nowDev - lastTick;
      lastTick = nowDev;
      if (gap > 45000 || gap < 0 || nowDev - lastSyncAt > RESYNC_MS) resyncThenCheck(); else check();
    }
    var timer = setInterval(tick, 15000);
    function vis() { if (typeof document === "undefined" || !document.hidden) { lastTick = Date.now(); resyncThenCheck(); } }
    function online() { resyncThenCheck(); }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", vis);
    if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("online", online);
    return function () {
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", vis);
      if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("online", online);
    };
  };

  root.MineShiftClock = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
