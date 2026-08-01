(function () {
  "use strict";

  var container = document.getElementById("newsArchive");

  function dayBlock(day, isFirst) {
    var count = day.events.length;
    return (
      '<details class="news-day"' + (isFirst ? " open" : "") + ">" +
      '<summary>' + day.date + " — " + count + " change" + (count === 1 ? "" : "s") + "</summary>" +
      '<ul class="news__list">' + day.events.map(window.LLMP.renderNewsEvent).join("") + "</ul>" +
      "</details>"
    );
  }

  fetch("news/log.jsonl")
    .then(function (res) { return res.ok ? res.text() : ""; })
    .then(function (text) {
      var days = text
        .split("\n")
        .filter(function (l) { return l.trim(); })
        .map(function (l) { return JSON.parse(l); })
        .reverse(); // newest first

      if (!days.length) {
        container.innerHTML = '<p class="empty">No price changes recorded yet.</p>';
        return;
      }

      container.innerHTML = days.map(function (day, i) { return dayBlock(day, i === 0); }).join("");
    })
    .catch(function () {
      container.innerHTML = '<p class="empty">Could not load change history.</p>';
    });
})();
