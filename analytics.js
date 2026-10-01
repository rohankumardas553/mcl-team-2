// analytics.js - historical analytics for MineShift Command (Phase C).
// Management view for Shift In-Charge, Manager, Project Officer and General Manager only.
//
// It only READS rows that the signed-in person is already allowed to select
// (shift_exceptions and exception_audit). It never writes, and it needs no database function
// or view. All numbers are worked out in the browser by compute(), which is plain JavaScript
// with no page code, so it can be tested on its own.
//
// Rules used everywhere (see CLAUDE.md, "Phase C analytics"):
//  - the selected period filters by created_at (browser local time);
//  - "reopened" = the exception has at least one exception_audit line with action 'reopened';
//  - Time to Start uses the current started_at, Time to Resolve uses the current resolved_at
//    of currently Resolved records. Multiple lifecycle cycles are NOT accounted for.
(function (root) {
  "use strict";

  var CATEGORIES = ["Coal Despatch", "Dust Suppression", "Haul Road", "Coal Quality"];
  var SHIFTS = ["First", "Second", "Night"];
  var LOCATIONS = ["ABC Patch", "XYZ Patch", "Haul Road A", "Haul Road B",
                   "MDP Junction", "Stockyard 1", "Siding 1", "Siding 2"];
  var PRIORITIES = ["High", "Medium", "Low"];
  var DAY = 24 * 60 * 60 * 1000;

  // ------------------------------------------------------------------ small helpers
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function monthKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }
  function num(n) { return Math.round(n).toLocaleString("en-US"); }
  function one(n) { return (Math.round(n * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function pct(part, whole) { return whole ? (part / whole * 100).toFixed(1) + "%" : null; }

  function median(values) {
    if (!values.length) return null;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function mean(values) {
    if (!values.length) return null;
    var s = 0;
    values.forEach(function (x) { s += x; });
    return s / values.length;
  }
  function minutesBetween(a, b) { return (Date.parse(b) - Date.parse(a)) / 60000; }

  function byMinutesThenCount(a, b) {
    return (b.minutes - a.minutes) || (b.count - a.count) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  }

  // ------------------------------------------------------------------ date range
  // preset: "7" | "30" | "90" | "all" | "custom". fromStr / toStr: "YYYY-MM-DD" (custom only).
  // Returns { from: Date|null, to: Date|null (exclusive), error?: string }.
  //   Last N days = today and the N-1 days before it (local calendar days).
  //   Custom From / To are both included.
  function resolveRange(preset, fromStr, toStr, now) {
    now = now || new Date();
    if (preset === "all") return { from: null, to: null };
    if (preset === "7" || preset === "30" || preset === "90") {
      return { from: addDays(startOfDay(now), -(parseInt(preset, 10) - 1)), to: null };
    }
    function parse(s) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    var f = parse(fromStr), t = parse(toStr);
    if (!f || !t) return { from: null, to: null, error: "Please choose both a From date and a To date." };
    if (f > t) return { from: null, to: null, error: "The From date must not be after the To date." };
    return { from: f, to: addDays(t, 1) };
  }

  // ------------------------------------------------------------------ time series
  function buildSeries(rows, range, now) {
    var first = null;
    rows.forEach(function (r) {
      var d = new Date(r.created_at);
      if (!first || d < first) first = d;
    });
    var from = range.from || first;
    if (!from) return { mode: "day", keys: [], labels: [], counts: [], impact: [] };
    var toIncl = range.to ? new Date(range.to.getTime() - 1) : now;
    if (toIncl < from) toIncl = from;
    var spanDays = Math.round((startOfDay(toIncl) - startOfDay(from)) / DAY) + 1;
    var mode = spanDays <= 90 ? "day" : "month";
    var keys = [], labels = [];
    if (mode === "day") {
      for (var d = startOfDay(from); d <= toIncl; d = addDays(d, 1)) {
        keys.push(dayKey(d));
        labels.push(d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }));
      }
    } else {
      for (var m = new Date(from.getFullYear(), from.getMonth(), 1);
           m <= toIncl; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
        keys.push(monthKey(m));
        labels.push(m.toLocaleDateString(undefined, { month: "short", year: "numeric" }));
      }
    }
    var index = {};
    keys.forEach(function (k, i) { index[k] = i; });
    var counts = keys.map(function () { return 0; });
    var impact = keys.map(function () { return 0; });
    rows.forEach(function (r) {
      var d = new Date(r.created_at);
      var i = index[mode === "day" ? dayKey(d) : monthKey(d)];
      if (i !== undefined) { counts[i] += 1; impact[i] += r.impact_minutes || 0; }
    });
    return { mode: mode, keys: keys, labels: labels, counts: counts, impact: impact };
  }

  // ------------------------------------------------------------------ management attention
  // Deterministic facts only: no prediction, no advice, no thresholds.
  function tiedTop(list, value) {
    if (!list.length) return [];
    var top = value(list[0]);
    return list.filter(function (x) { return value(x) === top; });
  }
  function nameList(names) {
    return names.slice(0, 3).join("; ") + (names.length > 3 ? " and " + (names.length - 3) + " more" : "");
  }

  function attention(s) {
    var out = [];
    var NONE = "Not enough historical data for a meaningful comparison.";
    if (!s.total) return [NONE];

    // 1. Category + location with the highest total impact.
    if (s.hotspotsAll.length >= 2 && s.hotspotsAll[0].minutes > 0) {
      var t1 = tiedTop(s.hotspotsAll, function (x) { return x.minutes; });
      if (t1.length === 1) {
        out.push(t1[0].category + " at " + t1[0].location + " has the highest total impact in this period: " +
          num(t1[0].minutes) + " minutes across " + t1[0].count + " exception" + (t1[0].count === 1 ? "" : "s") + ".");
      } else {
        out.push(t1.length + " category and location combinations share the highest total impact in this period (" +
          num(t1[0].minutes) + " minutes each): " +
          nameList(t1.map(function (x) { return x.category + " at " + x.location; })) + ".");
      }
    }
    // 2. Category share of total impact minutes.
    var cats = s.byCategory.filter(function (c) { return c.count > 0; })
      .sort(function (a, b) { return (b.minutes - a.minutes) || (a.name < b.name ? -1 : 1); });
    if (cats.length >= 2 && s.totalImpact > 0 && cats[0].minutes > 0) {
      var t2 = tiedTop(cats, function (x) { return x.minutes; });
      var share = pct(t2[0].minutes, s.totalImpact);
      out.push(t2.length === 1
        ? t2[0].name + " accounts for " + share + " of total impact minutes in the selected period."
        : t2.map(function (x) { return x.name; }).join(" and ") + " each account for " + share +
          " of total impact minutes in the selected period.");
    }
    // 3. Most recurring issue type.
    if (s.issuesAll.length >= 2) {
      var t3 = tiedTop(s.issuesAll, function (x) { return x.count; });
      out.push(t3.length === 1
        ? t3[0].issue + " (" + t3[0].category + ") is the most recurring issue type with " + t3[0].count + " exception" + (t3[0].count === 1 ? "" : "s") + "."
        : nameList(t3.map(function (x) { return x.issue + " (" + x.category + ")"; })) +
          " are the most recurring issue types with " + t3[0].count + " exception" + (t3[0].count === 1 ? "" : "s") + " each.");
    }
    // Fillers, only when fewer than 3 statements exist above.
    if (out.length < 3) {
      var locs = s.byLocation.filter(function (l) { return l.count > 0; })
        .sort(function (a, b) { return (b.minutes - a.minutes) || (a.name < b.name ? -1 : 1); });
      if (locs.length >= 2 && locs[0].minutes > 0) {
        var t4 = tiedTop(locs, function (x) { return x.minutes; });
        out.push(t4.length === 1
          ? t4[0].name + " has the highest total impact of any location in this period: " + num(t4[0].minutes) +
            " minutes across " + t4[0].count + " exception" + (t4[0].count === 1 ? "" : "s") + "."
          : t4.map(function (x) { return x.name; }).join(" and ") + " share the highest total impact of any location in this period (" +
            num(t4[0].minutes) + " minutes each).");
      }
    }
    return out.length ? out.slice(0, 3) : [NONE];
  }

  // ------------------------------------------------------------------ the whole computation
  // rows: exceptions already filtered by the page (created_at range, shift, category, location).
  // reopenedIds / priorityChangedIds: objects used as sets ({ id: true }).
  function compute(rows, reopenedIds, priorityChangedIds, range, now) {
    now = now || new Date();
    reopenedIds = reopenedIds || {};
    priorityChangedIds = priorityChangedIds || {};
    var total = rows.length;
    var totalImpact = 0, resolvedCount = 0, reopened = 0, priorityChanges = 0;
    var startMins = [], resolveMins = [];

    var byCat = {}, byLoc = {}, byShift = {}, combos = {}, groups = {}, issues = {};
    var activeCat = {};   // exceptions of this period that are not Resolved (for the composition donuts)
    CATEGORIES.forEach(function (c) { byCat[c] = { name: c, count: 0, minutes: 0 }; activeCat[c] = { name: c, count: 0, minutes: 0 }; });
    LOCATIONS.forEach(function (l) { byLoc[l] = { name: l, count: 0, minutes: 0 }; });
    SHIFTS.forEach(function (x) { byShift[x] = { name: x, count: 0, minutes: 0 }; });
    var priority = { High: { count: 0, minutes: 0 }, Medium: { count: 0, minutes: 0 },
                     Low: { count: 0, minutes: 0 }, none: { count: 0, minutes: 0 } };

    rows.forEach(function (r) {
      var m = r.impact_minutes || 0;
      var wasReopened = !!reopenedIds[r.id];
      totalImpact += m;
      if (r.status === "Resolved") resolvedCount += 1;
      if (wasReopened) reopened += 1;
      if (priorityChangedIds[r.id]) priorityChanges += 1;

      if (r.started_at) {
        var ts = minutesBetween(r.created_at, r.started_at);
        if (ts >= 0) startMins.push(ts);
      }
      if (r.status === "Resolved" && r.resolved_at) {
        var tr = minutesBetween(r.created_at, r.resolved_at);
        if (tr >= 0) resolveMins.push(tr);
      }

      if (!byCat[r.category]) byCat[r.category] = { name: r.category, count: 0, minutes: 0 };
      if (!byLoc[r.location]) byLoc[r.location] = { name: r.location, count: 0, minutes: 0 };
      if (!byShift[r.shift]) byShift[r.shift] = { name: r.shift, count: 0, minutes: 0 };
      [byCat[r.category], byLoc[r.location], byShift[r.shift]].forEach(function (b) { b.count += 1; b.minutes += m; });

      if (r.status !== "Resolved") {
        var ac = activeCat[r.category] || (activeCat[r.category] = { name: r.category, count: 0, minutes: 0 });
        ac.count += 1; ac.minutes += m;
      }

      var pk = PRIORITIES.indexOf(r.current_priority) >= 0 ? r.current_priority : "none";
      priority[pk].count += 1; priority[pk].minutes += m;

      var ck = r.category + "|" + r.location;
      var c = combos[ck] || (combos[ck] = { category: r.category, location: r.location, count: 0, minutes: 0 });
      c.count += 1; c.minutes += m;

      var gk = r.category + "|" + r.issue_type + "|" + r.location;
      var g = groups[gk] || (groups[gk] = { category: r.category, issue: r.issue_type, location: r.location,
        count: 0, minutes: 0, resolved: 0, reopened: 0, last: null });
      g.count += 1; g.minutes += m;
      if (r.status === "Resolved") g.resolved += 1;
      if (wasReopened) g.reopened += 1;
      if (!g.last || Date.parse(r.created_at) > Date.parse(g.last)) g.last = r.created_at;

      var ik = r.category + "|" + r.issue_type;
      var i = issues[ik] || (issues[ik] = { category: r.category, issue: r.issue_type, count: 0, minutes: 0 });
      i.count += 1; i.minutes += m;
    });

    function toList(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
    var hotspotsAll = toList(combos).map(function (c) { c.label = c.category + " " + c.location; return c; })
      .sort(byMinutesThenCount);
    var constraints = toList(groups).map(function (g) {
      g.label = g.category + " " + g.issue + " " + g.location;
      g.avg = g.count ? g.minutes / g.count : 0;
      return g;
    }).sort(byMinutesThenCount);
    var issuesAll = toList(issues).map(function (x) { x.label = x.issue + " " + x.category; return x; })
      .sort(function (a, b) { return (b.count - a.count) || (b.minutes - a.minutes) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0); });

    var result = {
      total: total,
      totalImpact: totalImpact,
      avgImpact: total ? totalImpact / total : null,
      timeToStart: { n: startMins.length, avg: mean(startMins), median: median(startMins) },
      timeToResolve: { n: resolveMins.length, avg: mean(resolveMins), median: median(resolveMins) },
      reopened: reopened,
      resolvedCount: resolvedCount,
      pctResolved: pct(resolvedCount, total),
      pctReopened: pct(reopened, total),
      priorityChanges: priorityChanges,
      priority: priority,
      series: buildSeries(rows, range || { from: null, to: null }, now),
      byCategory: CATEGORIES.map(function (c) { return byCat[c]; })
        .concat(Object.keys(byCat).filter(function (k) { return CATEGORIES.indexOf(k) < 0; }).map(function (k) { return byCat[k]; })),
      byLocation: LOCATIONS.map(function (l) { return byLoc[l]; })
        .concat(Object.keys(byLoc).filter(function (k) { return LOCATIONS.indexOf(k) < 0; }).map(function (k) { return byLoc[k]; })),
      byShift: SHIFTS.map(function (x) { return byShift[x]; })
        .concat(Object.keys(byShift).filter(function (k) { return SHIFTS.indexOf(k) < 0; }).map(function (k) { return byShift[k]; })),
      activeByCategory: Object.keys(activeCat).map(function (k) { return activeCat[k]; }),
      topIssues: issuesAll.slice(0, 10),
      issuesAll: issuesAll,
      hotspotsAll: hotspotsAll,
      hotspots: hotspotsAll.slice(0, 5),
      constraints: constraints
    };
    result.attention = attention(result);
    return result;
  }

  // ==================================================================== Phase D: period comparison
  // Compares the selected period with the immediately preceding period of the same length.
  // Facts only: no forecast, no advice, no score. See CLAUDE.md, "Phase D".

  // Number of whole calendar days from a to b (b exclusive), safe across clock changes.
  function calDays(a, b) {
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
                       Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  }

  // range = result of resolveRange(). Returns null for All time (no comparison).
  // Otherwise { days, cur: {from, to}, prev: {from, to} } with "to" always exclusive.
  // The previous period has the same number of calendar days and ends exactly where the
  // current one starts, so the two never overlap.
  function previousRange(range, now) {
    if (!range || !range.from) return null;
    now = now || new Date();
    var toEx = range.to || addDays(startOfDay(now), 1);     // last-N-days presets run up to and including today
    var days = calDays(range.from, toEx);
    if (days < 1) return null;
    return { days: days, cur: { from: range.from, to: toEx }, prev: { from: addDays(range.from, -days), to: range.from } };
  }

  // One comparison: current, previous, change. dp = decimals shown (0 or 1). The change is worked out
  // from the shown (rounded) values, so a reader can check it. pct is null when it is not valid
  // (previous is 0, or a value is missing). dir is a descriptive word only.
  function delta(cur, prev, dp) {
    if (cur === null || cur === undefined || prev === null || prev === undefined) {
      return { cur: cur === undefined ? null : cur, prev: prev === undefined ? null : prev, abs: null, pct: null, dir: null };
    }
    var f = Math.pow(10, dp || 0);
    var c = Math.round(cur * f), p = Math.round(prev * f);
    var abs = (c - p) / f;
    return {
      cur: cur, prev: prev, abs: abs,
      pct: p !== 0 ? (c - p) / Math.abs(p) * 100 : null,
      dir: c === p ? "No change" : c > p ? "Increased" : "Decreased"
    };
  }

  function ratio(part, whole) { return whole ? part / whole * 100 : null; }
  function byLabel(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function signed(v, dp) { return (v > 0 ? "+" : v < 0 ? "-" : "") + (dp ? one(Math.abs(v)) : num(Math.abs(v))); }
  function pctSigned(p) { var t = Math.abs(p).toFixed(1); return (t === "0.0" ? "" : p > 0 ? "+" : "-") + t + "%"; }

  // Joins the current and previous list on a key. make(c, p) builds the row (either may be null).
  function pairUp(curList, prevList, keyOf, make) {
    var map = {};
    curList.forEach(function (x) { var k = keyOf(x); (map[k] || (map[k] = {}))["c"] = x; });
    prevList.forEach(function (x) { var k = keyOf(x); (map[k] || (map[k] = {}))["p"] = x; });
    return Object.keys(map).map(function (k) { return make(map[k].c || null, map[k].p || null); });
  }
  function withNumbers(row, c, p) {
    row.curCount = c ? c.count : 0;     row.prevCount = p ? p.count : 0;
    row.curMinutes = c ? c.minutes : 0; row.prevMinutes = p ? p.minutes : 0;
    row.count = delta(row.curCount, row.prevCount, 0);
    row.impact = delta(row.curMinutes, row.prevMinutes, 0);
    return row;
  }
  function seen(row) { return row.curCount > 0 || row.prevCount > 0; }

  // Natural wording for the comparison statements. Numbers and choices come from the calculations;
  // only the sentences are built here. The comparison period is named once, above the list
  // (see periodPhrase), so each sentence does not repeat it.
  function periodPhrase(days) { return days === 1 ? "the previous day" : "the previous " + days + "-day period"; }
  function categoryIssues(cat) { return cat + " issues"; }
  function joinNames(names) {                          // "A", "A and B", "A, B and C", "A, B, C and 2 more"
    var n = names.length;
    if (n <= 1) return names.join("");
    if (n === 2) return names[0] + " and " + names[1];
    if (n === 3) return names[0] + ", " + names[1] + " and " + names[2];
    return names.slice(0, 3).join(", ") + " and " + (n - 3) + " more";
  }
  function moved(abs) { return abs > 0 ? "increased" : "decreased"; }

  function statements(cmp) {
    if (!cmp.hasBoth) {
      return [{ all: "Period-over-period statements are not available for All time.",
                "no-previous": "No previous-period data is available for comparison.",
                "no-current": "No exceptions in the selected period.",
                empty: "No exceptions in the selected period or the previous period." }[cmp.status] ||
              "Not enough data in both periods to make a comparison."];
    }
    var cands = [];
    function tied(list, value) { return list.length ? tiedTop(list, value) : []; }
    function combo(x) { return categoryIssues(x.category) + " at " + x.location; }

    // 1. Total recorded impact minutes.
    var ti = cmp.kpis.impact;
    if (ti.dir && ti.dir !== "No change") {
      cands.push("Total recorded impact minutes " + moved(ti.abs) + " from " + num(ti.prev) + " to " + num(ti.cur) +
        " (" + signed(ti.abs, 0) + " minutes" + (ti.pct !== null ? ", " + pctSigned(ti.pct) : "") + ").");
    }
    // 2 and 3. Category and location combination with the largest increase and decrease in impact.
    var tu = tied(cmp.hotspotsUpAll, function (x) { return x.impact.abs; });
    if (tu.length === 1) {
      cands.push("Impact minutes for " + combo(tu[0]) + " increased from " + num(tu[0].prevMinutes) + " to " + num(tu[0].curMinutes) + ".");
    } else if (tu.length > 1) {
      cands.push(tu.length + " category and location combinations share the largest increase in impact minutes, " +
        signed(tu[0].impact.abs, 0) + " minutes each: " + joinNames(tu.map(combo)) + ".");
    }
    var td_ = tied(cmp.hotspotsDownAll, function (x) { return x.impact.abs; });
    if (td_.length === 1) {
      cands.push("Impact minutes for " + combo(td_[0]) + " decreased from " + num(td_[0].prevMinutes) + " to " + num(td_[0].curMinutes) + ".");
    } else if (td_.length > 1) {
      cands.push(td_.length + " category and location combinations share the largest decrease in impact minutes, " +
        signed(td_[0].impact.abs, 0) + " minutes each: " + joinNames(td_.map(combo)) + ".");
    }
    // 4. Issue type with the largest increase in number of exceptions. The stored issue type is quoted as it is,
    //    with its category, because names such as "Other" or "Weather" exist in more than one category.
    function issueSubject(x) { return "Exceptions logged as \u201c" + x.issue + "\u201d in the " + x.category + " category"; }
    var ts = tied(cmp.issuesUpAll, function (x) { return x.count.abs + "|" + x.impact.abs; });
    if (ts.length === 1) {
      cands.push(issueSubject(ts[0]) + " increased from " + ts[0].prevCount + " to " + ts[0].curCount + ".");
    } else if (ts.length > 1) {
      cands.push(ts.length + " issue types share the largest increase in exceptions, " + signed(ts[0].count.abs, 0) + " each: " +
        joinNames(ts.map(function (x) { return "\u201c" + x.issue + "\u201d (" + x.category + ")"; })) + ".");
    }
    // 5. Average time from reporting to start of work.
    function timeFact(name, d) {
      if (d.dir && d.dir !== "No change") {
        return name + " " + moved(d.abs) + " from " + one(d.prev) + " to " + one(d.cur) + " minutes.";
      }
      return null;
    }
    var tstart = timeFact("Average time from reporting to start of work", cmp.perf.avgStart);
    if (tstart) cands.push(tstart);
    // Fillers, used only when fewer than 5 statements exist above.
    var tl = tied(cmp.locationsUpAll, function (x) { return x.impact.abs; });
    if (tl.length === 1) {
      cands.push("Among locations, " + tl[0].name + " had the largest increase in impact minutes: " + signed(tl[0].impact.abs, 0) + " minutes.");
    } else if (tl.length > 1) {
      cands.push("Among locations, " + joinNames(tl.map(function (x) { return x.name; })) + " share the largest increase in impact minutes: " +
        signed(tl[0].impact.abs, 0) + " minutes each.");
    }
    var tc = tied(cmp.categoriesDownAll, function (x) { return x.impact.abs; });
    if (tc.length === 1) {
      cands.push("Among categories, " + tc[0].name + " had the largest decrease in impact minutes: " + signed(tc[0].impact.abs, 0) + " minutes.");
    } else if (tc.length > 1) {
      cands.push("Among categories, " + joinNames(tc.map(function (x) { return x.name; })) + " share the largest decrease in impact minutes: " +
        signed(tc[0].impact.abs, 0) + " minutes each.");
    }
    var tres = timeFact("Average time from reporting to resolution", cmp.perf.avgResolve);
    if (tres) cands.push(tres);
    var ro = cmp.kpis.reopened;
    if (ro.dir && ro.dir !== "No change") {
      cands.push("Reopened exceptions " + moved(ro.abs) + " from " + ro.prev + " to " + ro.cur + ".");
    }
    return cands.length ? cands.slice(0, 5) : ["No differences were found between the two periods in the measures compared."];
  }

  // curRows / prevRows are for the same filters; cur / prev are compute() results for them.
  function compareResults(cur, prev, pr) {
    var kpis = {
      total: delta(cur.total, prev.total, 0),
      impact: delta(cur.totalImpact, prev.totalImpact, 0),
      avg: delta(cur.avgImpact, prev.avgImpact, 1),
      start: delta(cur.timeToStart.avg, prev.timeToStart.avg, 1),
      resolve: delta(cur.timeToResolve.avg, prev.timeToResolve.avg, 1),
      reopened: delta(cur.reopened, prev.reopened, 0)
    };
    var perf = {
      avgStart: kpis.start,
      medStart: delta(cur.timeToStart.median, prev.timeToStart.median, 1),
      avgResolve: kpis.resolve,
      medResolve: delta(cur.timeToResolve.median, prev.timeToResolve.median, 1),
      pctResolved: delta(ratio(cur.resolvedCount, cur.total), ratio(prev.resolvedCount, prev.total), 1),
      pctReopened: delta(ratio(cur.reopened, cur.total), ratio(prev.reopened, prev.total), 1)
    };
    perf.pctResolved.pct = null;     // percentages are compared in percentage points only
    perf.pctReopened.pct = null;

    function nameRow(c, p) {
      return withNumbers({ name: (c || p).name }, c, p);
    }
    var categories = pairUp(cur.byCategory, prev.byCategory, function (x) { return x.name; }, nameRow).filter(seen);
    var locations = pairUp(cur.byLocation, prev.byLocation, function (x) { return x.name; }, nameRow).filter(seen);

    // Category: largest increase first, decreases last. Location: largest change either way first.
    var categoriesDownAll = categories.filter(function (x) { return x.impact.abs < 0; })
      .sort(function (a, b) { return (a.impact.abs - b.impact.abs) || byLabel(a.name, b.name); });
    var locationsUpAll = locations.filter(function (x) { return x.impact.abs > 0; })
      .sort(function (a, b) { return (b.impact.abs - a.impact.abs) || byLabel(a.name, b.name); });
    categories.sort(function (a, b) { return (b.impact.abs - a.impact.abs) || (b.count.abs - a.count.abs) || byLabel(a.name, b.name); });
    locations.sort(function (a, b) {
      return (Math.abs(b.impact.abs) - Math.abs(a.impact.abs)) || (Math.abs(b.count.abs) - Math.abs(a.count.abs)) || byLabel(a.name, b.name);
    });

    // Recurring issue types (category + issue type), top 10 by size of the impact change.
    var issuesMoved = pairUp(cur.issuesAll, prev.issuesAll, function (x) { return x.category + "|" + x.issue; }, function (c, p) {
      var s = c || p;
      return withNumbers({ category: s.category, issue: s.issue, label: s.category + " " + s.issue }, c, p);
    }).filter(function (x) { return x.impact.abs !== 0 || x.count.abs !== 0; });
    var issuesUpAll = issuesMoved.filter(function (x) { return x.count.abs > 0; })
      .sort(function (a, b) { return (b.count.abs - a.count.abs) || (b.impact.abs - a.impact.abs) || byLabel(a.label, b.label); });
    var issues = issuesMoved.slice().sort(function (a, b) {
      return (Math.abs(b.impact.abs) - Math.abs(a.impact.abs)) || (Math.abs(b.count.abs) - Math.abs(a.count.abs)) || byLabel(a.label, b.label);
    }).slice(0, 10);

    // Hotspot movement (category + location).
    var moved = pairUp(cur.hotspotsAll, prev.hotspotsAll, function (x) { return x.category + "|" + x.location; }, function (c, p) {
      var s = c || p;
      return withNumbers({ category: s.category, location: s.location, label: s.category + " " + s.location }, c, p);
    });
    var hotspotsUpAll = moved.filter(function (x) { return x.impact.abs > 0; })
      .sort(function (a, b) { return (b.impact.abs - a.impact.abs) || (b.count.abs - a.count.abs) || byLabel(a.label, b.label); });
    var hotspotsDownAll = moved.filter(function (x) { return x.impact.abs < 0; })
      .sort(function (a, b) { return (a.impact.abs - b.impact.abs) || (a.count.abs - b.count.abs) || byLabel(a.label, b.label); });

    // Management review candidates (category + issue type + location).
    var candidates = pairUp(cur.constraints, prev.constraints, function (x) { return x.category + "|" + x.issue + "|" + x.location; }, function (c, p) {
      var s = c || p;
      var row = withNumbers({ category: s.category, issue: s.issue, location: s.location,
        label: s.category + " " + s.issue + " " + s.location }, c, p);
      row.curReopened = c ? c.reopened : 0;
      row.prevReopened = p ? p.reopened : 0;
      row.impactChange = row.curMinutes - row.prevMinutes;
      row.countChange = row.curCount - row.prevCount;
      row.reopenChange = row.curReopened - row.prevReopened;
      var a = c ? Date.parse(c.last) : -Infinity, b = p ? Date.parse(p.last) : -Infinity;
      row.last = a >= b ? c.last : p.last;
      return row;
    }).filter(function (x) { return x.impactChange > 0 || x.countChange > 0 || x.reopenChange > 0; })
      .sort(function (a, b) {
        return (b.impactChange - a.impactChange) || (b.countChange - a.countChange) || (b.reopenChange - a.reopenChange) ||
          (Date.parse(b.last) - Date.parse(a.last)) || byLabel(a.label, b.label);
      });

    // Priority (current_priority).
    var pkeys = PRIORITIES.concat(cur.priority.none.count || prev.priority.none.count ? ["none"] : []);
    var priority = pkeys.map(function (k) {
      return withNumbers({ name: k === "none" ? "Not recorded" : k, key: k }, cur.priority[k], prev.priority[k]);
    });

    var hasBoth = cur.total > 0 && prev.total > 0;
    var status = hasBoth ? "ok" : (!cur.total && !prev.total) ? "empty" : !prev.total ? "no-previous" : "no-current";
    var cmp = {
      status: status, hasBoth: hasBoth, days: pr.days, periods: pr,
      kpis: kpis, perf: perf,
      categories: categories, locations: locations, issues: issues,
      hotspotsUp: hotspotsUpAll.slice(0, 5), hotspotsDown: hotspotsDownAll.slice(0, 5),
      candidates: candidates.slice(0, 15), candidateCount: candidates.length,
      priority: priority, priorityChanges: delta(cur.priorityChanges, prev.priorityChanges, 0),
      categoriesDownAll: categoriesDownAll, locationsUpAll: locationsUpAll,
      issuesUpAll: issuesUpAll, hotspotsUpAll: hotspotsUpAll, hotspotsDownAll: hotspotsDownAll
    };
    cmp.attention = statements(cmp);
    cmp.attentionLead = "Compared with " + periodPhrase(pr.days) + ":";
    return cmp;
  }

  // Current day / month N of the previous period lined up under day N of the current one (daily charts only).
  function alignedPrevious(prevRows, pr) {
    if (!pr || pr.days > 90) return null;
    var counts = [], impact = [];
    for (var i = 0; i < pr.days; i++) { counts.push(0); impact.push(0); }
    prevRows.forEach(function (r) {
      var i2 = calDays(pr.prev.from, new Date(r.created_at));
      if (i2 >= 0 && i2 < pr.days) { counts[i2] += 1; impact[i2] += r.impact_minutes || 0; }
    });
    return { counts: counts, impact: impact };
  }

  // The whole Phase D computation. rows: exceptions of BOTH periods (already filtered by the page for
  // shift, category and location). Splits them by created_at, so nothing is counted twice.
  function computeAll(rows, reopenedIds, priorityChangedIds, range, now) {
    now = now || new Date();
    var pr = previousRange(range, now);
    if (!pr) {
      var only = compute(rows, reopenedIds, priorityChangedIds, range, now);
      only.readiness = assessReadiness(rows, reopenedIds);
      return { cur: only, prev: null, cmp: null, pr: null, overlay: null };
    }
    var t0 = pr.cur.from.getTime(), tp = pr.prev.from.getTime();
    var tEnd = range.to ? range.to.getTime() : Infinity;
    var curRows = [], prevRows = [];
    rows.forEach(function (r) {
      var t = Date.parse(r.created_at);
      if (t >= t0 && t < tEnd) curRows.push(r);
      else if (t >= tp && t < t0) prevRows.push(r);
    });
    var cur = compute(curRows, reopenedIds, priorityChangedIds, range, now);
    cur.readiness = assessReadiness(curRows, reopenedIds);      // Phase E: current (filtered) period only
    var prev = compute(prevRows, reopenedIds, priorityChangedIds, { from: pr.prev.from, to: pr.prev.to }, now);
    var overlay = alignedPrevious(prevRows, pr);
    if (overlay && (cur.series.mode !== "day" || cur.series.keys.length !== pr.days)) overlay = null;
    return { cur: cur, prev: prev, cmp: compareResults(cur, prev, pr), pr: pr, overlay: overlay };
  }

  // ==================================================================== Phase E: forecast readiness
  // A data-sufficiency check for LATER forecasting. It makes no forecast and gives no operational judgement.
  // The states (Not Ready / Limited / Ready) describe only whether the filtered history meets the prototype
  // data-sufficiency requirements for attempting a forecast. They do NOT mean the data is statistically
  // validated, or that any later forecast would be accurate, reliable or of guaranteed quality.
  // The numbers below are prototype ENGINEERING defaults, not operational or statistical thresholds.
  var READINESS = {
    general: { notReadySpan: 14, notReadyCount: 20, notReadyActive: 7, readySpan: 56, readyCount: 50, readyActive: 21, maxSharePct: 50 },
    start:   { notReadyObs: 10, readyObs: 30, readyPct: 50, readySpan: 28 },
    resolve: { notReadyObs: 10, readyObs: 30, readyPct: 40, readySpan: 28 }
  };

  function pl(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function pct1(x) { return x.toFixed(1) + "%"; }
  function spanBetween(a, b) { return calDays(a, b) + 1; }          // inclusive local calendar days

  // ISO 8601 week key, e.g. "2026-W40" (weeks start on Monday; week 1 holds the first Thursday of the year).
  function isoWeekKey(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);      // the Thursday of this ISO week
    var y = t.getUTCFullYear();
    var jan4 = new Date(Date.UTC(y, 0, 4));
    var week = 1 + Math.round(((t - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return y + "-W" + pad2(week);
  }

  // rows: the filtered exceptions (current period only). reopenedIds: { id: true } (used for a note only).
  // Returns { overall, overallReasons, exceptionCount, impactMinutes, timeToStart, timeToResolve,
  //           coverage, concentration, recurrence, notes, thresholds }.
  // Each metric is { state, summary, reasons, facts }. A later forecasting phase must check
  // readiness.<metric>.state === "Ready" before it produces that forecast.
  function assessReadiness(rows, reopenedIds) {
    reopenedIds = reopenedIds || {};
    var G = READINESS.general, S = READINESS.start, RS = READINESS.resolve;
    rows = (rows || []).filter(function (r) { return r && !isNaN(Date.parse(r.created_at)); });
    var n = rows.length;

    var first = null, last = null;
    var days = {}, weeks = {}, months = {};
    var totalImpact = 0, largest = 0, impactObs = 0, reopened = 0;
    var cats = {}, locs = {}, combos = {};
    var startObs = [], resolveObs = [];
    function span2(list) {
      var a = null, b = null;
      list.forEach(function (d) { if (!a || d < a) a = d; if (!b || d > b) b = d; });
      return a ? spanBetween(a, b) : 0;
    }
    rows.forEach(function (r) {
      var d = new Date(r.created_at);
      if (!first || d < first) first = d;
      if (!last || d > last) last = d;
      var dk = dayKey(d);
      days[dk] = true; weeks[isoWeekKey(d)] = true; months[monthKey(d)] = true;
      var m = r.impact_minutes === null || r.impact_minutes === undefined ? NaN : Number(r.impact_minutes);
      if (isFinite(m)) { impactObs += 1; totalImpact += m; if (m > largest) largest = m; } else { m = 0; }
      if (reopenedIds[r.id]) reopened += 1;
      var c = cats[r.category] || (cats[r.category] = { name: r.category, count: 0, minutes: 0, days: {}, locs: {}, issues: {} });
      c.count += 1; c.minutes += m; c.days[dk] = true; c.locs[r.location] = true; c.issues[r.issue_type] = true;
      var l = locs[r.location] || (locs[r.location] = { name: r.location, minutes: 0 });
      l.minutes += m;
      var ck = r.category + " | " + r.issue_type;
      var g = combos[ck] || (combos[ck] = { label: r.issue_type + " (" + r.category + ")", issue: r.issue_type, category: r.category, count: 0 });
      g.count += 1;
      if (r.started_at && Date.parse(r.started_at) >= Date.parse(r.created_at)) startObs.push(d);
      if (r.status === "Resolved" && r.resolved_at && Date.parse(r.resolved_at) >= Date.parse(r.created_at)) resolveObs.push(d);
    });

    var span = first ? spanBetween(first, last) : 0;
    var active = Object.keys(days).length;
    var weekCount = Object.keys(weeks).length, monthCount = Object.keys(months).length;
    var zeroDays = Math.max(0, span - active);
    var sharePct = totalImpact > 0 ? largest / totalImpact * 100 : null;
    var concentrated = totalImpact > 0 && largest * 100 > G.maxSharePct * totalImpact;   // more than 50%, exact integer test

    // ---- exception count and impact minutes share the general thresholds on history length
    // ---- Wording. The STATES below are decided by exactly the same conditions as before; this code only
    //      describes them. A Ready card shows a summary and the evidence; only Limited / Not Ready cards add
    //      the requirement that is not met. The full rules are in the "Prototype engineering thresholds" table.
    function list(items) { return items.length ? items.join(", ").replace(/, ([^,]*)$/, " and $1") : ""; }
    var EMPTY_TEXT = "Forecast readiness cannot be assessed because the selected filters contain no exceptions.";
    var READY_SUMMARY = {
      general: ["Historical coverage meets the prototype readiness requirements.",
                "Historical coverage is below the Ready requirement.",
                "Historical coverage does not meet the minimum prototype requirements."],
      impact:  ["Impact data meets the prototype readiness requirements.",
                "Impact data is below the Ready requirement.",
                "Impact data does not meet the minimum prototype requirements."],
      life:    ["Lifecycle coverage meets the prototype readiness requirements.",
                "Lifecycle coverage is below the Ready requirement.",
                "Lifecycle coverage does not meet the minimum prototype requirements."]
    };
    function summaryFor(kind, state) { return READY_SUMMARY[kind][state === "Ready" ? 0 : state === "Limited" ? 1 : 2]; }

    // Requirements that are not met, as { have, need, unit } (history length, exceptions, active days).
    function generalLevel(count) {
      var notReady = [], limited = [];
      if (span < G.notReadySpan)    notReady.push({ have: span,   need: G.notReadySpan,   unit: "calendar day" });
      if (count < G.notReadyCount)  notReady.push({ have: count,  need: G.notReadyCount,  unit: "exception" });
      if (active < G.notReadyActive) notReady.push({ have: active, need: G.notReadyActive, unit: "active day" });
      if (span < G.readySpan)       limited.push({ have: span,   need: G.readySpan,   unit: "calendar day" });
      if (count < G.readyCount)     limited.push({ have: count,  need: G.readyCount,  unit: "exception" });
      if (active < G.readyActive)   limited.push({ have: active, need: G.readyActive, unit: "active day" });
      return { notReady: notReady, limited: limited };
    }
    function minimumLines(items) { return items.map(function (i) { return "Minimum requirement: at least " + pl(i.need, i.unit) + "."; }); }
    function readyLines(items) { return items.map(function (i) { return "Ready requires at least " + pl(i.need, i.unit) + "."; }); }
    function needClause(state, items) {       // for the Readiness Notes
      return (state === "Not Ready" ? "the minimum is " : "Ready needs ") +
        list(items.map(function (i) { return pl(i.need, i.unit) + " (" + i.have + " available)"; }));
    }

    // Exception Count Forecast
    var lc = generalLevel(n);
    var countState = lc.notReady.length ? "Not Ready" : lc.limited.length ? "Limited" : "Ready";
    var countUnmet = countState === "Not Ready" ? minimumLines(lc.notReady) : countState === "Limited" ? readyLines(lc.limited) : [];
    var countEvidence = [pl(span, "calendar day"), pl(n, "exception"), pl(active, "active day"), pl(weekCount, "week") + " represented"];
    var exceptionCount = {
      state: countState,
      summary: n ? summaryFor("general", countState) : "No exceptions in the selected period.",
      evidence: n ? countEvidence : [], unmet: n ? countUnmet : [],
      note: countState === "Ready" ? "" : needClause(countState, countState === "Not Ready" ? lc.notReady : lc.limited),
      facts: { span: span, exceptions: n, activeDays: active, weeks: weekCount }
    };

    // Impact Minutes Forecast (uses the exceptions that have a recorded impact value; no single exception above 50%)
    var li = generalLevel(impactObs);
    var impState = totalImpact === 0 ? "Not Ready" : li.notReady.length ? "Not Ready" : (li.limited.length || concentrated) ? "Limited" : "Ready";
    var impUnmet = [], impClause = [];
    if (impState === "Not Ready") {
      if (totalImpact === 0) { impUnmet.push("Total recorded impact is 0 minutes."); impClause.push("total recorded impact is 0 minutes"); }
      minimumLines(li.notReady).forEach(function (x) { impUnmet.push(x); });
      if (li.notReady.length) impClause.push(needClause("Not Ready", li.notReady));
    } else if (impState === "Limited") {
      readyLines(li.limited).forEach(function (x) { impUnmet.push(x); });
      if (li.limited.length) impClause.push(needClause("Limited", li.limited));
      if (concentrated) {
        impUnmet.push("One exception contributes " + pct1(sharePct) + " of total recorded impact; Ready requires " + G.maxSharePct + "% or less.");
        impClause.push("one exception contributes " + pct1(sharePct) + " of total recorded impact (Ready needs " + G.maxSharePct + "% or less)");
      }
    }
    var impEvidence = [pl(span, "calendar day"), pl(impactObs, "exception") + " with a recorded impact",
      num(totalImpact) + " total recorded impact minutes"];
    if (totalImpact > 0) impEvidence.push("Largest single event: " + num(largest) + " minutes (" + pct1(sharePct) + " of total)");
    var impactMinutes = {
      state: impState,
      summary: n ? summaryFor("impact", impState) : "No exceptions in the selected period.",
      evidence: n ? impEvidence : [], unmet: n ? impUnmet : [],
      note: impState === "Ready" ? "" : impClause.join("; "),
      facts: { span: span, observations: impactObs, totalImpact: totalImpact, largest: largest, sharePct: sharePct, concentrated: concentrated }
    };

    // Time to Start / Time to Resolve (lifecycle completeness). kind = "start" | "resolution".
    function lifecycle(obs, T, kind) {
      var k = obs.length, sp = span2(obs);
      var pc = n ? k / n * 100 : null;
      var pctOk = n > 0 && k * 100 >= T.readyPct * n;
      var state = k < T.notReadyObs ? "Not Ready" : (k >= T.readyObs && pctOk && sp >= T.readySpan) ? "Ready" : "Limited";
      var obsName = "usable " + kind + " observation";
      var unmet = [], clause = [];
      if (state === "Not Ready") {
        unmet.push("Minimum requirement: at least " + pl(T.notReadyObs, obsName) + ".");
        clause.push("the minimum is " + pl(T.notReadyObs, obsName) + " (" + k + " available)");
      } else if (state === "Limited") {
        if (k < T.readyObs) {
          unmet.push("Ready requires at least " + pl(T.readyObs, obsName) + ".");
          clause.push(pl(T.readyObs, obsName) + " (" + k + " available)");
        }
        if (!pctOk) {
          unmet.push("Ready requires usable " + kind + " times for at least " + T.readyPct + "% of filtered exceptions.");
          clause.push("usable " + kind + " times for " + T.readyPct + "% of filtered exceptions (" + (pc === null ? "0.0%" : pct1(pc)) + " have one)");
        }
        if (sp < T.readySpan) {
          unmet.push("Ready requires observations covering at least " + pl(T.readySpan, "calendar day") + ".");
          clause.push("observations covering " + pl(T.readySpan, "calendar day") + " (" + sp + " covered)");
        }
      }
      var evidence = [pl(k, obsName)];
      if (pc !== null) evidence.push(pct1(pc) + " of filtered exceptions");
      evidence.push(pl(sp, "calendar day") + " represented");
      return {
        state: state,
        summary: n ? summaryFor("life", state) : "No exceptions in the selected period.",
        evidence: n ? evidence : [], unmet: n ? unmet : [],
        note: state === "Ready" ? "" : (clause.length ? (state === "Not Ready" ? "" : "Ready needs ") + list(clause) : ""),
        facts: { observations: k, pctOfExceptions: pc, span: sp, reopened: reopened }
      };
    }
    var timeToStart = lifecycle(startObs, S, "start");
    var timeToResolve = lifecycle(resolveObs, RS, "resolution");
    [exceptionCount, impactMinutes, timeToStart, timeToResolve].forEach(function (m) { m.reasons = m.evidence.concat(m.unmet); });

    // ---- overall
    var overall = (countState === "Ready" && impState === "Ready") ? "Ready"
      : (countState === "Not Ready" || impState === "Not Ready") ? "Not Ready" : "Limited";
    var overallSummary = !n ? EMPTY_TEXT
      : overall === "Ready" ? "Exception Count and Impact Minutes both meet the prototype readiness requirements."
      : countState === impState ? "Exception Count and Impact Minutes are both " + countState + "."
      : "Exception Count is " + countState + " and Impact Minutes is " + impState + ".";
    var overallNote = "Time-to-Start and Time-to-Resolve are assessed separately and do not determine the overall state.";
    var overallReasons = [overallSummary, overallNote];
    var lifecycleNote = reopened > 0
      ? "Lifecycle note: " + (reopened === 1 ? "1 reopened exception is included." : reopened + " reopened exceptions are included.") +
        " Readiness uses each exception’s current lifecycle fields; earlier cycles are not reconstructed."
      : "";

    // ---- coverage, concentration, recurrence
    var coverage = { earliest: first, latest: last, span: span, total: n, activeDays: active, weeks: weekCount, months: monthCount,
      zeroDays: zeroDays, perActiveDay: active ? n / active : null, totalImpact: totalImpact };

    function topBy(list, value) {           // highest value; ties ordered by name, tie count reported
      if (!list.length) return null;
      var sorted = list.slice().sort(function (a, b) { return (value(b) - value(a)) || byLabel(a.label || a.name, b.label || b.name); });
      var top = sorted[0];
      var tied = sorted.filter(function (x) { return value(x) === value(top); }).length - 1;
      return { item: top, tied: tied };
    }
    var catList = Object.keys(cats).map(function (k) { return cats[k]; });
    var locList = Object.keys(locs).map(function (k) { return locs[k]; });
    var comboList = Object.keys(combos).map(function (k) { return combos[k]; });
    var tc = totalImpact > 0 ? topBy(catList, function (x) { return x.minutes; }) : null;
    var tl = totalImpact > 0 ? topBy(locList, function (x) { return x.minutes; }) : null;
    var ti = topBy(comboList, function (x) { return x.count; });
    var concentration = {
      largestImpact: n ? largest : null, largestSharePct: sharePct,
      topCategory: tc ? { name: tc.item.name, sharePct: tc.item.minutes / totalImpact * 100, tied: tc.tied } : null,
      topLocation: tl ? { name: tl.item.name, sharePct: tl.item.minutes / totalImpact * 100, tied: tl.tied } : null,
      topIssue: ti ? { label: ti.item.label, issue: ti.item.issue, category: ti.item.category, sharePct: ti.item.count / n * 100, tied: ti.tied } : null
    };
    var order = CATEGORIES.concat(Object.keys(cats).filter(function (k) { return CATEGORIES.indexOf(k) < 0; }).sort());
    var recurrence = {
      categories: order.map(function (name) {
        var c = cats[name];
        return { name: name, count: c ? c.count : 0, days: c ? Object.keys(c.days).length : 0,
          locations: c ? Object.keys(c.locs).length : 0, issueTypes: c ? Object.keys(c.issues).length : 0 };
      }),
      once: comboList.filter(function (x) { return x.count === 1; }).length,
      twoToFour: comboList.filter(function (x) { return x.count >= 2 && x.count <= 4; }).length,
      fivePlus: comboList.filter(function (x) { return x.count >= 5; }).length
    };

    // ---- notes (facts about the data only)
    var notes = [];
    if (!n) {
      notes.push(EMPTY_TEXT);
    } else {
      notes.push("The filtered data contains " + pl(n, "exception") + " across " + pl(span, "calendar day") + ".");
      var named = [["Exception Count", exceptionCount], ["Impact Minutes", impactMinutes], ["Time-to-Start", timeToStart], ["Time-to-Resolve", timeToResolve]];
      var okNames = named.filter(function (m) { return m[1].state === "Ready"; }).map(function (m) { return m[0]; });
      if (okNames.length === 4) notes.push("All four forecast types meet the prototype readiness requirements.");
      else if (okNames.length) notes.push(list(okNames) + (okNames.length === 1 ? " meets" : " meet") + " the prototype readiness requirements.");
      named.forEach(function (m) {
        if (m[1].state !== "Ready") notes.push(m[0] + ": " + m[1].state + ". " + (m[1].note.charAt(0).toUpperCase() + m[1].note.slice(1)) + ".");
      });
    }

    return { overall: overall, overallReasons: overallReasons, exceptionCount: exceptionCount, impactMinutes: impactMinutes,
      timeToStart: timeToStart, timeToResolve: timeToResolve, coverage: coverage, concentration: concentration,
      recurrence: recurrence, notes: notes, lifecycleNote: lifecycleNote, reopened: reopened, thresholds: READINESS };
  }

  // The gate a later forecasting phase should call: true only when that metric is "Ready".
  // metric: "exceptionCount" | "impactMinutes" | "timeToStart" | "timeToResolve" (or "overall").
  function isReady(readiness, metric) {
    if (!readiness) return false;
    var m = metric === "overall" ? { state: readiness.overall } : readiness[metric];
    return !!m && m.state === "Ready";
  }

  var api = {
    CATEGORIES: CATEGORIES, SHIFTS: SHIFTS, LOCATIONS: LOCATIONS, PRIORITIES: PRIORITIES,
    resolveRange: resolveRange, compute: compute, median: median, mean: mean,
    previousRange: previousRange, delta: delta, computeAll: computeAll,
    READINESS: READINESS, assessReadiness: assessReadiness, isReady: isReady, isoWeekKey: isoWeekKey
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MineAnalytics = api;

  // ==================================================================== page (browser only)
  if (typeof document === "undefined") return;

  var PAGE = 1000;                 // rows per request (Supabase returns at most 1000 per request)
  var COLS = "id,created_at,shift,location,category,issue_type,impact_minutes,status," +
             "current_priority,started_at,resolved_at";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  var charts = {};
  var lastResult = null;
  var showAllConstraints = false;
  var loadToken = 0;
  var access = null;

  function showError(text) { var m = $("msg"); m.className = "err"; m.textContent = text; }
  function clearError() { var m = $("msg"); m.className = ""; m.textContent = ""; }

  function filters() {
    var r = resolveRange($("f-range").value, $("f-from").value, $("f-to").value, new Date());
    var pick = function (id) { var v = $(id).value; return v === "All" ? null : v; };
    return { range: r, shift: pick("f-shift"), category: pick("f-cat"), location: pick("f-loc") };
  }

  // Reads every page of a query (one request per 1000 rows).
  async function fetchAll(makeQuery) {
    var all = [], from = 0;
    for (;;) {
      var res = await makeQuery().range(from, from + PAGE - 1);
      if (res.error) throw new Error(res.error.message);
      var data = res.data || [];
      all = all.concat(data);
      if (data.length < PAGE) return all;
      from += PAGE;
    }
  }

  async function load(f) {
    var db = MineShift.db;
    var now = new Date();
    // Phase D: one bulk read covers the current AND the previous period (they are next to each other);
    // computeAll() splits the rows by created_at. All time has no previous period.
    var pr = previousRange(f.range, now);
    var lower = pr ? pr.prev.from : f.range.from;
    var rows = await fetchAll(function () {
      var q = db.from("shift_exceptions").select(COLS);
      if (lower) q = q.gte("created_at", lower.toISOString());
      if (f.range.to) q = q.lt("created_at", f.range.to.toISOString());
      if (f.shift) q = q.eq("shift", f.shift);
      if (f.category) q = q.eq("category", f.category);
      if (f.location) q = q.eq("location", f.location);
      return q.order("created_at", { ascending: true }).order("id", { ascending: true });
    });
    var reopened = {}, changed = {};
    if (rows.length) {
      var ids = {};
      rows.forEach(function (r) { ids[r.id] = true; });
      // One bulk read of the audit lines that matter. An exception cannot have audit lines older
      // than itself, so the start of the earliest period is a safe lower bound. No upper bound: a reopen
      // after the period still belongs to an exception created inside it.
      var audit = await fetchAll(function () {
        var q = db.from("exception_audit").select("exception_id,action,created_at")
          .in("action", ["reopened", "priority_changed"]);
        if (lower) q = q.gte("created_at", lower.toISOString());
        return q.order("created_at", { ascending: true }).order("id", { ascending: true });
      });
      audit.forEach(function (a) {
        if (!ids[a.exception_id]) return;
        if (a.action === "reopened") reopened[a.exception_id] = true;
        if (a.action === "priority_changed") changed[a.exception_id] = true;
      });
    }
    return computeAll(rows, reopened, changed, f.range, now);
  }

  // ---------------------------------------------------------------- drawing
  function minutesText(v) { return v === null || v === undefined ? "—" : num(v) + " min"; }
  function minutesText1(v) { return v === null || v === undefined ? "—" : one(v) + " min"; }

  function setKpi(id, value, sub) {
    $(id).textContent = value;
    var s = $(id + "-sub");
    if (s) s.textContent = sub || "";
  }

  var NAVY = "#0b2a5b", BLUE = "#8aa4d6", MID = "#3b6bb5", GREY = "#5b7a99", AMBER = "#f59e0b";

  function chart(id, config, hasData, emptyText) {
    var box = $(id).parentNode;
    var note = box.querySelector(".nodata");
    if (note) note.remove();
    if (charts[id]) { charts[id].destroy(); charts[id] = null; }
    if (!hasData) {
      $(id).style.display = "none";
      box.appendChild(el("div", "nodata", emptyText || "No exceptions match the selected filters."));
      return;
    }
    $(id).style.display = "";
    if (!window.Chart) {
      $(id).style.display = "none";
      box.appendChild(el("div", "nodata", "The chart could not be loaded (the chart library did not load)."));
      return;
    }
    charts[id] = new Chart($(id), config);
  }

  function lineConfig(labels, data, label, color, previous) {
    var sets = [{ label: label, data: data, borderColor: color, backgroundColor: color + "22",
      fill: true, tension: 0.2, pointRadius: labels.length > 45 ? 0 : 3 }];
    if (previous) {
      // Previous period, lined up day by day (day 1 of the previous period under day 1 of this one).
      sets.push({ label: "Previous period (day by day)", data: previous, borderColor: GREY, backgroundColor: "transparent",
        borderDash: [6, 4], fill: false, tension: 0.2, pointRadius: 0, borderWidth: 2 });
    }
    return {
      type: "line",
      data: { labels: labels, datasets: sets },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: !!previous, position: "bottom" } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 10, maxRotation: 0 } } } }
    };
  }
  function barConfig(labels, data, label, horizontal) {
    return {
      type: "bar",
      data: { labels: labels, datasets: [{ label: label, data: data,
        backgroundColor: labels.map(function (_, i) { return [NAVY, BLUE, MID, GREY][i % 4]; }) }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: false } },
        scales: horizontal ? { x: { beginAtZero: true, ticks: { precision: 0 } } } : { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    };
  }

  // Composition (share of a whole) charts. The legend shows the real value and its percentage of the total, so the
  // numbers can be read without hovering. The total is the sum of the slices, so the percentages add up to 100.
  var DONUT_COLORS = [NAVY, AMBER, MID, BLUE, "#c2410c", GREY];
  function donutConfig(labels, data, unit) {
    var total = data.reduce(function (a, b) { return a + b; }, 0);
    function pctOf(v) { return total ? (v / total * 100).toFixed(1) + "%" : "0.0%"; }
    return {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: labels.map(function (_, i) { return DONUT_COLORS[i % DONUT_COLORS.length]; }),
        borderColor: "#ffffff", borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "55%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 14, font: { size: 13 },
            generateLabels: function (c) {
              return c.data.labels.map(function (l, i) {
                var v = c.data.datasets[0].data[i];
                return { text: l + ": " + num(v) + " (" + pctOf(v) + ")", fillStyle: DONUT_COLORS[i % DONUT_COLORS.length],
                  strokeStyle: "#ffffff", lineWidth: 1, index: i, hidden: c.getDataVisibility ? !c.getDataVisibility(i) : false };
              });
            } } },
          tooltip: { callbacks: { label: function (ctx) {
            var v = ctx.parsed; return ctx.label + ": " + num(v) + " " + unit + " (" + pctOf(v) + " of " + num(total) + ")";
          } } }
        } }
    };
  }

  function dateTimeText(iso) {
    var d = new Date(iso);
    return dateText(d) + ", " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function td(label, text, cls) {
    var c = el("td", cls || "", text);
    c.setAttribute("data-label", label);
    return c;
  }

  function drawConstraints(r) {
    var body = $("constraints-body");
    body.textContent = "";
    var list = showAllConstraints ? r.constraints : r.constraints.slice(0, 15);
    list.forEach(function (g) {
      var tr = el("tr");
      tr.appendChild(td("Category", g.category));
      tr.appendChild(td("Issue Type", g.issue));
      tr.appendChild(td("Location", g.location));
      tr.appendChild(td("Exceptions", String(g.count), "n"));
      tr.appendChild(td("Total Impact (min)", num(g.minutes), "n"));
      tr.appendChild(td("Average Impact (min)", one(g.avg), "n"));
      tr.appendChild(td("Resolved", String(g.resolved), "n"));
      tr.appendChild(td("Reopened", String(g.reopened), "n"));
      tr.appendChild(td("Latest Occurrence", dateTimeText(g.last)));
      body.appendChild(tr);
    });
    $("constraints-empty").hidden = r.constraints.length > 0;
    $("constraints-table").hidden = r.constraints.length === 0;
    var more = $("constraints-more");
    more.hidden = r.constraints.length <= 15;
    more.textContent = showAllConstraints ? "Show top 15 only" : "Show all " + r.constraints.length + " groups";
  }

  // ---------------------------------------------------------------- Phase D drawing (period comparison)
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dateText(d) { return pad2(d.getDate()) + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }

  function valText(v, unit, dp) {
    if (v === null || v === undefined) return "—";
    if (unit === "%") return one(v) + "%";
    return (dp ? one(v) : num(v)) + (unit ? " " + unit : "");
  }
  // The change as words: { main, note, dir }. pp = percentage points (no percentage change is shown).
  function changeParts(d, unit, dp, pp) {
    if (d.abs === null) return { main: "Change not available", note: "No data in one of the periods", dir: "" };
    if (d.abs === 0) return { main: "No change", note: "", dir: "No change" };
    var main = signed(d.abs, dp) + (unit ? " " + unit : "");
    var note = "";
    if (!pp) {
      if (d.pct !== null) main += " (" + pctSigned(d.pct) + ")";
      else note = "Percentage change not available";
    }
    return { main: main, note: note, dir: d.dir };
  }
  function fillCmp(id, d, unit, dp, pp) {
    var box = $(id);
    box.textContent = "";
    var c = changeParts(d, unit, dp, pp);
    var prevUnit = pp ? "%" : unit;
    box.appendChild(el("div", "cmp-prev", "Previous period: " + valText(d.prev, prevUnit, dp)));
    box.appendChild(el("div", "cmp-chg", c.dir === "No change" || !c.dir ? c.main : "Change: " + c.main + " \u00b7 " + c.dir));
    if (c.note) box.appendChild(el("div", "cmp-note", c.note));
  }

  // One compact line for a headline card: "Previous: 393 · +8 (+2.0%)" (no unit; the card shows it)
  function fillCmpLine(id, d, dp) {
    var box = $(id);
    box.textContent = "";
    var prev = d.prev === null || d.prev === undefined ? "—" : (dp ? one(d.prev) : num(d.prev));
    var c = changeParts(d, "", dp, false);
    var chg = d.abs === null ? "change not available" : c.main;
    box.appendChild(el("span", "cmp-prev", "Previous: " + prev + " \u00b7 "));
    box.appendChild(el("span", "cmp-chg", chg));
  }

  // Table cells for a change: an arrow shows the direction only (no colour judgement).
  function chgText(d) {
    if (d.abs === null) return "—";
    if (d.abs === 0) return "0";
    return (d.abs > 0 ? "▲ " : "▼ ") + signed(d.abs, 0);
  }
  function pctText(d) {
    if (d.abs === null || d.pct === null) return "n/a";
    return d.abs === 0 ? "0.0%" : pctSigned(d.pct);
  }

  function fillTable(name, rows, cells, emptyText) {
    var body = $(name + "-body");
    body.textContent = "";
    rows.forEach(function (row) {
      var tr = el("tr");
      cells(row).forEach(function (c) { tr.appendChild(td(c[0], c[1], c[2])); });
      body.appendChild(tr);
    });
    $(name + "-table").hidden = rows.length === 0;
    $(name + "-table").parentNode.querySelectorAll("p.tblnote").forEach(function (n) { n.hidden = rows.length === 0; });
    var e = $(name + "-empty");
    e.hidden = rows.length > 0;
    if (rows.length === 0) e.textContent = emptyText || "No exceptions match the selected filters.";
  }

  function drawComparison(result) {
    var cmp = result.cmp;
    document.querySelectorAll(".cmp").forEach(function (e) { e.hidden = !cmp; });
    var status = $("cmp-status"), periods = $("cmp-periods");
    periods.textContent = "";
    if (!cmp) {
      periods.hidden = true;
      status.textContent = "Period comparison is not available for All time.";
      return;
    }
    periods.hidden = false;
    var pr = cmp.periods;
    function row(label, from, toEx, total) {
      var last = addDays(toEx, -1);
      var line = el("div", "cmp-period");
      line.appendChild(el("span", "cmp-label", label));
      line.appendChild(el("span", "", dateText(from) + " – " + dateText(last) + " (" + pr.days + " day" + (pr.days === 1 ? "" : "s") + ", " +
        total + " exception" + (total === 1 ? "" : "s") + ")"));
      periods.appendChild(line);
    }
    row("Current", pr.cur.from, pr.cur.to, result.cur.total);
    row("Previous", pr.prev.from, pr.prev.to, result.prev.total);
    status.textContent = {
      ok: "Compared with the immediately preceding period of the same length.",
      "no-previous": "No previous-period data is available for comparison. Changes are shown as absolute values; percentage changes are not available.",
      "no-current": "No exceptions in the selected period. The previous period is shown for reference.",
      empty: "No exceptions in the selected period or the previous period."
    }[cmp.status];

    // KPI cards
    fillCmpLine("k-total-cmp", cmp.kpis.total, 0);
    fillCmpLine("k-impact-cmp", cmp.kpis.impact, 0);
    fillCmpLine("k-avg-cmp", cmp.kpis.avg, 1);
    fillCmpLine("k-start-cmp", cmp.kpis.start, 1);
    fillCmpLine("k-resolve-cmp", cmp.kpis.resolve, 1);
    fillCmpLine("k-reopened-cmp", cmp.kpis.reopened, 0);
    fillCmp("priority-changes-cmp", cmp.priorityChanges, "", 0);

    // Category and location change
    function nameCells(labelName) {
      return function (x) {
        return [[labelName, x.name], ["Current Exceptions", String(x.curCount), "n"], ["Previous Exceptions", String(x.prevCount), "n"],
          ["Exception Change", chgText(x.count), "n"], ["Current Impact (min)", num(x.curMinutes), "n"],
          ["Previous Impact (min)", num(x.prevMinutes), "n"], ["Impact Change (min)", chgText(x.impact), "n"],
          ["Impact Change (%)", pctText(x.impact), "n"]];
      };
    }
    fillTable("cat", cmp.categories, nameCells("Category"), "No exceptions in either period.");
    fillTable("loc", cmp.locations, nameCells("Location"), "No exceptions in either period.");

    var bothEmpty = cmp.status === "empty";
    function noneText(text) { return bothEmpty ? "No exceptions in either period." : text; }

    // Recurring issue change
    fillTable("issue", cmp.issues, function (x) {
      return [["Category", x.category], ["Issue Type", x.issue],
        ["Current Exceptions", String(x.curCount), "n"], ["Previous Exceptions", String(x.prevCount), "n"], ["Exception Change", chgText(x.count), "n"],
        ["Current Impact (min)", num(x.curMinutes), "n"], ["Previous Impact (min)", num(x.prevMinutes), "n"], ["Impact Change (min)", chgText(x.impact), "n"]];
    }, noneText("No recurring issue changed between the two periods."));

    // Hotspot movement
    function hotCells(x) {
      return [["Category", x.category], ["Location", x.location],
        ["Current Impact (min)", num(x.curMinutes), "n"], ["Previous Impact (min)", num(x.prevMinutes), "n"], ["Impact Change (min)", chgText(x.impact), "n"],
        ["Current Exceptions", String(x.curCount), "n"], ["Previous Exceptions", String(x.prevCount), "n"]];
    }
    fillTable("hup", cmp.hotspotsUp, hotCells, noneText("No combination increased in impact minutes."));
    fillTable("hdown", cmp.hotspotsDown, hotCells, noneText("No combination decreased in impact minutes."));

    // Management review candidates
    var cand = $("cand-note");
    if (!cmp.hasBoth) {
      fillTable("cand", [], function () { return []; }, "Review candidates need exceptions in both the current and the previous period.");
      cand.textContent = "";
    } else {
      fillTable("cand", cmp.candidates, function (x) {
        return [["Category", x.category], ["Issue Type", x.issue], ["Location", x.location],
          ["Current Exceptions", String(x.curCount), "n"], ["Previous Exceptions", String(x.prevCount), "n"],
          ["Current Impact (min)", num(x.curMinutes), "n"], ["Previous Impact (min)", num(x.prevMinutes), "n"],
          ["Impact Change (min)", signed(x.impactChange, 0), "n"],
          ["Current Reopened", String(x.curReopened), "n"], ["Previous Reopened", String(x.prevReopened), "n"],
          ["Latest Occurrence", dateTimeText(x.last)]];
      }, "No group had more impact minutes, exceptions or reopened exceptions than in the previous period.");
      cand.textContent = cmp.candidateCount > 15 ? "Showing 15 of " + cmp.candidateCount + " candidates." : "";
    }

    // Response and closure comparison
    var P = cmp.perf;
    var perfRows = [
      ["Average Time from Reporting to Start of Work", P.avgStart, "min", 1, false], ["Median Time from Reporting to Start of Work", P.medStart, "min", 1, false],
      ["Average Time from Reporting to Resolution", P.avgResolve, "min", 1, false], ["Median Time from Reporting to Resolution", P.medResolve, "min", 1, false],
      ["Percentage Resolved", P.pctResolved, "percentage points", 1, true], ["Percentage Reopened", P.pctReopened, "percentage points", 1, true]
    ];
    fillTable("perf", perfRows, function (x) {
      var c = changeParts(x[1], x[2], x[3], x[4]);
      var unit = x[4] ? "%" : "min";
      return [["Measure", x[0]], ["Current", valText(x[1].cur, unit, x[3]), "n"], ["Previous", valText(x[1].prev, unit, x[3]), "n"],
        ["Change", c.main + (c.dir && c.dir !== "No change" ? " \u00b7 " + c.dir : ""), "n"]];
    });

    // Priority comparison
    fillTable("prio", cmp.priority, function (x) {
      return [["Current Priority", x.name], ["Current Exceptions", String(x.curCount), "n"], ["Previous Exceptions", String(x.prevCount), "n"],
        ["Exception Change", chgText(x.count), "n"], ["Current Impact (min)", num(x.curMinutes), "n"],
        ["Previous Impact (min)", num(x.prevMinutes), "n"], ["Impact Change (min)", chgText(x.impact), "n"]];
    });
  }

  // ---------------------------------------------------------------- Phase E drawing (forecast readiness)
  function stateClass(state) { return state.replace(/ /g, ""); }
  function setBadge(id, state) { var b = $(id); b.textContent = state; b.className = "rbadge " + stateClass(state); }
  function fillList(id, items) {
    var ul = $(id);
    ul.textContent = "";
    items.forEach(function (t) { ul.appendChild(el("li", "", t)); });
  }
  function statCard(box, value, title, sub) {
    var c = el("div", "card");
    c.appendChild(el("div", "n", value));
    c.appendChild(el("div", "t", title));
    c.appendChild(el("div", "s", sub || ""));
    box.appendChild(c);
  }

  function drawReadiness(r) {
    var R = r.cur.readiness;
    setBadge("r-overall-badge", R.overall);
    $("r-overall-summary").textContent = R.overallReasons[0];
    $("r-overall-note").textContent = R.overallReasons[1];
    $("r-overall-note").hidden = R.coverage.total === 0;
    [["count", R.exceptionCount], ["impact", R.impactMinutes], ["start", R.timeToStart], ["resolve", R.timeToResolve]].forEach(function (m) {
      setBadge("r-" + m[0] + "-badge", m[1].state);
      $("r-" + m[0] + "-sum").textContent = m[1].summary;
      fillList("r-" + m[0] + "-evidence", m[1].evidence);
      $("r-" + m[0] + "-evidence").previousElementSibling.hidden = !m[1].evidence.length;
      fillList("r-" + m[0] + "-reasons", m[1].unmet);
      $("r-" + m[0] + "-reasons").hidden = !m[1].unmet.length;
      var lab = $("r-" + m[0] + "-reason-label");
      lab.hidden = !m[1].unmet.length;
      lab.textContent = m[1].unmet.length === 1 ? "Reason" : "Reasons";
    });
    var ln = $("r-lifecycle-note");
    ln.textContent = R.lifecycleNote;
    ln.hidden = !R.lifecycleNote;
    fillList("r-notes", R.notes);

    var C = R.coverage, has = C.total > 0;
    var box = $("cov-cards");
    box.textContent = "";
    statCard(box, has ? dateText(C.earliest) : "—", "Earliest exception", has ? "" : "No exceptions in the selected period");
    statCard(box, has ? dateText(C.latest) : "—", "Latest exception", has ? "" : "No exceptions in the selected period");
    statCard(box, String(C.span), "Calendar span", "days, earliest to latest exception");
    statCard(box, String(C.total), "Total exceptions", "");
    statCard(box, String(C.activeDays), "Active days", "days with at least one exception");
    statCard(box, String(C.weeks), "Weeks represented", "weeks with at least one exception");
    statCard(box, String(C.months), "Months represented", "calendar months with at least one exception");
    statCard(box, String(C.zeroDays), "Zero-event days", "days in the span with no exception (descriptive)");
    statCard(box, C.perActiveDay === null ? "—" : one(C.perActiveDay), "Exceptions per active day", has ? "average" : "No exceptions in the selected period");
    statCard(box, num(C.totalImpact), "Total recorded impact minutes", "minutes");

    var K = R.concentration, cb = $("conc-cards");
    cb.textContent = "";
    function tieText(x) { return x && x.tied ? " (tied with " + x.tied + " other" + (x.tied === 1 ? "" : "s") + ")" : ""; }
    statCard(cb, K.largestImpact === null ? "—" : num(K.largestImpact) + " min", "Largest single-event impact", K.largestImpact === null ? "No exceptions in the selected period" : "");
    statCard(cb, K.largestSharePct === null ? "—" : pct1(K.largestSharePct), "Share of total impact from largest event", K.largestSharePct === null ? "Total impact is 0 or there are no exceptions" : "");
    statCard(cb, K.topCategory ? pct1(K.topCategory.sharePct) : "—", "Top category share of impact", K.topCategory ? K.topCategory.name + tieText(K.topCategory) : "No impact recorded");
    statCard(cb, K.topLocation ? pct1(K.topLocation.sharePct) : "—", "Top location share of impact", K.topLocation ? K.topLocation.name + tieText(K.topLocation) : "No impact recorded");
    statCard(cb, K.topIssue ? pct1(K.topIssue.sharePct) : "—", "Most common issue type share", K.topIssue ? K.topIssue.issue + " · " + K.topIssue.category + tieText(K.topIssue) : "No exceptions in the selected period");

    var body = $("rec-body");
    body.textContent = "";
    R.recurrence.categories.forEach(function (c) {
      var tr = el("tr");
      tr.appendChild(td("Category", c.name));
      tr.appendChild(td("Exceptions", String(c.count), "n"));
      tr.appendChild(td("Days with Exceptions", String(c.days), "n"));
      tr.appendChild(td("Locations", String(c.locations), "n"));
      tr.appendChild(td("Issue Types", String(c.issueTypes), "n"));
      body.appendChild(tr);
    });
    var rb = $("rec-cards");
    rb.textContent = "";
    statCard(rb, String(R.recurrence.once), "Seen once", "category + issue type combinations");
    statCard(rb, String(R.recurrence.twoToFour), "Seen 2–4 times", "category + issue type combinations");
    statCard(rb, String(R.recurrence.fivePlus), "Seen 5 or more times", "category + issue type combinations");

    var T = R.thresholds, G = T.general, tb = $("thr-body");
    tb.textContent = "";
    [["Exception Count",
      "Fewer than " + G.notReadySpan + " calendar days, fewer than " + G.notReadyCount + " exceptions, or fewer than " + G.notReadyActive + " active days.",
      "At least " + G.readySpan + " calendar days, at least " + G.readyCount + " exceptions, and at least " + G.readyActive + " active days."],
     ["Impact Minutes",
      "The Exception Count minimums are not met (counting exceptions with a recorded impact), or total recorded impact is 0.",
      "The Exception Count Ready requirements are met (counting exceptions with a recorded impact), and no single exception contributes more than " + G.maxSharePct + "% of total recorded impact."],
     ["Time-to-Start (reporting to start of work)",
      "Fewer than " + T.start.notReadyObs + " usable start observations.",
      "At least " + T.start.readyObs + " usable start observations, usable start times for at least " + T.start.readyPct + "% of filtered exceptions, and observations covering at least " + T.start.readySpan + " calendar days. A usable start observation has a start time that is not earlier than the reporting time."],
     ["Time-to-Resolve (reporting to resolution)",
      "Fewer than " + T.resolve.notReadyObs + " usable resolution observations.",
      "At least " + T.resolve.readyObs + " usable resolution observations, usable resolution times for at least " + T.resolve.readyPct + "% of filtered exceptions, and observations covering at least " + T.resolve.readySpan + " calendar days. A usable resolution observation is a currently Resolved exception whose resolution time is not earlier than its reporting time."]
    ].forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(td("Forecast type", row[0]));
      tr.appendChild(td("Not Ready if", row[1]));
      tr.appendChild(td("Ready if all of these are met", row[2]));
      tb.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------- Management overview (level 1 blocks; same numbers as below)
  var PLAIN_STATE = { "Ready": "Enough data", "Limited": "More history needed", "Not Ready": "Not enough data" };

  function topRows(listId, emptyId, rows) {
    var ol = $(listId);
    ol.textContent = "";
    $(emptyId).hidden = rows.length > 0;
    var max = rows.reduce(function (m, x) { return Math.max(m, x.value); }, 0);
    rows.forEach(function (x) {
      var li = el("li");
      var row = el("div", "row");
      row.appendChild(el("span", "nm", x.name));
      row.appendChild(el("span", "val", x.text));
      li.appendChild(row);
      if (x.meta) li.appendChild(el("div", "meta", x.meta));
      var bar = el("div", "bar2");
      var fill = el("i");
      fill.style.width = (max ? Math.max(3, Math.round(x.value / max * 100)) : 0) + "%";
      bar.appendChild(fill);
      li.appendChild(bar);
      ol.appendChild(li);
    });
  }

  function drawOverview(result) {
    var r = result.cur;

    // Where is the operational impact? (top 5 of the lists already calculated)
    var locs = r.byLocation.filter(function (x) { return x.minutes > 0; }).slice()
      .sort(function (a, b) { return b.minutes - a.minutes || b.count - a.count || byLabel(a.name, b.name); }).slice(0, 5);
    topRows("top-loc", "top-loc-empty", locs.map(function (x) {
      return { name: x.name, value: x.minutes, text: num(x.minutes) + " min", meta: x.count + " exception" + (x.count === 1 ? "" : "s") };
    }));
    topRows("top-issue", "top-issue-empty", r.topIssues.slice(0, 5).map(function (x) {
      return { name: x.issue, value: x.count, text: x.count + " exception" + (x.count === 1 ? "" : "s"), meta: x.category };
    }));

    // Items for management review (first 5 of the existing candidate list)
    var cmp = result.cmp, list = $("review-list"), more = $("review-more"), empty = $("review-empty");
    list.textContent = "";
    more.hidden = true;
    if (cmp) {
      empty.hidden = cmp.hasBoth && cmp.candidates.length > 0;
      empty.textContent = !cmp.hasBoth ? "Review items need exceptions in both the current and the previous period."
        : cmp.candidates.length ? "" : "No group had more impact minutes, exceptions or reopened exceptions than in the previous period.";
      if (cmp.hasBoth) {
        cmp.candidates.slice(0, 5).forEach(function (x) {
          var li = el("li");
          var row = el("div", "row");
          row.appendChild(el("span", "nm", x.category + " \u00b7 " + x.issue + " \u00b7 " + x.location));
          li.appendChild(row);
          li.appendChild(el("div", "meta", x.curCount + " exception" + (x.curCount === 1 ? "" : "s") + " \u00b7 " + num(x.curMinutes) + " impact minutes"));
          list.appendChild(li);
        });
        more.hidden = cmp.candidateCount <= 5;
        more.textContent = "View all " + cmp.candidateCount + " items";
      }
    }

    // Data available for future forecasting (plain wording; exact states stay in the methodology section)
    var R = r.readiness;
    [["count", R.exceptionCount], ["impact", R.impactMinutes], ["start", R.timeToStart], ["resolve", R.timeToResolve]].forEach(function (m) {
      var b = $("fd-" + m[0]);
      b.textContent = PLAIN_STATE[m[1].state];
      b.className = "rbadge " + stateClass(m[1].state);
    });
  }

  function resizeCharts() {
    Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); });
  }

  function draw(result) {
    var r = result.cur;
    lastResult = r;
    // KPI cards
    setKpi("k-total", String(r.total), "");
    setKpi("k-impact", num(r.totalImpact), "minutes");
    setKpi("k-avg", r.avgImpact === null ? "—" : one(r.avgImpact), r.avgImpact === null ? "No exceptions in the selected period" : "minutes per exception");
    setKpi("k-start", r.timeToStart.n ? one(r.timeToStart.avg) : "—",
      r.timeToStart.n ? "minutes from reporting until work starts" : "No start times recorded in the selected period");
    setKpi("k-resolve", r.timeToResolve.n ? one(r.timeToResolve.avg) : "—",
      r.timeToResolve.n ? "minutes from reporting until resolution" : "No resolved exceptions in the selected period");
    setKpi("k-reopened", String(r.reopened), r.total ? "of " + r.total + " exceptions" : "");

    // Strategic management attention (period-over-period facts; the fallback text when no comparison is possible)
    var att = $("attention");
    att.textContent = "";
    var lead = $("attention-lead");
    lead.hidden = !(result.cmp && result.cmp.hasBoth);
    lead.textContent = lead.hidden ? "" : result.cmp.attentionLead;
    $("attention-note").hidden = !(result.cmp && result.cmp.hasBoth);
    (result.cmp ? result.cmp.attention : ["Period-over-period statements are not available for All time."])
      .forEach(function (t) { att.appendChild(el("li", "", t)); });

    // Charts
    var s = r.series;
    var per = s.mode === "day" ? "day" : "month";
    $("t-created").textContent = "Exceptions Over Time (per " + per + ")";
    $("t-impact").textContent = "Recorded Impact Over Time (per " + per + ")";
    var ov = result.overlay;
    var hasChartData = r.total > 0 || (ov && result.prev && result.prev.total > 0);
    chart("c-created", lineConfig(s.labels, s.counts, "Exceptions", NAVY, ov ? ov.counts : null), hasChartData);
    chart("c-impact", lineConfig(s.labels, s.impact, "Impact minutes", AMBER, ov ? ov.impact : null), hasChartData);
    // Composition of what is still unresolved (exceptions created in the selected period that are not Resolved)
    var act = r.activeByCategory;
    var actCount = act.filter(function (x) { return x.count > 0; });
    var actMin = act.filter(function (x) { return x.minutes > 0; });
    chart("c-act-count", donutConfig(actCount.map(function (x) { return x.name; }), actCount.map(function (x) { return x.count; }), "exceptions"),
      actCount.length > 0, "No unresolved exceptions in the selected period.");
    chart("c-act-impact", donutConfig(actMin.map(function (x) { return x.name; }), actMin.map(function (x) { return x.minutes; }), "impact minutes"),
      actMin.length > 0, "No unresolved impact minutes in the selected period.");
    chart("c-cat", barConfig(r.byCategory.map(function (x) { return x.name; }), r.byCategory.map(function (x) { return x.minutes; }), "Impact minutes"), r.total > 0);
    chart("c-loc", barConfig(r.byLocation.map(function (x) { return x.name; }), r.byLocation.map(function (x) { return x.minutes; }), "Impact minutes"), r.total > 0);
    chart("c-shift", barConfig(r.byShift.map(function (x) { return x.name; }), r.byShift.map(function (x) { return x.count; }), "Exceptions"), r.total > 0);
    chart("c-issue", barConfig(r.topIssues.map(function (x) { return x.issue + " (" + x.category + ")"; }), r.topIssues.map(function (x) { return x.count; }), "Exceptions", true), r.total > 0);

    // Hotspots
    var hs = $("hotspots");
    hs.textContent = "";
    if (!r.hotspots.length) hs.appendChild(el("div", "empty", "No exceptions match the selected filters."));
    r.hotspots.forEach(function (h, i) {
      var card = el("div", "hot");
      card.appendChild(el("span", "rank", String(i + 1)));
      var body = el("div", "hot-body");
      body.appendChild(el("div", "hot-title", h.category + " · " + h.location));
      body.appendChild(el("div", "hot-meta", num(h.minutes) + " impact minutes · " + h.count + " exception" + (h.count === 1 ? "" : "s")));
      card.appendChild(body);
      hs.appendChild(card);
    });

    drawConstraints(r);

    // Response and closure performance
    $("p-median-start").textContent = minutesText1(r.timeToStart.median);
    $("p-median-start-sub").textContent = r.timeToStart.n ? "based on " + r.timeToStart.n + " exception" + (r.timeToStart.n === 1 ? "" : "s") + " with a start time" : "No start times recorded in the selected period";
    $("p-median-resolve").textContent = minutesText1(r.timeToResolve.median);
    $("p-median-resolve-sub").textContent = r.timeToResolve.n ? "based on " + r.timeToResolve.n + " resolved exception" + (r.timeToResolve.n === 1 ? "" : "s") : "No resolved exceptions in the selected period";
    $("p-resolved").textContent = r.pctResolved === null ? "—" : r.pctResolved;
    $("p-resolved-sub").textContent = r.total ? r.resolvedCount + " of " + r.total + " exceptions are currently Resolved" : "No exceptions in the selected period";
    $("p-reopened").textContent = r.pctReopened === null ? "—" : r.pctReopened;
    $("p-reopened-sub").textContent = r.total ? r.reopened + " of " + r.total + " exceptions reopened at least once" : "No exceptions in the selected period";

    // Priority distribution
    var pb = $("priority-body");
    pb.textContent = "";
    PRIORITIES.concat(r.priority.none.count ? ["none"] : []).forEach(function (p) {
      var tr = el("tr");
      var name = p === "none" ? "Not recorded" : p;
      var cell = el("td", "", "");
      cell.setAttribute("data-label", "Current Priority");
      if (p !== "none") cell.appendChild(el("span", "badge " + p, name)); else cell.textContent = name;
      tr.appendChild(cell);
      tr.appendChild(td("Exceptions", String(r.priority[p].count), "n"));
      tr.appendChild(td("Total Impact (min)", num(r.priority[p].minutes), "n"));
      pb.appendChild(tr);
    });
    $("priority-changes").textContent = String(r.priorityChanges);
    $("priority-changes-sub").textContent = r.total ? "of " + r.total + " exceptions (priority changed at least once)" : "No exceptions in the selected period";

    drawComparison(result);
    drawReadiness(result);
    drawOverview(result);
  }

  async function refresh() {
    var f = filters();
    if (f.range.error) { showError(f.range.error); return; }
    clearError();
    var token = ++loadToken;
    $("loading").hidden = false;
    $("content").classList.add("busy");
    try {
      var result = await load(f);
      if (token !== loadToken) return;          // a newer filter change is already running
      draw(result);
      drawPartialNote(f.range);
      $("loading").hidden = true;
      $("content").hidden = false;
      $("content").classList.remove("busy");
    } catch (e) {
      if (token !== loadToken) return;
      $("loading").hidden = true;
      $("content").classList.remove("busy");
      var text = "Sorry, the analytics could not load. Error: " + e.message;
      if (MineShift.isSessionError(e.message)) text += " Your sign-in may have ended. Please sign in again.";
      showError(text);
    }
  }

  // The present operational day is still in progress. When the period reaches the present moment, say so (nothing is
  // calculated differently and no shift is excluded). The time and shift come from the India-time helper.
  function drawPartialNote(range) {
    var n = $("partial-note");
    var i = window.MineShiftClock ? MineShiftClock.info(MineShiftClock.now()) : null;
    // range.to is exclusive; an open end (Last N days, All time) reaches the present.
    var reachesNow = i && (!range.to || range.to.getTime() > i.ms);
    n.hidden = !reachesNow;
    n.textContent = reachesNow
      ? "Current-period data may be incomplete because the present operational day is still in progress. As of " + i.asOf + " (" + i.shift + " shift)."
      : "";
  }

  function syncCustom() { $("custom-dates").hidden = $("f-range").value !== "custom"; }

  function init() {
    ["f-range", "f-shift", "f-cat", "f-loc"].forEach(function (id) {
      $(id).addEventListener("change", function () { syncCustom(); refresh(); });
    });
    ["f-from", "f-to"].forEach(function (id) { $(id).addEventListener("change", refresh); });
    $("f-reset").addEventListener("click", function () {
      $("f-range").value = "30"; $("f-shift").value = "All"; $("f-cat").value = "All"; $("f-loc").value = "All";
      $("f-from").value = ""; $("f-to").value = "";
      syncCustom(); refresh();
    });
    $("constraints-more").addEventListener("click", function () {
      showAllConstraints = !showAllConstraints;
      if (lastResult) drawConstraints(lastResult);
    });
    $("review-more").addEventListener("click", function () {
      $("detail").open = true;
      resizeCharts();
      $("cand-table").closest(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("fd-link").addEventListener("click", function (e) {
      e.preventDefault();
      $("detail").open = true;
      $("method").open = true;
      resizeCharts();
      $("method").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("detail").addEventListener("toggle", resizeCharts);
    syncCustom();
  }

  (async function () {
    var ctx = await MineShift.start("analytics");
    if (!ctx) return;
    access = ctx.access;
    // Management analytics: Shift In-Charge and above only. Nothing is requested for anyone else.
    if (!MineShift.can("view_analytics", access)) {
      $("denied").hidden = false;
      return;
    }
    $("app").hidden = false;
    init();
    await refresh();
  })();
})(typeof window !== "undefined" ? window : globalThis);
