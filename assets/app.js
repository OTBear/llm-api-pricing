(function () {
  "use strict";

  var DATA_URL = "llm_pricing.json";
  var NEWS_URL = "news/log.jsonl";
  var NEWS_LIMIT = 8;

  var fmt = window.LLMP.fmt;
  var escapeAttr = window.LLMP.escapeAttr;
  var modelHref = window.LLMP.modelHref;
  var providerDocHref = window.LLMP.providerDocHref;

  var state = {
    data: {},
    rows: [],
    provider: "all",
    sortKey: "output",
    sortDir: "desc",
  };

  var els = {
    providerSelect: document.getElementById("providerSelect"),
    downloadBtn: document.getElementById("downloadBtn"),
    body: document.getElementById("ratesBody"),
    table: document.getElementById("ratesTable"),
    count: document.getElementById("rowCount"),
    newsSection: document.getElementById("newsSection"),
    newsDate: document.getElementById("newsDate"),
    newsList: document.getElementById("newsList"),
    newsToggle: document.getElementById("newsToggle"),
  };

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
    return Promise.resolve();
  }

  function triggerDownload(filename, payload) {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function wireDownload() {
    els.downloadBtn.addEventListener("click", function () {
      var isAll = state.provider === "all";
      var filename = isAll ? "llm_pricing.json" : state.provider + ".json";
      var payload = isAll ? state.data : state.data[state.provider];
      triggerDownload(filename, payload);
    });
  }

  function wireCopyButtons() {
    els.body.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy-btn");
      if (!btn) return;
      var model = btn.dataset.model;
      copyText(model).then(function () {
        var original = btn.textContent;
        btn.textContent = "copied!";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove("copied");
        }, 1200);
      });
    });
  }

  function flatten(data) {
    var rows = [];
    Object.keys(data).forEach(function (provider) {
      var models = data[provider];
      Object.keys(models).forEach(function (model) {
        var price = models[model];
        rows.push({
          provider: provider,
          model: model,
          input: Number(price.input) || 0,
          output: Number(price.output) || 0,
        });
      });
    });
    return rows;
  }

  function buildProviderSelect(providers) {
    providers.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      els.providerSelect.appendChild(opt);
    });
    els.providerSelect.addEventListener("change", function (e) {
      state.provider = e.target.value;
      render();
    });
  }

  function sortRows(rows) {
    var key = state.sortKey;
    var dir = state.sortDir === "asc" ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }

  function render() {
    var filtered = state.rows.filter(function (r) {
      return state.provider === "all" || r.provider === state.provider;
    });

    filtered = sortRows(filtered);

    els.body.innerHTML = "";
    if (!filtered.length) {
      var emptyRow = document.createElement("tr");
      emptyRow.innerHTML = '<td colspan="4" class="empty">No models match this filter.</td>';
      els.body.appendChild(emptyRow);
    } else {
      var frag = document.createDocumentFragment();
      filtered.forEach(function (r) {
        var tr = document.createElement("tr");
        var docHref = providerDocHref(r.provider, r.model);
        var docLink = docHref
          ? '<a class="docs-link" href="' + escapeAttr(docHref) + '" target="_blank" rel="noopener" aria-label="Open provider docs for this model">docs</a>'
          : "";
        tr.innerHTML =
          "<td>" + r.provider + "</td>" +
          '<td><span class="model-cell"><a class="model-link" href="' + escapeAttr(modelHref(r.provider, r.model)) +
            '">' + r.model + "</a>" +
            '<button type="button" class="copy-btn" data-model="' + escapeAttr(r.model) +
            '" aria-label="Copy model ID to clipboard">copy</button>' +
            docLink + "</span></td>" +
          '<td class="col-num">' + fmt(r.input) + "</td>" +
          '<td class="col-num">' + fmt(r.output) + "</td>";
        frag.appendChild(tr);
      });
      els.body.appendChild(frag);
    }

    els.count.textContent = filtered.length + " of " + state.rows.length + " models";
  }

  function wireSorting() {
    var headers = els.table.querySelectorAll("thead th[data-key]");
    Array.prototype.forEach.call(headers, function (th) {
      function activate() {
        var key = th.dataset.key;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = key === "provider" || key === "model" ? "asc" : "desc";
        }
        Array.prototype.forEach.call(headers, function (h) {
          h.setAttribute("aria-sort", h === th ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
        });
        render();
      }
      th.addEventListener("click", activate);
      th.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  function loadNews() {
    fetch(NEWS_URL)
      .then(function (res) { return res.ok ? res.text() : ""; })
      .then(function (text) {
        var lines = text.split("\n").filter(function (l) { return l.trim(); });
        if (!lines.length) return;
        var latest = JSON.parse(lines[lines.length - 1]);
        if (!latest.events || !latest.events.length) return;

        els.newsSection.hidden = false;
        els.newsDate.textContent = latest.date;

        var events = latest.events;
        var expanded = false;

        function draw() {
          var shown = expanded ? events : events.slice(0, NEWS_LIMIT);
          els.newsList.innerHTML = shown.map(window.LLMP.renderNewsEvent).join("");
        }
        draw();

        if (events.length > NEWS_LIMIT) {
          els.newsToggle.hidden = false;
          els.newsToggle.textContent = "Show all " + events.length;
          els.newsToggle.addEventListener("click", function () {
            expanded = !expanded;
            draw();
            els.newsToggle.textContent = expanded ? "Show less" : "Show all " + events.length;
          });
        }
      })
      .catch(function () { /* news is a bonus section - fail quietly */ });
  }

  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      state.data = data;
      state.rows = flatten(data);
      var providers = Object.keys(data).sort();

      buildProviderSelect(providers);
      wireSorting();
      wireDownload();
      wireCopyButtons();
      render();
    })
    .catch(function (err) {
      els.body.innerHTML =
        '<tr><td colspan="4" class="empty">Could not load ' + DATA_URL + ": " + err.message + "</td></tr>";
    });

  loadNews();
})();
