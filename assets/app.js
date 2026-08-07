(function () {
  "use strict";

  var DATA_URL = "llm_pricing.json";
  var METADATA_URL = "model_metadata.json";
  var NEWS_URL = "news/log.jsonl";
  var NEWS_LIMIT = 8;

  var fmt = window.LLMP.fmt;
  var escapeAttr = window.LLMP.escapeAttr;
  var modelHref = window.LLMP.modelHref;
  var providerDocHref = window.LLMP.providerDocHref;

  var AXES = {
    output: { label: "Output $/1M", format: null }, // format filled in below (needs `fmt`)
    input: { label: "Input $/1M", format: null },
    params_b: { label: "Model size (B params)", format: null },
    intelligence_index: { label: "Intelligence index", format: null },
  };

  var PROVIDER_COLORS = {
    google: "#4285f4",
    openai: "#10a37f",
    anthropic: "#d97757",
    openrouter: "#6366f1",
  };
  var FALLBACK_COLOR = "#64748b";
  var MATCH_COLOR = "#16a34a";

  var state = {
    data: {},
    rows: [],
    provider: "all",
    sortKey: "output",
    sortDir: "desc",
    activeTab: "table",
    xKey: "output",
    yKey: "intelligence_index",
    search: "",
    chart: null,
  };
  var chartDirty = true;

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
    tabButtons: document.querySelectorAll(".tabs .tab-btn"),
    tablePanel: document.getElementById("tablePanel"),
    chartPanel: document.getElementById("chartPanel"),
    xAxisSelect: document.getElementById("xAxisSelect"),
    yAxisSelect: document.getElementById("yAxisSelect"),
    chartSearch: document.getElementById("chartSearch"),
    chartCanvas: document.getElementById("scatterChart"),
    chartCount: document.getElementById("chartCount"),
    chartResetZoomBtn: document.getElementById("chartResetZoomBtn"),
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

  function flatten(data, metadata) {
    var rows = [];
    Object.keys(data).forEach(function (provider) {
      var models = data[provider];
      var providerMeta = metadata[provider] || {};
      Object.keys(models).forEach(function (model) {
        var price = models[model];
        var meta = providerMeta[model] || {};
        rows.push({
          provider: provider,
          model: model,
          input: Number(price.input) || 0,
          output: Number(price.output) || 0,
          params_b: meta.params_b === undefined ? null : meta.params_b,
          intelligence_index: meta.intelligence_index === undefined ? null : meta.intelligence_index,
        });
      });
    });
    return rows;
  }

  function fmtParams(n) {
    if (n === null || n === undefined) return "—";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "T";
    return n + "B";
  }

  function fmtIndex(n) {
    if (n === null || n === undefined) return "—";
    return String(n);
  }

  AXES.output.format = fmt;
  AXES.input.format = fmt;
  AXES.params_b.format = fmtParams;
  AXES.intelligence_index.format = fmtIndex;

  function providerColor(provider) {
    return PROVIDER_COLORS[provider] || FALLBACK_COLOR;
  }

  function buildAxisSelects() {
    [els.xAxisSelect, els.yAxisSelect].forEach(function (select) {
      Object.keys(AXES).forEach(function (key) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = AXES[key].label;
        select.appendChild(opt);
      });
    });
    els.xAxisSelect.value = state.xKey;
    els.yAxisSelect.value = state.yKey;

    els.xAxisSelect.addEventListener("change", function (e) {
      state.xKey = e.target.value;
      refreshChart();
    });
    els.yAxisSelect.addEventListener("change", function (e) {
      state.yKey = e.target.value;
      refreshChart();
    });
  }

  function refreshChart() {
    chartDirty = true;
    if (state.activeTab === "chart") {
      renderChart();
      chartDirty = false;
    }
  }

  function wireChartSearch() {
    els.chartSearch.addEventListener("input", function (e) {
      state.search = e.target.value.trim().toLowerCase();
      // Search only matters once the chart is visible; no need to mark it dirty
      // for a later tab switch, since typing implies the chart is already shown.
      renderChart();
    });
  }

  function wireChartResetZoom() {
    els.chartResetZoomBtn.addEventListener("click", function () {
      if (state.chart) state.chart.resetZoom();
    });
  }

  function matchesSearch(point) {
    if (!state.search) return false;
    return point.model.toLowerCase().indexOf(state.search) !== -1 ||
      point.provider.toLowerCase().indexOf(state.search) !== -1;
  }

  // Draws a small label next to every point that matches the current search,
  // since Chart.js has no built-in permanent point labels.
  var searchLabelPlugin = {
    id: "searchLabels",
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      chart.data.datasets.forEach(function (dataset, dsIndex) {
        var meta = chart.getDatasetMeta(dsIndex);
        dataset.data.forEach(function (point, i) {
          if (!matchesSearch(point)) return;
          var el = meta.data[i];
          if (!el) return;
          ctx.save();
          ctx.font = "600 11px -apple-system, sans-serif";
          ctx.fillStyle = MATCH_COLOR;
          ctx.textBaseline = "middle";
          ctx.fillText(point.model, el.x + 8, el.y);
          ctx.restore();
        });
      });
    },
  };

  function wireTabs() {
    Array.prototype.forEach.call(els.tabButtons, function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.dataset.tab;
        if (tab === state.activeTab) return;
        state.activeTab = tab;
        Array.prototype.forEach.call(els.tabButtons, function (b) {
          var active = b === btn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        els.tablePanel.hidden = tab !== "table";
        els.chartPanel.hidden = tab !== "chart";
        if (tab === "chart" && chartDirty) {
          renderChart();
          chartDirty = false;
        }
      });
    });
  }

  function renderChart() {
    var filtered = state.rows.filter(function (r) {
      return state.provider === "all" || r.provider === state.provider;
    });

    var xKey = state.xKey, yKey = state.yKey;
    var byProvider = {};
    filtered.forEach(function (r) {
      var x = r[xKey], y = r[yKey];
      if (x === null || x === undefined || y === null || y === undefined) return;
      (byProvider[r.provider] = byProvider[r.provider] || []).push({
        x: x, y: y, provider: r.provider, model: r.model,
      });
    });

    var datasets = Object.keys(byProvider).sort().map(function (provider) {
      var color = providerColor(provider);
      var points = byProvider[provider];
      var colors = points.map(function (p) { return matchesSearch(p) ? MATCH_COLOR : color; });
      var radii = points.map(function (p) { return matchesSearch(p) ? 7 : 4; });
      var hoverRadii = points.map(function (p) { return matchesSearch(p) ? 9 : 6; });
      return {
        label: provider,
        data: points,
        backgroundColor: colors,
        borderColor: colors,
        pointRadius: radii,
        pointHoverRadius: hoverRadii,
      };
    });

    var plotted = datasets.reduce(function (n, d) { return n + d.data.length; }, 0);
    els.chartCount.textContent =
      plotted + " of " + filtered.length + " models plotted (missing " +
      AXES[xKey].label + " or " + AXES[yKey].label + " excluded)";

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(els.chartCanvas.getContext("2d"), {
      type: "scatter",
      data: { datasets: datasets },
      plugins: [searchLabelPlugin],
      options: {
        responsive: true,
        scales: {
          x: { title: { display: true, text: AXES[xKey].label } },
          y: { title: { display: true, text: AXES[yKey].label } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: function (items) {
                var p = items[0].raw;
                return p.provider + " / " + p.model;
              },
              label: function (item) {
                var p = item.raw;
                return AXES[xKey].label + ": " + AXES[xKey].format(p.x) +
                  ", " + AXES[yKey].label + ": " + AXES[yKey].format(p.y);
              },
            },
          },
          zoom: {
            pan: { enabled: true, mode: "xy" },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "xy",
            },
          },
        },
        onClick: function (evt, elements) {
          if (!elements.length) return;
          var el = elements[0];
          var point = datasets[el.datasetIndex].data[el.index];
          window.location.href = modelHref(point.provider, point.model);
        },
        onHover: function (evt, elements) {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
      },
    });
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
      refreshChart();
    });
  }

  function sortRows(rows) {
    var key = state.sortKey;
    var dir = state.sortDir === "asc" ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var va = a[key], vb = b[key];
      // Missing values always sort last, regardless of direction.
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
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
      emptyRow.innerHTML = '<td colspan="6" class="empty">No models match this filter.</td>';
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
            '" title="' + escapeAttr(r.model) + '">' + r.model + "</a>" +
            '<button type="button" class="copy-btn" data-model="' + escapeAttr(r.model) +
            '" aria-label="Copy model ID to clipboard">copy</button>' +
            docLink + "</span></td>" +
          '<td class="col-num">' + fmt(r.input) + "</td>" +
          '<td class="col-num">' + fmt(r.output) + "</td>" +
          '<td class="col-num">' + fmtParams(r.params_b) + "</td>" +
          '<td class="col-num">' + fmtIndex(r.intelligence_index) + "</td>";
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

  Promise.all([
    fetch(DATA_URL).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    fetch(METADATA_URL)
      .then(function (res) { return res.ok ? res.json() : {}; })
      .catch(function () { return {}; }), // metadata is a bonus - degrade gracefully
  ])
    .then(function (results) {
      var data = results[0];
      var metadata = results[1];
      state.data = data;
      state.rows = flatten(data, metadata);
      var providers = Object.keys(data).sort();

      buildProviderSelect(providers);
      buildAxisSelects();
      wireChartSearch();
      wireChartResetZoom();
      wireTabs();
      wireSorting();
      wireDownload();
      wireCopyButtons();
      render();
    })
    .catch(function (err) {
      els.body.innerHTML =
        '<tr><td colspan="6" class="empty">Could not load ' + DATA_URL + ": " + err.message + "</td></tr>";
    });

  loadNews();
})();
