/** Only searches the active article. Wrapping text nodes preserves links and code tokens. */
export function getLongPageSearchScript(): string
{
	return String.raw`var search = (function () {
    var panel = document.getElementById('lp-search-panel');
    var button = document.getElementById('lp-search-toggle');
    var input = document.getElementById('lp-search-input');
    var status = document.getElementById('lp-search-status');
    var previous = document.getElementById('lp-search-previous');
    var next = document.getElementById('lp-search-next');
    var dismiss = document.getElementById('lp-search-close');
    var matches = [], current = -1, timer = null, composing = false;
    function clearMarks() {
      var marks = document.querySelectorAll('mark[data-lp-search]');
      for (var i = 0; i < marks.length; i++) {
        var parent = marks[i].parentNode;
        while (marks[i].firstChild) parent.insertBefore(marks[i].firstChild, marks[i]);
        parent.removeChild(marks[i]);
        parent.normalize();
      }
      matches = []; current = -1;
    }
    function updateStatus() {
      status.textContent = matches.length ? (current + 1) + ' / ' + matches.length :
        (input.value.trim() ? status.getAttribute('data-empty') : status.getAttribute('data-hint'));
      previous.disabled = next.disabled = matches.length === 0;
    }
    function select(index, scroll) {
      if (!matches.length) { updateStatus(); return; }
      if (current >= 0) for (var i = 0; i < matches[current].length; i++) matches[current][i].classList.remove('lp-search-current');
      current = (index + matches.length) % matches.length;
      for (var j = 0; j < matches[current].length; j++) matches[current][j].classList.add('lp-search-current');
      updateStatus();
      if (scroll) {
        try { matches[current][0].scrollIntoView({ block: 'center', inline: 'nearest' }); }
        catch (error) { matches[current][0].scrollIntoView(); }
      }
    }
    function blockFor(element, content) {
      while (element !== content && !/^(P|DIV|LI|H[1-6]|TD|TH|PRE|BLOCKQUOTE|FIGCAPTION)$/.test(element.tagName)) element = element.parentElement;
      return element;
    }
    function refresh(scroll) {
      window.clearTimeout(timer); timer = null;
      clearMarks();
      var query = input.value.trim();
      var content = active.querySelector('.obsidian-document');
      if (panel.hidden || !query || !content) { updateStatus(); return; }
      var walker = document.createTreeWalker(content, 4);
      var records = [], pieces = [], length = 0, lastBlock = null, text;
      while ((text = walker.nextNode())) {
        var parent = text.parentElement;
        if (!text.nodeValue || !parent || parent.closest('script, style, svg, math, textarea, button, select, [hidden]') || !parent.getClientRects().length) continue;
        var block = blockFor(parent, content);
        if (lastBlock && block !== lastBlock) { pieces.push('\n'); length++; }
        records.push({ node: text, start: length, end: length + text.nodeValue.length });
        pieces.push(text.nodeValue); length += text.nodeValue.length; lastBlock = block;
      }
      var allText = pieces.join('');
      var pattern = new RegExp(query.replace(/[{}.*+?^$()|[\]\\]/g, '\\$&'), 'gi');
      var ranges = [], found;
      while ((found = pattern.exec(allText))) { ranges.push({ start: found.index, end: found.index + found[0].length }); matches.push([]); }
      var rangeIndex = 0;
      for (var r = 0; r < records.length; r++) {
        var record = records[r];
        while (rangeIndex < ranges.length && ranges[rangeIndex].end <= record.start) rangeIndex++;
        var cursor = 0, fragment = document.createDocumentFragment(), touched = false;
        for (var m = rangeIndex; m < ranges.length && ranges[m].start < record.end; m++) {
          var start = Math.max(ranges[m].start - record.start, 0), end = Math.min(ranges[m].end - record.start, record.end - record.start);
          if (start >= end) continue;
          fragment.appendChild(document.createTextNode(record.node.nodeValue.slice(cursor, start)));
          var mark = document.createElement('mark');
          mark.className = 'lp-search-match'; mark.setAttribute('data-lp-search', String(m));
          mark.textContent = record.node.nodeValue.slice(start, end);
          fragment.appendChild(mark); matches[m].push(mark); cursor = end; touched = true;
        }
        if (touched) {
          fragment.appendChild(document.createTextNode(record.node.nodeValue.slice(cursor)));
          record.node.parentNode.replaceChild(fragment, record.node);
        }
      }
      select(0, scroll);
    }
    function close(restoreFocus) {
      window.clearTimeout(timer); panel.hidden = true; input.value = ''; clearMarks(); updateStatus();
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus();
    }
    button.addEventListener('click', function () {
      if (!panel.hidden) { close(true); return; }
      if (mobile()) menu(false, false);
      panel.hidden = false; button.setAttribute('aria-expanded', 'true'); input.focus();
    });
    function schedule() {
      status.textContent = '…'; previous.disabled = next.disabled = true;
      window.clearTimeout(timer);
      if (!composing) timer = window.setTimeout(function () { refresh(true); }, 150);
    }
    input.addEventListener('input', schedule);
    input.addEventListener('compositionstart', function () { composing = true; window.clearTimeout(timer); });
    input.addEventListener('compositionend', function () { composing = false; schedule(); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !composing && !event.isComposing) {
        event.preventDefault();
        if (timer) { refresh(true); timer = null; }
        else select(current + (event.shiftKey ? -1 : 1), true);
      }
    });
    previous.addEventListener('click', function () { select(current - 1, true); });
    next.addEventListener('click', function () { select(current + 1, true); });
    dismiss.addEventListener('click', function () { close(true); });
    updateStatus();
    return { refresh: refresh, close: close, isOpen: function () { return !panel.hidden; } };
  })();`;
}
