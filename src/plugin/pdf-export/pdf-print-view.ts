export interface PdfOutlineNode
{
	title: string;
	target: string;
	children: PdfOutlineNode[];
}

export interface PdfPrintLabels
{
	toc: string;
	references: string;
}

export interface PdfPrintView
{
	html: string;
	outline: PdfOutlineNode[];
	pageOrder: string[];
}

/** Make a separate paper view. Never change the shared, interactive HTML. */
export function buildPdfPrintView(html: string, labels: PdfPrintLabels, sourceUrl?: string): PdfPrintView
{
	const doc = new DOMParser().parseFromString(html, "text/html");
	const main = doc.getElementById("lp-content");
	if (!main) throw new Error("Long-page content not found for PDF export");
	const pages = Array.from(main.querySelectorAll<HTMLElement>(":scope > .lp-page"));
	const entry = pages[0];
	const visited = new Set<HTMLElement>();
	const order: string[] = [];
	const body = doc.createDocumentFragment();
	let groupCounter = 0;
	const targetElement = (href: string): HTMLElement | null =>
	{
		if (!href.startsWith("#")) return null;
		let id = href.slice(1);
		try { id = decodeURIComponent(id); } catch { /* keep literal invalid fragments */ }
		return doc.getElementById(id);
	};
	const appendPage = (page: HTMLElement): void =>
	{
		if (visited.has(page)) return;
		visited.add(page);
		order.push(page.id);
		body.appendChild(page);
	};
	// Resolve all targets before moving notes out of the parsed document.
	interface Item { title: string; target: HTMLElement | null; page: HTMLElement | null; children: Item[]; }
	const readList = (list: Element | null): Item[] => list ? Array.from(list.children).map((li) =>
	{
		const row = li.querySelector(":scope > .lp-nav-row, :scope > details > .lp-nav-row");
		const link = row?.querySelector<HTMLAnchorElement>("a.lp-nav-link");
		const target = targetElement(link?.getAttribute("href") ?? "");
		return {
			title: row?.querySelector(".lp-nav-text")?.textContent?.trim() || link?.textContent?.trim() || "",
			target,
			page: target?.closest<HTMLElement>(".lp-page") ?? null,
			children: readList(li.querySelector(":scope > details > .lp-nav-list")),
		};
	}) : [];
	const items = readList(doc.querySelector("#lp-toc > .lp-nav-list"));
	// Entry headings carry both original prose and a place in the directory tree.
	// Move its original section to the group's position rather than print a second
	// synthetic heading. Extract back-to-front so nested heading ranges stay valid.
	const entryGroups = new Map<HTMLElement, HTMLElement>();
	const groupTargets = new Set<HTMLElement>();
	const collectGroups = (items: Item[]): void =>
	{
		for (const item of items)
		{
			if (item.page === entry && item.target !== entry && item.target && /^H[1-6]$/.test(item.target.tagName)) groupTargets.add(item.target);
			collectGroups(item.children);
		}
	};
	collectGroups(items);
	const entryContent = entry?.querySelector<HTMLElement>(".obsidian-document");
	if (entryContent)
	{
		// Even an entry consisting entirely of headings needs a printable anchor.
		entry.style.setProperty("min-height", "1px", "important");
		const originalElements = new Set(Array.from(entryContent.querySelectorAll("*")));
		const targets = Array.from(groupTargets).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
		for (let i = targets.length - 1; i >= 0; i--)
		{
			const range = doc.createRange();
			range.setStartBefore(targets[i]);
			range.setEnd(entryContent, entryContent.childNodes.length);
			const fragment = range.extractContents();
			// Range clones partial ancestors; cloned wrapper IDs must not duplicate
			// anchors still present in the entry introduction.
			fragment.querySelectorAll("[id]").forEach((el) => { if (!originalElements.has(el)) el.removeAttribute("id"); });
			const wrapper = doc.createElement("section");
			wrapper.className = "lp-page lp-pdf-entry-group";
			const content = entryContent.cloneNode(false) as HTMLElement;
			content.removeAttribute("id");
			content.appendChild(fragment);
			wrapper.appendChild(content);
			entryGroups.set(targets[i], wrapper);
		}
	}
	const groupHeading = (title: string, depth: number): HTMLElement =>
	{
		const heading = doc.createElement(`h${Math.min(depth + 1, 6)}`);
		heading.className = "lp-pdf-group";
		heading.id = `lp-pdf-group-${groupCounter++}`;
		heading.textContent = title;
		body.appendChild(heading);
		return heading;
	};
	const walk = (item: Item, depth: number): PdfOutlineNode =>
	{
		let target = item.target;
		// Headings in the entry act as groups for the linked notes beneath them.
		// Leaf heading links still point to the actual original heading.
		if (target && entryGroups.has(target))
		{
			const section = entryGroups.get(target)!;
			// Aliases of the same entry group share its original destination.
			if (!section.parentNode) body.appendChild(section);
		}
		else if (!target || (item.children.length > 0 && item.page === entry && target !== entry))
			target = groupHeading(item.title, depth);
		else if (item.page && !visited.has(item.page)) appendPage(item.page);
		else
		{
			const reference = doc.createElement("p");
			reference.className = "lp-pdf-see-also";
			const link = doc.createElement("a");
			link.href = `#${target.id}`;
			link.textContent = item.title;
			reference.appendChild(link);
			body.appendChild(reference);
		}
		return { title: item.title, target: target.id, children: item.children.map((child) => walk(child, depth + 1)) };
	};
	const outline = items.map((item) => walk(item, 0));
	const unlisted = pages.filter((page) => !visited.has(page));
	if (outline.length && unlisted.length)
	{
		const heading = doc.createElement("h1");
		heading.className = "lp-pdf-references";
		heading.textContent = labels.references;
		body.appendChild(heading);
	}
	for (const page of unlisted) appendPage(page);
	main.replaceChildren(body);

	// A paper TOC uses the very same tree, including non-link group nodes.
	const listFor = (nodes: PdfOutlineNode[]): HTMLUListElement =>
	{
		const list = doc.createElement("ul");
		for (const node of nodes)
		{
			const li = doc.createElement("li");
			const link = doc.createElement("a");
			link.href = `#${node.target}`;
			link.textContent = node.title;
			li.appendChild(link);
			if (node.children.length) li.appendChild(listFor(node.children));
			list.appendChild(li);
		}
		return list;
	};
	if (outline.length)
	{
		const toc = doc.createElement("nav");
		toc.id = "lp-pdf-toc";
		toc.setAttribute("aria-label", labels.toc);
		const title = doc.createElement("h1");
		title.textContent = doc.title;
		const caption = doc.createElement("h2");
		caption.textContent = labels.toc;
		toc.append(title, caption, listFor(outline));
		main.before(toc);
	}
	doc.querySelectorAll("script, meta[http-equiv=refresh], #lp-toc, .lp-floating-button, #lp-search-panel, #lp-backdrop, .lp-back, base").forEach((el) => el.remove());
	doc.querySelectorAll("*").forEach((el) =>
	{
		for (const attribute of Array.from(el.attributes))
			if (/^on/i.test(attribute.name)) el.removeAttribute(attribute.name);
	});
	doc.querySelectorAll("details").forEach((el) => el.setAttribute("open", ""));
	doc.documentElement.classList.remove("lp-js");
	doc.body.classList.remove("lp-nav-open", "lp-nav-closed", "lp-has-toc");
	doc.body.classList.add("lp-pdf");
	const style = doc.createElement("style");
	style.id = "lp-pdf-style";
	style.textContent = `
@page { size: A4; margin: 15mm 14mm 18mm; }
html body.lp-pdf { --lp-width: 100%; --file-line-width: 100%; --font-text-size: calc(10.5pt * var(--export-font-scale, 1)) !important; font-size: var(--font-text-size) !important; background: var(--background-primary, #fff) !important; color: var(--text-normal, #222) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html body.lp-pdf #lp-root, html body.lp-pdf #lp-content { padding: 0 !important; margin: 0 !important; width: auto !important; }
body.lp-pdf #lp-content > .lp-page { display: block !important; page-break-before: auto !important; break-before: auto !important; margin-top: 1.5em; padding-top: 0; border: 0; }
body.lp-pdf #lp-pdf-toc { display: block !important; break-after: page; page-break-after: always; }
body.lp-pdf #lp-pdf-toc h1 { font-size: 22pt; line-height: 1.3; margin: 0 0 1em; }
body.lp-pdf #lp-pdf-toc h2 { font-size: 14pt; }
body.lp-pdf #lp-pdf-toc ul { padding-left: 1.4em; list-style: none; margin: .2em 0; }
body.lp-pdf #lp-pdf-toc > ul { padding-left: 0; }
body.lp-pdf #lp-pdf-toc li { margin: .3em 0; }
body.lp-pdf #lp-pdf-toc a { color: var(--text-normal, #222); text-decoration: none; }
body.lp-pdf .lp-pdf-group { margin: 1.2em 0 .5em; break-after: avoid-page; page-break-after: avoid; break-inside: avoid; }
body.lp-pdf .lp-pdf-references { break-before: page; page-break-before: always; break-after: avoid-page; }
body.lp-pdf .lp-pdf-see-also { font-size: .95em; margin: .4em 0; }
body.lp-pdf .lp-page .lp-table-scroll { overflow: visible !important; }
body.lp-pdf .lp-page pre, body.lp-pdf .lp-page pre code { white-space: pre-wrap !important; overflow-wrap: anywhere; word-break: break-word; }
body.lp-pdf .lp-page img, body.lp-pdf .lp-page svg { max-width: 100% !important; height: auto; }
body.lp-pdf .lp-page tr, body.lp-pdf .lp-page img, body.lp-pdf .lp-page svg { break-inside: avoid; }
body.lp-pdf .lp-page thead { display: table-header-group; }
body.lp-pdf .lp-page h1, body.lp-pdf .lp-page h2, body.lp-pdf .lp-page h3 { break-after: avoid-page; }
`;
	doc.head.appendChild(style);
	if (sourceUrl) doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) =>
	{
		const href = link.getAttribute("href") ?? "";
		if (href && !href.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(href)) link.href = new URL(href, sourceUrl).href;
	});
	return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, outline, pageOrder: order };
}

