(function () {
  "use strict";

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  var provider = qs("provider");
  var modelId = qs("model");

  var els = {
    title: document.getElementById("modelTitle"),
    sub: document.getElementById("modelSub"),
    docLink: document.getElementById("modelDocLink"),
    body: document.getElementById("historyBody"),
    canvas: document.getElementById("priceChart"),
  };

  function fmt(n) {
    if (n === 0) return "0.00";
    if (n < 0.01) return n.toFixed(4);
    return n.toFixed(2);
  }

  function fail(message) {
    els.title.textContent = "Model not found";
    els.sub.textContent = message;
    els.body.innerHTML = '<tr><td colspan="3" class="empty">' + message + "</td></tr>";
  }

  function renderTable(entries) {
    var frag = document.createDocumentFragment();
    entries
      .slice()
      .reverse()
      .forEach(function (e) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + e.date + "</td>" +
          '<td class="col-num">' + fmt(e.input) + "</td>" +
          '<td class="col-num">' + fmt(e.output) + "</td>";
        frag.appendChild(tr);
      });
    els.body.innerHTML = "";
    els.body.appendChild(frag);
  }

  function renderChart(entries) {
    // Hold the last known price through to today, so the step line reaches the present.
    var labels = entries.map(function (e) { return e.date; });
    var inputData = entries.map(function (e) { return e.input; });
    var outputData = entries.map(function (e) { return e.output; });

    var todayStr = new Date().toISOString().slice(0, 10);
    if (labels[labels.length - 1] !== todayStr) {
      labels.push(todayStr);
      inputData.push(inputData[inputData.length - 1]);
      outputData.push(outputData[outputData.length - 1]);
    }

    new Chart(els.canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Input $/1M",
            data: inputData,
            stepped: true,
            borderColor: "#0d9488",
            backgroundColor: "#0d9488",
            pointRadius: 3,
          },
          {
            label: "Output $/1M",
            data: outputData,
            stepped: true,
            borderColor: "#f97316",
            backgroundColor: "#f97316",
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "USD / 1M tokens" },
          },
        },
      },
    });
  }

  if (!provider || !modelId) {
    fail("This page needs a provider and model in the URL, e.g. model.html?provider=openai&model=gpt-5.");
    return;
  }

  document.title = modelId + " pricing history — LLM API Pricing";
  els.title.textContent = modelId;
  els.sub.textContent = "Provider: " + provider;

  var docHref = window.LLMP.providerDocHref(provider, modelId);
  if (docHref) {
    els.docLink.href = docHref;
    els.docLink.hidden = false;
  }

  fetch("history/" + encodeURIComponent(provider) + "/index.json")
    .then(function (res) {
      if (!res.ok) throw new Error('No price history recorded for provider "' + provider + '" yet.');
      return res.json();
    })
    .then(function (index) {
      var relPath = index[modelId];
      if (!relPath) throw new Error("No price history recorded for this model yet.");
      return fetch("history/" + encodeURIComponent(provider) + "/" + relPath).then(function (res) {
        if (!res.ok) throw new Error("History file is missing for this model.");
        return res.text();
      });
    })
    .then(function (text) {
      var entries = text
        .split("\n")
        .filter(function (line) { return line.trim(); })
        .map(function (line) { return JSON.parse(line); })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

      if (!entries.length) {
        fail("No price history recorded for this model yet.");
        return;
      }

      renderTable(entries);
      renderChart(entries);
    })
    .catch(function (err) {
      fail(err.message);
    });
})();
