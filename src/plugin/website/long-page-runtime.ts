/** Self-contained ES5: shared files need no network, history API or decoding APIs. */
export function getLongPageScript(): string
{
	return `(function () {
  var root = document.documentElement;
  var pages = document.querySelectorAll('.lp-page');
  var nav = document.getElementById('lp-toc');
  var toggle = document.getElementById('lp-menu');
  var close = document.getElementById('lp-close');
  var backdrop = document.getElementById('lp-backdrop');
  var active = pages[0];
  if (!active) return;
  function mobile() {
    return document.body.classList.contains('lp-mobile') || window.matchMedia('(max-width: 700px)').matches;
  }
  function menu(open, restoreFocus) {
    if (!nav || !toggle) return;
    document.body.classList.toggle('lp-nav-open', open);
    document.body.classList.toggle('lp-nav-closed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open && mobile()) close.focus();
    if (!open && restoreFocus) toggle.focus();
  }
  function targetForHash(hash) {
    var id = hash.substring(1);
    try { id = decodeURIComponent(id); } catch (error) {}
    return document.getElementById(id);
  }
  function pageFor(target) {
    while (target && !target.classList.contains('lp-page')) target = target.parentElement;
    return target;
  }
  function navigate(scroll) {
    var target = targetForHash(window.location.hash);
    if (nav && target === nav) { menu(true, false); target = null; scroll = false; }
    var page = pageFor(target) || active;
    if (!page) return;
    active = page;
    for (var i = 0; i < pages.length; i++) pages[i].classList.toggle('lp-active', pages[i] === page);
    if (nav) {
      var links = nav.querySelectorAll('a[data-page]');
      var selected = null;
      for (var j = 0; j < links.length; j++) {
        links[j].removeAttribute('aria-current');
        links[j].parentElement.classList.remove('lp-current');
        if (!selected && target && targetForHash(links[j].getAttribute('href')) === target) selected = links[j];
      }
      if (!selected) {
        for (var k = 0; k < links.length; k++) {
          if (links[k].getAttribute('data-page') === page.id) { selected = links[k]; break; }
        }
      }
      if (selected) {
        selected.parentElement.classList.add('lp-current');
        selected.setAttribute('aria-current', target && target !== page ? 'location' : 'page');
        var parent = selected.parentElement;
        while (parent && parent !== nav) {
          if (parent.tagName === 'DETAILS') parent.open = true;
          parent = parent.parentElement;
        }
      }
    }
    if (scroll) {
      if (mobile()) menu(false, false);
      var destination = pageFor(target) === page ? target : page;
      destination.setAttribute('tabindex', '-1');
      try { destination.focus({ preventScroll: true }); } catch (error) { destination.focus(); }
      destination.scrollIntoView();
    }
  }
  if (toggle) {
    toggle.addEventListener('click', function (event) {
      event.preventDefault();
      var open = mobile() ? document.body.classList.contains('lp-nav-open') : !document.body.classList.contains('lp-nav-closed');
      menu(!open, false);
    });
    close.addEventListener('click', function () { menu(false, true); });
    backdrop.addEventListener('click', function () { menu(false, true); });
  }
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') menu(false, true);
    if (event.key === 'Tab' && mobile() && document.body.classList.contains('lp-nav-open')) {
      var controls = Array.prototype.filter.call(nav.querySelectorAll('button, a[href], summary'), function (el) { return el.getClientRects().length > 0; });
      var first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var link = event.target;
    while (link && link.tagName !== 'A') link = link.parentElement;
    if (!link || link.hasAttribute('download')) return;
    var hash = link.getAttribute('href') || '';
    if (hash.charAt(0) !== '#') return;
    var target = targetForHash(hash);
    if (nav && target === nav) { event.preventDefault(); menu(true, false); return; }
    if (!pageFor(target)) return;
    event.preventDefault();
    if (window.location.hash === hash) navigate(true);
    else window.location.hash = hash;
  });
  window.addEventListener('hashchange', function () { navigate(true); });
  navigate(false);
  root.classList.add('lp-js');
  if (toggle) toggle.setAttribute('aria-expanded', String(mobile() ? document.body.classList.contains('lp-nav-open') : !document.body.classList.contains('lp-nav-closed')));
  if (window.location.hash && pageFor(targetForHash(window.location.hash))) navigate(true);
})();`;
}
