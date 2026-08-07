// Shared helpers used by index.html, model.html and news.html.
(function () {
  "use strict";

  function fmt(n) {
    if (n === null || n === undefined) return "?";
    if (n === 0) return "0.00";
    if (n < 0.01) return n.toFixed(4);
    return n.toFixed(2);
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function modelHref(provider, model) {
    return "model.html?provider=" + encodeURIComponent(provider) + "&model=" + encodeURIComponent(model);
  }

  // Provider's own documentation page for a specific model, keyed by model id.
  // Anthropic has no per-model docs page, so it returns null.
  function providerDocHref(provider, model) {
    if (provider === "openrouter") return "https://openrouter.ai/" + model;
    if (provider === "openai") return "https://developers.openai.com/api/docs/models/" + model;
    if (provider === "google") return "https://ai.google.dev/gemini-api/docs/models/" + model;
    return null;
  }

  function modelLink(provider, model) {
    return (
      '<a class="model-link" href="' + escapeAttr(modelHref(provider, model)) + '">' +
      escapeHtml(model) +
      "</a>"
    );
  }

  function pctLabel(pct) {
    if (pct === null || pct === undefined) return "";
    var sign = pct > 0 ? "+" : "";
    return " (" + sign + pct + "%)";
  }

  function renderNewsEvent(e) {
    var tag = '<span class="tag">' + escapeHtml(e.provider) + "</span>";

    if (e.type === "price_up" || e.type === "price_down") {
      var cls = e.type === "price_up" ? "news-up" : "news-down";
      var arrow = e.type === "price_up" ? "▲" : "▼";
      return (
        '<li class="news-item ' + cls + '">' +
        '<span class="news-arrow">' + arrow + "</span> " +
        tag + " " + modelLink(e.provider, e.model) +
        ' <span class="news-detail">' + escapeHtml(e.field) + ": $" + fmt(e.old) + " → $" + fmt(e.new) +
        pctLabel(e.pct) + "</span></li>"
      );
    }

    if (e.type === "new") {
      return (
        '<li class="news-item news-new">' +
        '<span class="news-arrow">+</span> NEW ' + tag + " " + modelLink(e.provider, e.model) +
        ' <span class="news-detail">in $' + fmt(e.input) + " / out $" + fmt(e.output) + "</span></li>"
      );
    }

    if (e.type === "removed") {
      return (
        '<li class="news-item news-removed">' +
        '<span class="news-arrow">−</span> REMOVED ' + tag + " " + modelLink(e.provider, e.model) +
        ' <span class="news-detail">was in $' + fmt(e.last_input) + " / out $" + fmt(e.last_output) + "</span></li>"
      );
    }

    return "";
  }

  window.LLMP = {
    fmt: fmt,
    escapeAttr: escapeAttr,
    escapeHtml: escapeHtml,
    modelHref: modelHref,
    modelLink: modelLink,
    providerDocHref: providerDocHref,
    renderNewsEvent: renderNewsEvent,
  };
})();
