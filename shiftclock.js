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

  var api = { IST_OFFSET: IST_OFFSET, SHIFTS: SHIFTS, parts: parts, shiftAt: shiftAt, opDayAt: opDayAt, opDayOfRow: opDayOfRow,
              info: info, availability: availability, nextBoundary: nextBoundary, labelOfKey: labelOfKey, fmt: fmt };

  // ---- browser part: trusted time and a "something changed" watcher
  var offset = 0, synced = false;
  api.now = function () { return Date.now() + offset; };
  api.isSynced = function () { return synced; };
  // Ask the database for its clock once. If that fails (for example before 10 has been run) the device clock is used.
  api.sync = async function (db) {
    try {
      var t0 = Date.now();
      var res = await db.rpc("shift_clock");
      var t1 = Date.now();
      if (res.error || !res.data || !res.data.now) return false;
      var server = Date.parse(res.data.now);
      if (isNaN(server)) return false;
      offset = server - Math.round((t0 + t1) / 2);
      synced = true;
      return true;
    } catch (e) { return false; }
  };
  // Calls onChange(newInfo, oldInfo) when the shift or the Operational Day changes. Checks every 15 s and when the tab
  // becomes visible again, so a sleeping laptop or a throttled background tab still catches up. Returns a stop function.
  api.watch = function (onChange) {
    var last = info(api.now());
    function check() {
      var cur = info(api.now());
      if (cur.shift !== last.shift || cur.opDay !== last.opDay) { var old = last; last = cur; onChange(cur, old); }
    }
    var timer = setInterval(check, 15000);
    function vis() { if (!document.hidden) check(); }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", vis);
    return function () { clearInterval(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", vis); };
  };

  root.MineShiftClock = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
