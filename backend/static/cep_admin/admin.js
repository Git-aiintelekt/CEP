/* CEP back-office: fixes for the admin theme (django-unfold) that cannot be made from settings.

   1. The menu button needs two clicks (unfold 0.107). theme() in unfold/js/app.js declares `sidebarOpen` as a METHOD that
      reads the stored state, and sidebarToggle() then computes `!this.sidebarOpen`. On the first click that is
      `!function` = false: a collapsed menu stays collapsed and nothing seems to happen. Here the method is resolved
      to its boolean once, before Alpine builds the page, so the first click toggles. Harmless once fixed upstream:
      the guard only acts while `sidebarOpen` is a function.

   This file is loaded before app.js (UNFOLD["SCRIPTS"]), so it waits for `alpine:init`: app.js has been parsed by then and
   Alpine has not evaluated x-data="theme(...)" yet. */
document.addEventListener('alpine:init', function () {
    var original = window.theme;
    if (typeof original !== 'function') { return; }
    window.theme = function () {
        var data = original.apply(this, arguments);
        if (data && typeof data.sidebarOpen === 'function') { data.sidebarOpen = Boolean(data.sidebarOpen()); }
        return data;
    };
});
