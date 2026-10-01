// photos.js - optional photo evidence for exceptions (used by index.html and dashboard.html).
// Not a page. Load it AFTER auth.js. It holds NO keys: files go to the PRIVATE Storage bucket
// "exception-photos" with the signed-in person's own session, then the database function
// attach_exception_photo() links the file to the exception (see database/12-photo-evidence.sql).
// The database and Storage rules decide who may upload and who may look; this file only shows or hides things.
(function () {
  "use strict";

  var BUCKET = "exception-photos";
  var TYPES = ["image/jpeg", "image/png", "image/webp"];
  var MAX_PICK = 20 * 1024 * 1024;       // the largest file a person may choose (it is shrunk before upload)
  var MAX_UPLOAD = 4 * 1024 * 1024;      // the largest file we send (the bucket allows 5 MB)
  var MAX_SIDE = 1600;                   // longest side in pixels after shrinking
  var PAGE = 1000;
  var EVENT_LABEL = { report: "Report", remark: "Remark", closure: "Closure", reopen: "Reopen" };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var css = document.createElement("style");
  css.textContent =
    ".ph-field { margin-top: 10px; }" +
    ".ph-add { display: inline-flex; align-items: center; gap: 8px; min-height: 48px; padding: 10px 16px; font: inherit; font-size: 16px; font-weight: 700;" +
    "  border: 2px solid #0b2a5b; border-radius: 12px; background: #fff; color: #0b2a5b; cursor: pointer; }" +
    ".ph-add:focus-visible, .ph-small:focus-visible, .ph-thumb:focus-visible, .ph-close:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }" +
    ".ph-preview { margin-top: 10px; display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }" +
    ".ph-preview img { width: 120px; height: 120px; object-fit: cover; border-radius: 10px; border: 2px solid #c9d3e6; background: #eef2f9; }" +
    ".ph-btns { display: flex; gap: 8px; flex-wrap: wrap; }" +
    ".ph-small { min-height: 44px; padding: 8px 14px; font: inherit; font-size: 15px; font-weight: 700; border: 2px solid #0b2a5b; border-radius: 10px; background: #fff; color: #0b2a5b; cursor: pointer; }" +
    ".ph-small.danger { border-color: #b91c1c; color: #7f1d1d; }" +
    ".ph-note { display: block; margin-top: 10px; font-weight: 700; font-size: 16px; }" +
    ".ph-note input { display: block; width: 100%; margin-top: 6px; font: inherit; padding: 12px; border: 2px solid #c9d3e6; border-radius: 10px; }" +
    ".ph-help { margin: 4px 0 0; font-size: 14px; color: #4b5d80; font-weight: 400; }" +
    ".ph-err { margin-top: 8px; padding: 10px; border-radius: 10px; background: #fee2e2; color: #7f1d1d; border: 1px solid #fca5a5; }" +
    ".ph-list { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 8px; }" +
    ".ph-item { display: flex; gap: 12px; align-items: flex-start; padding: 8px; border: 1px solid #d7deee; border-radius: 10px; background: #fff; }" +
    ".ph-thumb { flex: 0 0 auto; width: 84px; height: 84px; padding: 0; border: 2px solid #0b2a5b; border-radius: 10px; overflow: hidden; background: #eef2f9; cursor: zoom-in; }" +
    ".ph-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }" +
    ".ph-meta { min-width: 0; font-size: 15px; word-wrap: break-word; }" +
    ".ph-event { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #0b2a5b; color: #fff; font-size: 13px; font-weight: 700; }" +
    "#ph-lightbox { position: fixed; inset: 0; z-index: 1000; background: rgba(5, 15, 40, .88); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; }" +
    "#ph-lightbox[hidden] { display: none; }" +
    "#ph-lightbox img { max-width: 100%; max-height: 72vh; border-radius: 8px; background: #fff; }" +
    "#ph-lightbox .ph-cap { color: #fff; margin-top: 10px; max-width: 640px; text-align: center; font-size: 16px; word-wrap: break-word; }" +
    ".ph-close { margin-top: 12px; min-height: 48px; padding: 10px 22px; font: inherit; font-size: 17px; font-weight: 700; border: 0; border-radius: 12px; background: #f59e0b; color: #1b1b1b; cursor: pointer; }";
  document.head.appendChild(css);

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // Shrinks the picked photo to a JPEG (also removes hidden camera data such as location) so uploads stay small and fast.
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("This photo could not be read. Please choose a JPEG, PNG or WebP picture.")); };
      img.src = url;
    });
  }
  function toJpeg(img, side, quality) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, side / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error("This photo could not be prepared.")); }, "image/jpeg", quality);
    });
  }
  async function shrink(file) {
    if (TYPES.indexOf(file.type) < 0) throw new Error("Please choose a JPEG, PNG or WebP picture.");
    if (file.size > MAX_PICK) throw new Error("This photo is too large (over 20 MB). Please choose a smaller one.");
    var img = await loadImage(file);
    var blob = await toJpeg(img, MAX_SIDE, 0.82);
    if (blob.size > MAX_UPLOAD) blob = await toJpeg(img, 1200, 0.6);
    if (blob.size > MAX_UPLOAD) throw new Error("This photo is still too large after shrinking. Please choose another one.");
    return blob;
  }

  // The "Add photo evidence" control: button, preview, change / remove, and the "Photo note" box.
  function field() {
    var box = el("div", "ph-field");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = TYPES.join(",");
    input.hidden = true;
    var add = el("button", "ph-add", "📷 Add photo evidence");
    add.type = "button";
    var preview = el("div", "ph-preview");
    preview.hidden = true;
    var img = document.createElement("img");
    img.alt = "Photo preview";
    var btns = el("div", "ph-btns");
    var change = el("button", "ph-small", "Change photo");
    change.type = "button";
    var remove = el("button", "ph-small danger", "Remove photo");
    remove.type = "button";
    btns.appendChild(change);
    btns.appendChild(remove);
    preview.appendChild(img);
    preview.appendChild(btns);
    var noteWrap = el("label", "ph-note", "Photo note");
    var note = document.createElement("input");
    note.type = "text";
    note.maxLength = 200;
    noteWrap.appendChild(note);
    noteWrap.appendChild(el("span", "ph-help", "Briefly describe what the photo shows."));
    noteWrap.hidden = true;
    var err = el("div", "ph-err");
    err.hidden = true;
    err.setAttribute("role", "alert");
    box.appendChild(input);
    box.appendChild(add);
    box.appendChild(preview);
    box.appendChild(noteWrap);
    box.appendChild(err);

    var blob = null, shown = null;
    function showError(text) { err.textContent = text; err.hidden = !text; }
    function clear() {
      blob = null; note.value = ""; input.value = "";
      if (shown) { URL.revokeObjectURL(shown); shown = null; }
      img.removeAttribute("src");
      preview.hidden = true; noteWrap.hidden = true; add.hidden = false; showError("");
    }
    function choose() { input.value = ""; input.click(); }
    add.addEventListener("click", choose);
    change.addEventListener("click", choose);
    remove.addEventListener("click", clear);
    input.addEventListener("change", async function () {
      var f = input.files && input.files[0];
      if (!f) return;
      showError("");
      try {
        var b = await shrink(f);
        if (shown) URL.revokeObjectURL(shown);
        blob = b;
        shown = URL.createObjectURL(b);
        img.src = shown;
        preview.hidden = false; noteWrap.hidden = false; add.hidden = true;
      } catch (e) {
        showError(e.message);
      }
    });
    return {
      node: box,
      hasPhoto: function () { return !!blob; },
      value: function () { return blob ? { blob: blob, caption: note.value.trim() } : null; },
      clear: clear
    };
  }

  // Uploads the file, then links it to the exception. Resolves to null when it worked, else a plain error text.
  async function upload(exceptionId, event, v) {
    if (!v) return null;
    var path = exceptionId + "/" + newId() + ".jpg";
    try {
      var up = await MineShift.db.storage.from(BUCKET).upload(path, v.blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      var res = await MineShift.db.rpc("attach_exception_photo",
        { p_exception: exceptionId, p_event: event, p_path: path, p_caption: v.caption || null });
      if (res.error) throw new Error(res.error.message);
      return null;
    } catch (e) {
      return e.message;
    }
  }

  // Reads every photo record the person may see: { exception_id: [ ...oldest first ] }.
  // Returns null if the feature is not set up in the database yet (the pages then simply hide it).
  async function loadAll() {
    var all = [], from = 0;
    try {
      for (;;) {
        var res = await MineShift.db.from("exception_photos")
          .select("id,exception_id,event,caption,added_by_name,added_by_role,created_at,path")
          .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
        if (res.error) return null;
        var data = res.data || [];
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
    } catch (e) { return null; }
    var by = {};
    all.forEach(function (p) { (by[p.exception_id] = by[p.exception_id] || []).push(p); });
    return by;
  }

  // Is photo evidence set up in the database yet? (One tiny read; false if the table is missing or not readable.)
  async function available() {
    try {
      var res = await MineShift.db.from("exception_photos").select("id").limit(1);
      return !res.error;
    } catch (e) { return false; }
  }

  var box = null;
  function lightbox() {
    if (box) return box;
    box = el("div", "");
    box.id = "ph-lightbox";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Photo evidence");
    var big = document.createElement("img");
    big.alt = "Photo evidence";
    var cap = el("div", "ph-cap");
    var close = el("button", "ph-close", "Close");
    close.type = "button";
    box.appendChild(big); box.appendChild(cap); box.appendChild(close);
    function hide() { box.hidden = true; big.removeAttribute("src"); }
    close.addEventListener("click", hide);
    box.addEventListener("click", function (ev) { if (ev.target === box) hide(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !box.hidden) hide(); });
    document.body.appendChild(box);
    box.__big = big; box.__cap = cap; box.__close = close;
    return box;
  }
  async function signed(path) {
    var res = await MineShift.db.storage.from(BUCKET).createSignedUrl(path, 600);
    if (res.error) throw new Error(res.error.message);
    return res.data.signedUrl;
  }
  async function openBig(p, line) {
    var lb = lightbox();
    lb.__cap.textContent = line + (p.caption ? " - " + p.caption : "");
    lb.__big.removeAttribute("src");
    lb.hidden = false;
    try { lb.__big.src = await signed(p.path); } catch (e) { lb.__cap.textContent = "The photo could not be opened. Error: " + e.message; }
    lb.__close.focus();
  }

  // A "Photo evidence (n)" section for one exception card. Thumbnails load only when it is opened.
  // helpers: { roleLabel(role), fmtTime(iso) } come from the page so wording and time zone stay the same.
  function block(list, helpers) {
    if (!list || !list.length) return null;
    var d = el("details", "sec");
    d.appendChild(el("summary", "", "📷 Photo evidence (" + list.length + ")"));
    var body = el("div", "ph-list");
    d.appendChild(body);
    d.addEventListener("toggle", async function () {
      if (!d.open) return;
      body.textContent = "Loading photos...";
      try {
        var urls = await Promise.all(list.map(function (p) { return signed(p.path); }));
        body.textContent = "";
        list.forEach(function (p, i) {
          var line = (EVENT_LABEL[p.event] || p.event) + " photo · added by " + p.added_by_name +
            " (" + helpers.roleLabel(p.added_by_role) + ") · " + helpers.fmtTime(p.created_at);
          var item = el("div", "ph-item");
          var tb = el("button", "ph-thumb");
          tb.type = "button";
          tb.setAttribute("aria-label", "Open larger photo: " + line);
          var im = document.createElement("img");
          im.alt = p.caption || "Photo evidence";
          im.loading = "lazy";
          im.src = urls[i];
          tb.appendChild(im);
          tb.addEventListener("click", function () { openBig(p, line); });
          var meta = el("div", "ph-meta");
          meta.appendChild(el("span", "ph-event", EVENT_LABEL[p.event] || p.event));
          meta.appendChild(el("div", "", "Added by " + p.added_by_name + " (" + helpers.roleLabel(p.added_by_role) + ")"));
          meta.appendChild(el("div", "", helpers.fmtTime(p.created_at)));
          if (p.caption) meta.appendChild(el("div", "", "Photo note: " + p.caption));
          item.appendChild(tb);
          item.appendChild(meta);
          body.appendChild(item);
        });
      } catch (e) {
        body.textContent = "";
        body.appendChild(el("div", "ph-err", "Sorry, the photos could not load. Error: " + e.message));
      }
    });
    return d;
  }

  window.MinePhotos = { field: field, upload: upload, loadAll: loadAll, available: available, block: block, EVENT_LABEL: EVENT_LABEL };
})();
