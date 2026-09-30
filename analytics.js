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
    CATEGORIES.forEach(function (c) { byCat[c] = { name: c, count: 0, minutes: 0 }; });
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
      topIssues: issuesAll.slice(0, 10),
      issuesAll: issuesAll,
      hotspotsAll: hotspotsAll,
      hotspots: hotspotsAll.slice(0, 5),
      constraints: constraints
    };
    result.attention = attention(result);
    return result;
  }

  var api = {
    CATEGORIES: CATEGORIES, SHIFTS: SHIFTS, LOCATIONS: LOCATIONS, PRIORITIES: PRIORITIES,
    resolveRange: resolveRange, compute: compute, median: median, mean: mean
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
    var rows = await fetchAll(function () {
      var q = db.from("shift_exceptions").select(COLS);
      if (f.range.from) q = q.gte("created_at", f.range.from.toISOString());
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
      // than itself, so the start of the period is a safe lower bound. No upper bound: a reopen
      // after the period still belongs to an exception created inside it.
      var audit = await fetchAll(function () {
        var q = db.from("exception_audit").select("exception_id,action,created_at")
          .in("action", ["reopened", "priority_changed"]);
        if (f.range.from) q = q.gte("created_at", f.range.from.toISOString());
        return q.order("created_at", { ascending: true }).order("id", { ascending: true });
      });
      audit.forEach(function (a) {
        if (!ids[a.exception_id]) return;
        if (a.action === "reopened") reopened[a.exception_id] = true;
        if (a.action === "priority_changed") changed[a.exception_id] = true;
      });
    }
    return compute(rows, reopened, changed, f.range, new Date());
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

  function chart(id, config, hasData) {
    var box = $(id).parentNode;
    var note = box.querySelector(".nodata");
    if (note) note.remove();
    if (charts[id]) { charts[id].destroy(); charts[id] = null; }
    if (!hasData) {
      $(id).style.display = "none";
      box.appendChild(el("div", "nodata", "No data for these filters."));
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

  function lineConfig(labels, data, label, color) {
    return {
      type: "line",
      data: { labels: labels, datasets: [{ label: label, data: data, borderColor: color, backgroundColor: color + "22",
        fill: true, tension: 0.2, pointRadius: labels.length > 45 ? 0 : 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
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
      tr.appendChild(td("Exception Count", String(g.count), "n"));
      tr.appendChild(td("Total Impact Minutes", num(g.minutes), "n"));
      tr.appendChild(td("Average Impact Minutes", one(g.avg), "n"));
      tr.appendChild(td("Resolved Count", String(g.resolved), "n"));
      tr.appendChild(td("Reopened Count", String(g.reopened), "n"));
      tr.appendChild(td("Last Occurrence", new Date(g.last).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })));
      body.appendChild(tr);
    });
    $("constraints-empty").hidden = r.constraints.length > 0;
    $("constraints-table").hidden = r.constraints.length === 0;
    var more = $("constraints-more");
    more.hidden = r.constraints.length <= 15;
    more.textContent = showAllConstraints ? "Show top 15 only" : "Show all " + r.constraints.length + " groups";
  }

  function draw(r) {
    lastResult = r;
    // KPI cards
    setKpi("k-total", String(r.total), "");
    setKpi("k-impact", num(r.totalImpact), "minutes");
    setKpi("k-avg", r.avgImpact === null ? "—" : one(r.avgImpact), r.avgImpact === null ? "No data" : "minutes per exception");
    setKpi("k-start", r.timeToStart.n ? one(r.timeToStart.avg) : "—",
      r.timeToStart.n ? "minutes, from " + r.timeToStart.n + " started exception" + (r.timeToStart.n === 1 ? "" : "s") : "No data");
    setKpi("k-resolve", r.timeToResolve.n ? one(r.timeToResolve.avg) : "—",
      r.timeToResolve.n ? "minutes, from " + r.timeToResolve.n + " resolved exception" + (r.timeToResolve.n === 1 ? "" : "s") : "No data");
    setKpi("k-reopened", String(r.reopened), r.total ? "of " + r.total + " exceptions" : "");

    // Management attention
    var att = $("attention");
    att.textContent = "";
    r.attention.forEach(function (t) { att.appendChild(el("li", "", t)); });

    // Charts
    var s = r.series;
    var per = s.mode === "day" ? "day" : "month";
    $("t-created").textContent = "Exceptions Created Over Time (per " + per + ")";
    $("t-impact").textContent = "Impact Minutes Over Time (per " + per + ")";
    chart("c-created", lineConfig(s.labels, s.counts, "Exceptions", NAVY), r.total > 0);
    chart("c-impact", lineConfig(s.labels, s.impact, "Impact minutes", AMBER), r.total > 0);
    chart("c-cat", barConfig(r.byCategory.map(function (x) { return x.name; }), r.byCategory.map(function (x) { return x.minutes; }), "Impact minutes"), r.total > 0);
    chart("c-loc", barConfig(r.byLocation.map(function (x) { return x.name; }), r.byLocation.map(function (x) { return x.minutes; }), "Impact minutes"), r.total > 0);
    chart("c-shift", barConfig(r.byShift.map(function (x) { return x.name; }), r.byShift.map(function (x) { return x.count; }), "Exceptions"), r.total > 0);
    chart("c-issue", barConfig(r.topIssues.map(function (x) { return x.issue + " (" + x.category + ")"; }), r.topIssues.map(function (x) { return x.count; }), "Exceptions", true), r.total > 0);

    // Hotspots
    var hs = $("hotspots");
    hs.textContent = "";
    if (!r.hotspots.length) hs.appendChild(el("div", "empty", "No exceptions match these filters."));
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
    $("p-median-start-sub").textContent = r.timeToStart.n ? "from " + r.timeToStart.n + " started exception" + (r.timeToStart.n === 1 ? "" : "s") : "No data";
    $("p-median-resolve").textContent = minutesText1(r.timeToResolve.median);
    $("p-median-resolve-sub").textContent = r.timeToResolve.n ? "from " + r.timeToResolve.n + " resolved exception" + (r.timeToResolve.n === 1 ? "" : "s") : "No data";
    $("p-resolved").textContent = r.pctResolved === null ? "—" : r.pctResolved;
    $("p-resolved-sub").textContent = r.total ? r.resolvedCount + " of " + r.total + " currently Resolved" : "No data";
    $("p-reopened").textContent = r.pctReopened === null ? "—" : r.pctReopened;
    $("p-reopened-sub").textContent = r.total ? r.reopened + " of " + r.total + " reopened at least once" : "No data";

    // Priority distribution
    var pb = $("priority-body");
    pb.textContent = "";
    PRIORITIES.concat(r.priority.none.count ? ["none"] : []).forEach(function (p) {
      var tr = el("tr");
      var name = p === "none" ? "Not recorded" : p;
      var cell = el("td", "", "");
      cell.setAttribute("data-label", "Current priority");
      if (p !== "none") cell.appendChild(el("span", "badge " + p, name)); else cell.textContent = name;
      tr.appendChild(cell);
      tr.appendChild(td("Exceptions", String(r.priority[p].count), "n"));
      tr.appendChild(td("Total Impact Minutes", num(r.priority[p].minutes), "n"));
      pb.appendChild(tr);
    });
    $("priority-changes").textContent = String(r.priorityChanges);
    $("priority-changes-sub").textContent = r.total ? "of " + r.total + " exceptions have at least one priority change" : "No data";
  }

  async function refresh() {
    var f = filters();
    if (f.range.error) { showError(f.range.error); return; }
    clearError();
    var token = ++loadToken;
    $("loading").hidden = false;
    $("content").classList.add("busy");
    try {
      var r = await load(f);
      if (token !== loadToken) return;          // a newer filter change is already running
      draw(r);
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
