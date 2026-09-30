// auth.js - shared sign-in helper for MineShift Command (login and roles).
// Used by login.html, index.html and dashboard.html.
// Load it AFTER the Supabase script and config.js:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="config.js"></script>
//   <script src="auth.js"></script>
// It creates the one database client (MineShift.db) and knows who is signed in.
// It holds NO passwords and NO secret keys. The role always comes from the database
// (the protected profiles table). The can() answers below only decide which buttons to
// SHOW. The database enforces the real permissions.
(function () {
  "use strict";

  var ROLES = {
    overman:         { label: "Overman / Supervisor", rank: 1 },
    shift_incharge:  { label: "Shift In-Charge",      rank: 2 },
    manager:         { label: "Manager",              rank: 3 },
    project_officer: { label: "Project Officer",      rank: 4 },
    general_manager: { label: "General Manager",      rank: 5 }
  };

  var state = { db: null, ready: false, error: "" };
  try {
    var url = window.SUPABASE_URL || "";
    var key = window.SUPABASE_PUBLISHABLE_KEY || "";
    if (url.indexOf("PASTE") !== -1 || key.indexOf("sb_publishable_") !== 0) {
      throw new Error("Database settings in config.js are not filled in yet.");
    }
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("The Supabase library could not be loaded.");
    }
    state.db = window.supabase.createClient(url, key);
    state.ready = true;
  } catch (e) {
    state.error = e.message;
  }

  function needDb() {
    if (!state.ready) throw new Error(state.error || "The database is not connected.");
    return state.db;
  }

  // The signed-in session, or null.
  async function getSession() {
    var res = await needDb().auth.getSession();
    if (res.error) throw new Error(res.error.message);
    return res.data.session || null;
  }

  async function signIn(email, password) {
    var res = await needDb().auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw new Error(res.error.message);
    return res.data.session;
  }

  async function signOut() {
    var res = await needDb().auth.signOut();
    if (res.error) throw new Error(res.error.message);
  }

  // What the DATABASE says about the signed-in user:
  // { linked, active, full_name, role, rank, can_operate }.
  async function loadAccess() {
    var res = await needDb().rpc("my_access");
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }

  // Which buttons to show for a role. Guide only; the database decides.
  function can(action, access) {
    if (!access || !access.linked || !access.active) return false;
    var r = access.role;
    var op = access.can_operate === true;
    switch (action) {
      case "create":             return r === "overman" || r === "shift_incharge";
      case "start":              return r === "overman" || r === "shift_incharge" || (r === "manager" && op);
      case "request_closure":    return r === "overman" || r === "shift_incharge";
      case "decline_closure":    return r === "shift_incharge" || (r === "manager" && op);
      case "resolve":            return r === "shift_incharge" || (r === "manager" && op);
      // Reopen after an inspection or review: Shift In-Charge and every management role. No can_operate needed.
      case "reopen":             return r === "shift_incharge" || r === "manager" || r === "project_officer" || r === "general_manager";
      case "change_priority":    return access.rank >= 2;
      case "remark_operational": return r === "overman" || r === "shift_incharge";
      case "remark_management":  return r === "manager" || r === "project_officer" || r === "general_manager";
      case "view_analytics":     return access.rank >= 2;
      case "view_all_history":   return access.rank >= 2;
      case "view_own_history":   return access.rank >= 1;
      default:                   return false;
    }
  }

  // For pages that need a signed-in user (used from Phase B on).
  // Sends you to login.html when nobody is signed in. Resolves to { session, access }.
  async function requireLogin() {
    var session = await getSession();
    if (!session) { window.location.replace("login.html"); return null; }
    var access = await loadAccess();
    if (!access || !access.linked || !access.active) {
      await signOut();
      window.location.replace("login.html");
      return null;
    }
    return { session: session, access: access };
  }

  // Runs your function if the person is signed out (also when the session expires).
  function onSignedOut(callback) {
    if (!state.ready) return;
    state.db.auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") callback();
    });
  }

  // Which pages each person sees in the menu. Convenience only: the database decides.
  var PAGES = [
    { id: "index",     href: "index.html",     label: "Add Shift Exception", action: "create" },
    { id: "dashboard", href: "dashboard.html", label: "Dashboard",           action: null }
  ];

  // Fills the shared header: role-aware menu, the person's name and role, and Sign out.
  // Expects <nav id="nav"></nav> and <div class="who" id="who"></div> in the page header.
  function mountHeader(access, activeId) {
    var nav = document.getElementById("nav");
    var who = document.getElementById("who");
    if (nav) {
      nav.textContent = "";
      PAGES.forEach(function (p) {
        if (p.action && !can(p.action, access)) return;
        var a = document.createElement("a");
        a.href = p.href;
        a.textContent = p.label;
        if (p.id === activeId) a.className = "active";
        nav.appendChild(a);
      });
    }
    if (who) {
      who.textContent = "";
      var text = document.createElement("div");
      text.className = "who-text";
      var name = document.createElement("span");
      name.className = "who-name";
      name.textContent = access.full_name;
      var role = document.createElement("span");
      role.className = "who-role";
      var r = ROLES[access.role];
      role.textContent = r ? r.label : access.role;
      text.appendChild(name);
      text.appendChild(role);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "who-out";
      btn.textContent = "Sign out";
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try { await signOut(); } catch (e) { /* leave anyway */ }
        window.location.replace("login.html");
      });
      who.appendChild(text);
      who.appendChild(btn);
    }
  }

  // One call for every protected page: needs a signed-in person with an active role,
  // fills the header, and leaves for login.html if the session ends.
  // Returns { session, access } or null (when it has redirected or shown a problem).
  // Shows problems in an element with id="msg".
  async function start(activeId) {
    var box = document.getElementById("msg");
    function problem(text) {
      if (box) { box.className = "err"; box.textContent = text; }
    }
    if (!state.ready) {
      problem("The database is not connected. Please tell the team. Error: " + state.error);
      return null;
    }
    try {
      var ctx = await requireLogin();
      if (!ctx) return null;
      mountHeader(ctx.access, activeId);
      onSignedOut(function () { window.location.replace("login.html"); });
      return ctx;
    } catch (e) {
      problem("Sorry, the sign-in check did not work. Error: " + e.message +
              " You can try signing in again.");
      return null;
    }
  }

  // Tells you if an error message means "your sign-in has ended".
  function isSessionError(message) {
    return /jwt|token|not authenticated|session/i.test(String(message || ""));
  }

  window.MineShift = {
    ROLES: ROLES,
    get db() { return state.db; },
    get ready() { return state.ready; },
    get error() { return state.error; },
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    loadAccess: loadAccess,
    can: can,
    requireLogin: requireLogin,
    onSignedOut: onSignedOut,
    mountHeader: mountHeader,
    start: start,
    isSessionError: isSessionError
  };
})();
