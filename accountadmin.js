// accountadmin.js - "Account administration" panel for the Data Keeper (shown only on dashboard.html, only to an
// administrator). Not a page. Load it AFTER auth.js. It holds NO keys and never sets, shows or stores a password:
//   * "Send password reset" asks the database to log the request and return the account e-mail, then asks Supabase
//     to SEND the standard reset e-mail to that address.
//   * "Switch off / on" changes profiles.active through the database function admin_set_active.
// The database decides who is an administrator (profiles.can_administer, database/13-account-admin.sql).
(function () {
  "use strict";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var css = document.createElement("style");
  css.textContent =
    "#admin-panel { margin-top: 24px; }" +
    "#admin-panel > summary { cursor: pointer; font-weight: 800; font-size: 18px; padding: 14px; min-height: 48px; background: #fff; border: 2px solid #0b2a5b; border-radius: 12px; }" +
    "#admin-panel .ad-body { padding: 12px 0; }" +
    ".ad-note { font-size: 15px; color: #33466b; margin: 0 0 10px; }" +
    ".ad-row { padding: 12px; margin-bottom: 10px; background: #fff; border: 1px solid #d7deee; border-radius: 12px; word-wrap: break-word; }" +
    ".ad-row.off { background: #f3f4f6; }" +
    ".ad-name { font-weight: 800; font-size: 17px; }" +
    ".ad-meta { font-size: 15px; color: #33466b; margin-top: 2px; }" +
    ".ad-state { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #dbeafe; color: #0b2a5b; }" +
    ".ad-state.off { background: #e5e7eb; color: #374151; }" +
    ".ad-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }" +
    ".ad-btns button { min-height: 48px; padding: 10px 14px; font: inherit; font-size: 16px; font-weight: 700; border: 2px solid #0b2a5b; border-radius: 10px; background: #fff; color: #0b2a5b; cursor: pointer; }" +
    ".ad-btns button.danger { border-color: #b91c1c; color: #7f1d1d; }" +
    ".ad-btns button:disabled { opacity: .6; cursor: default; }" +
    ".ad-msg { margin: 8px 0; padding: 10px; border-radius: 10px; }" +
    ".ad-msg.ok { background: #dcfce7; color: #14532d; border: 1px solid #16a34a; }" +
    ".ad-msg.err { background: #fee2e2; color: #7f1d1d; border: 1px solid #dc2626; }";
  document.head.appendChild(css);

  function when(iso) {
    if (!iso) return "never";
    var d = new Date(iso);
    return isNaN(d) ? "unknown" : d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " IST";
  }

  // Resolves to true when this person is an administrator. Any error (for example migration 13 not run yet) means no.
  async function isAdmin() {
    try {
      var res = await MineShift.db.rpc("my_admin");
      return !res.error && res.data === true;
    } catch (e) { return false; }
  }

  function mount(host, ownId) {
    var panel = el("details", ""); panel.id = "admin-panel";
    panel.appendChild(el("summary", "", "Account administration (Data Keeper)"));
    var body = el("div", "ad-body");
    panel.appendChild(body);
    host.appendChild(panel);
    var msg = el("div", "ad-msg"); msg.hidden = true; msg.setAttribute("role", "status");

    function say(kind, text) { msg.className = "ad-msg " + kind; msg.textContent = text; msg.hidden = !text; }

    async function load() {
      body.textContent = "Loading accounts...";
      try {
        var res = await MineShift.db.rpc("admin_list_accounts");
        if (res.error) throw new Error(res.error.message);
        body.textContent = "";
        body.appendChild(el("p", "ad-note", "Send a password reset e-mail, or switch an account on or off. You never choose or see another person's password. Every action is recorded."));
        body.appendChild(msg);
        (res.data || []).forEach(function (a) { body.appendChild(row(a)); });
        if (!(res.data || []).length) body.appendChild(el("div", "ad-note", "No accounts found."));
      } catch (e) {
        body.textContent = "";
        var m = el("div", "ad-msg err", "Sorry, the accounts could not load. Error: " + e.message);
        body.appendChild(m);
      }
    }

    function row(a) {
      var linked = a.full_name !== null && a.full_name !== undefined;
      var off = linked && a.active === false;
      var r = el("div", "ad-row" + (off ? " off" : ""));
      var name = el("div", "ad-name", linked ? a.full_name : "(no profile yet)");
      if (linked) name.appendChild(el("span", "ad-state" + (off ? " off" : ""), off ? "Switched off" : "Active"));
      r.appendChild(name);
      var role = linked ? ((MineShift.ROLES[a.role] || {}).label || a.role) : "no role";
      r.appendChild(el("div", "ad-meta", role + (a.can_administer ? " · Data Keeper" : "")));
      r.appendChild(el("div", "ad-meta", a.email || "no e-mail"));
      r.appendChild(el("div", "ad-meta", "Last sign-in: " + when(a.last_sign_in_at)));
      var btns = el("div", "ad-btns");
      var reset = el("button", "", "Send password reset");
      reset.type = "button";
      reset.addEventListener("click", async function () {
        reset.disabled = true; say("", "");
        try {
          var r1 = await MineShift.db.rpc("admin_log_recovery", { p_user: a.user_id });
          if (r1.error) throw new Error(r1.error.message);
          await MineShift.requestPasswordReset(r1.data);
          say("ok", "A password reset e-mail has been requested for " + (linked ? a.full_name : r1.data) + ". Supabase sends it to the e-mail address on the account.");
        } catch (e) {
          say("err", "Sorry, the reset could not be requested. Error: " + e.message);
        }
        reset.disabled = false;
      });
      btns.appendChild(reset);
      if (linked && a.user_id !== ownId) {
        var tog = el("button", off ? "" : "danger", off ? "Switch on" : "Switch off");
        tog.type = "button";
        tog.addEventListener("click", async function () {
          if (!off && !window.confirm("Switch off " + a.full_name + "? They will not be able to use the tool until you switch them on again.")) return;
          tog.disabled = true; say("", "");
          try {
            var r2 = await MineShift.db.rpc("admin_set_active", { p_user: a.user_id, p_active: off });
            if (r2.error) throw new Error(r2.error.message);
            say("ok", a.full_name + " is now " + (off ? "active" : "switched off") + ".");
            await load();
          } catch (e) {
            say("err", "Sorry, that did not work. Error: " + e.message);
            tog.disabled = false;
          }
        });
        btns.appendChild(tog);
      }
      r.appendChild(btns);
      return r;
    }

    panel.addEventListener("toggle", function () { if (panel.open && !panel.__loaded) { panel.__loaded = true; load(); } });
    return panel;
  }

  window.MineAccounts = { isAdmin: isAdmin, mount: mount };
})();
