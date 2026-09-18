/* CEP back-office: fixes for the admin theme (django-unfold 0.107) that cannot be made from settings. The left menu:

   1. It closed itself on every page. unfold/js/app.js calls a window of 1280 px or less a phone and starts each page
      with the menu closed, while its stylesheet calls 1280 px and more a desktop: on a 1280 px window (a 1600 px screen
      at 125 % scaling) the menu is laid out beside the page but closed again by every click on it. Here one media
      query decides, the same one admin.css uses to put the menu beside the page: from 1024 px the menu is part of the
      layout and stays the way the person left it (remembered in localStorage) until they press the menu button. Below
      that it is an overlay on top of the page, so it still closes when a page opens.
   2. The menu button needed two clicks. `sidebarOpen` is declared as a METHOD and toggled with `!this.sidebarOpen`:
      the first click computed `!function` = false. It is a plain boolean here.
   3. Resizing the window re-read the stored state on every pixel; now only when the window crosses the breakpoint.

   Loaded before app.js (UNFOLD["SCRIPTS"]), so it waits for `alpine:init`: app.js has been parsed by then and Alpine
   has not evaluated x-data="theme(...)" yet. */
document.addEventListener('alpine:init', function () {
    var original = window.theme;
    if (typeof original !== 'function') { return; }

    var desktop = window.matchMedia('(min-width: 1024px)');
    function remembered() {
        try { return localStorage.getItem('sidebarOpen') !== '0'; } catch (error) { return true; }
    }
    function remember(open) {
        try { localStorage.setItem('sidebarOpen', open ? '1' : '0'); } catch (error) { /* private mode: the state lasts for the page */ }
    }

    window.theme = function () {
        var data = original.apply(this, arguments);
        if (!data) { return data; }
        var wasDesktop = desktop.matches;
        data.sidebarOpen = desktop.matches ? remembered() : false;
        data.sidebarToggle = function () {
            this.sidebarOpen = !this.sidebarOpen;
            if (desktop.matches) { remember(this.sidebarOpen); }
        };
        if (data.themeBindings) {
            data.themeBindings['x-resize.window'] = function () {
                if (desktop.matches === wasDesktop) { return; }
                wasDesktop = desktop.matches;
                this.sidebarOpen = desktop.matches ? remembered() : false;
            };
        }
        return data;
    };
});