/** Execute in the isolated print renderer after the page has loaded. */
export const PDF_READY_SCRIPT = String.raw`(async function () {
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map(function (image) {
    if (image.complete) return Promise.resolve();
    image.loading = 'eager';
    return new Promise(function (resolve) { image.onload = image.onerror = resolve; });
  }));
  var svgs = document.querySelectorAll('.obsidian-document svg');
  for (var i = 0; i < svgs.length; i++) {
    var svg = svgs[i];
    if (!svg.getAttribute('viewBox')) {
      var width = parseFloat(svg.getAttribute('width')), height = parseFloat(svg.getAttribute('height'));
      if (width > 0 && height > 0) svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    }
  }
  // Measure using the actual A4 content width rather than the screen viewport.
  var probe = document.createElement('div'); probe.className = 'print';
  probe.style.cssText = 'display:block!important;position:absolute!important;width:182mm!important;height:0!important;overflow:hidden!important'; document.body.appendChild(probe);
  var paperWidth = probe.getBoundingClientRect().width; probe.remove();
  if (!(paperWidth > 0)) throw new Error('Unable to measure the PDF content width');
  document.body.style.setProperty('width', paperWidth + 'px', 'important');
  var tables = document.querySelectorAll('.obsidian-document table');
  for (var j = 0; j < tables.length; j++) {
    var table = tables[j], width = table.scrollWidth;
    if (width > paperWidth) table.style.zoom = String(paperWidth / width);
  }
  await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  return true;
})();`;
