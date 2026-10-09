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

/* The list search box. Django's admin searches only when Enter is pressed, and nothing on the page says so, so typing
   looked as though it did nothing. Here the list follows the typing: 350 ms after the last keystroke the form is sent
   (Enter still works as before), and once the page is back the box keeps the focus with the caret at the end, so the
   typing can go on. A single letter is not sent on its own — it matches too much — it waits for a second one or Enter.
   The sidebar's "Search apps and models" is Unfold's own and is not touched. */
document.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('searchbar');
    var form = box && box.closest('form');
    if (!box || !form) { return; }
    var sent = box.value.trim();
    var timer = null;
    box.addEventListener('input', function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
            var value = box.value.trim();
            if (value === sent || value.length === 1) { return; }
            sent = value;
            if (typeof form.requestSubmit === 'function') { form.requestSubmit(); } else { form.submit(); }
        }, 350);
    });
    function keepTyping() {
        if (!new URLSearchParams(window.location.search).has('q') || document.activeElement === box) { return; }
        box.focus();
        var end = box.value.length;
        box.setSelectionRange(end, end);
    }
    keepTyping();
    window.addEventListener('load', keepTyping);          // the theme's own start-up may have moved the focus since
});

/* The legal line at the foot of every page: the year, the holder and the terms address come from templates/admin/base.html
   (the Legal global parameters); Unfold's list and form pages own the footer block, so the line is placed here instead. */
document.addEventListener('DOMContentLoaded', function () {
  var legal = document.getElementById('cep-legal')
  var main = document.getElementById('main')
  if (!legal || !main || document.querySelector('.cep-footer')) return
  var footer = document.createElement('footer')
  footer.className = 'cep-footer'
  footer.setAttribute('aria-label', 'Legal')
  var line = document.createElement('span')
  line.textContent = '\u00A9 ' + legal.dataset.year + ' ' + legal.dataset.holder
  var terms = document.createElement('a')
  terms.href = legal.dataset.terms
  terms.target = '_blank'
  terms.rel = 'noreferrer'
  terms.textContent = 'Terms of use'
  footer.appendChild(line)
  footer.appendChild(terms)
  main.appendChild(footer)
})
