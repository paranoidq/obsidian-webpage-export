import { LongPageStyle } from "./export-output-options";
import { escapeCssForHtmlStyleTag } from "../utils/css-html-safe";
import { remapLongPageCss } from "./long-page-styles";
import { getLongPageScript } from "./long-page-runtime";

/** One self-contained file with progressive hash navigation and a script-free fallback. */
export interface LongPageNavigationNode
{
	title: string;
	/** Rendered inline Markdown from the shared file tree. */
	titleHtml?: string;
	iconHtml?: string;
	href?: string;
	children: LongPageNavigationNode[];
}

export interface LongPagePage
{
	/** Export path of the page relative to the export root (as used by link remapping). */
	targetPath: string;
	title: string;
	/** Full rendered HTML of the page as produced by the export pipeline. */
	html: string;
}

export interface LongPageInput
{
	/** Pages in fallback reading order. The first one is the entry. */
	pages: LongPagePage[];
	/** Export-time theme and Style Settings classes; never depend on hydration. */
	bodyClasses?: string;
	/** Only the explicitly supplied tree is shown; exported pages never add nodes. */
	navigation?: LongPageNavigationNode[];
	/** data-media-id -> data URI. */
	mediaRegistry: Record<string, string>;
	/** Raw head markup (inlined <style> blocks etc.). Scripts are stripped. */
	headHtml: string;
	/** Export paths of non-page files (attachments) that links may legitimately point to. */
	attachmentPaths: Iterable<string>;
	style: LongPageStyle;
	title: string;
	tocTitle: string;
	backToTocLabel: string;
	closeNavigationLabel: string;
}

export interface LongPageResult
{
	html: string;
	warnings: string[];
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Schemes that keep working in a shared file. */
const KEEP_SCHEMES = /^(?:https?|mailto|tel|sms|ftp):/i;

function safeDecode(value: string): string
{
	try { return decodeURIComponent(value); }
	catch { return value; }
}

function normalizePath(path: string): string
{
	let result = safeDecode(path.replace(/\\/g, "/"));
	while (result.startsWith("./")) result = result.substring(2);
	return result.replace(/^\/+/, "");
}

function unwrapAnchor(anchor: HTMLElement): void
{
	const span = anchor.ownerDocument.createElement("span");
	span.className = (anchor.className + " lp-dead-link").trim();
	while (anchor.firstChild) span.appendChild(anchor.firstChild);
	anchor.replaceWith(span);
}

interface PreparedPage
{
	index: number;
	title: string;
	targetPath: string;
	content: HTMLElement;
	ids: Map<string, string>;
}

export function buildLongPage(input: LongPageInput): LongPageResult
{
	const warnings: string[] = [];
	const prepared: PreparedPage[] = [];
	let bodyClass = "";

	// ---- pass 1: extract content, inline media, give every id a page-unique name ----
	for (const page of input.pages)
	{
		const parsed = new DOMParser().parseFromString(page.html, "text/html");
		const content = parsed.querySelector<HTMLElement>(".obsidian-document");
		if (!content)
		{
			warnings.push(`Skipped "${page.title}": no document body found`);
			continue;
		}
		if (!bodyClass) bodyClass = parsed.body.className;

		const index = prepared.length;

		content.querySelectorAll("script").forEach((el) => el.remove());
		const unsafe = content.querySelectorAll("iframe, object, embed, canvas");
		if (unsafe.length)
		{
			warnings.push(`"${page.title}": removed ${unsafe.length} embedded element(s) that cannot be shown in a static page`);
			unsafe.forEach((el) => el.remove());
		}

		content.querySelectorAll<HTMLElement>("[data-media-id]").forEach((el) =>
		{
			const id = el.getAttribute("data-media-id") ?? "";
			const uri = input.mediaRegistry[id];
			if (uri) el.setAttribute("src", uri);
			else warnings.push(`"${page.title}": missing inline media "${id}"`);
			el.removeAttribute("data-media-pending-strip");
		});

		// ids inside <svg> are referenced by url(#id) / <use>, so they are left alone.
		const ids = new Map<string, string>();
		let counter = 0;
		[content, ...Array.from(content.querySelectorAll<HTMLElement>("[id]"))].filter((el) => el.id).forEach((el) =>
		{
			if (el.closest("svg")) return;
			const old = el.id;
			const next = `p${index}-${counter++}`;
			if (!ids.has(old)) ids.set(old, next);
			el.id = next;
		});
		for (const attribute of ["for", "aria-labelledby", "aria-describedby", "aria-controls"])
		{
			content.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((el) =>
			{
				const mapped = (el.getAttribute(attribute) ?? "").split(/\s+/).map((id) => ids.get(id) ?? id);
				el.setAttribute(attribute, mapped.join(" "));
			});
		}

		// wide tables scroll inside their own box instead of widening the page
		content.querySelectorAll("table").forEach((table) =>
		{
			// Keep theme selectors such as .el-table > table intact.
			table.parentElement?.classList.add("lp-table-scroll");
		});

		prepared.push({ index, title: page.title, targetPath: page.targetPath, content, ids });
	}

	// ---- pass 2: rewrite links now that every page's ids are known ----
	const pathToIndex = new Map<string, number>();
	for (const page of prepared)
	{
		const key = normalizePath(page.targetPath);
		if (!pathToIndex.has(key)) pathToIndex.set(key, page.index);
	}
	const attachments = new Set<string>();
	for (const path of input.attachmentPaths) attachments.add(normalizePath(path));

	const resolveTarget = (pageIndex: number, hash: string): string | undefined =>
	{
		const ids = prepared[pageIndex].ids;
		const slug = hash.replaceAll(" ", "_").replaceAll(":", "").replaceAll("__", "_");
		return ids.get(hash) ?? ids.get(slug) ?? ids.get(`${slug}_0`);
	};

	for (const page of prepared)
	{
		page.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) =>
		{
			const href = (anchor.getAttribute("href") ?? "").trim();
			if (!href) return;

			if (KEEP_SCHEMES.test(href)) return;
			if (SCHEME.test(href) || href.startsWith("//"))
			{
				// javascript:, obsidian:, app:, file: ... are meaningless in a shared file
				unwrapAnchor(anchor);
				return;
			}

			const hashAt = href.indexOf("#");
			const rawPath = (hashAt < 0 ? href : href.slice(0, hashAt)).split("?")[0];
			const hash = hashAt < 0 ? "" : safeDecode(href.slice(hashAt + 1));

			let targetIndex: number | undefined;
			if (!rawPath) targetIndex = page.index;
			else targetIndex = pathToIndex.get(normalizePath(rawPath));

			if (targetIndex === undefined)
			{
				// Not an exported page. Files that were exported next to the page keep
				// their link; anything else would be a dead link.
				if (rawPath && attachments.has(normalizePath(rawPath))) return;
				unwrapAnchor(anchor);
				return;
			}

			let target: string | undefined;
			if (hash)
			{
				target = resolveTarget(targetIndex, hash);
				if (!target)
				{
					if (!rawPath)
					{
						// e.g. a #tag link: nothing to jump to
						unwrapAnchor(anchor);
						return;
					}
					target = `lp-page-${targetIndex}`;
				}
			}
			else
			{
				target = `lp-page-${targetIndex}`;
			}

			anchor.setAttribute("href", `#${target}`);
			anchor.removeAttribute("target");
		});
	}

	// ---- assemble the document ----
	const doc = document.implementation.createHTMLDocument(input.title);
	doc.head.innerHTML = input.headHtml;
	doc.head.querySelectorAll("script, base, link[rel=preload], link[rel=modulepreload]").forEach((el) => el.remove());
	doc.head.querySelectorAll("style").forEach((style) =>
	{
		style.textContent = escapeCssForHtmlStyleTag(remapLongPageCss(style.textContent ?? ""));
	});
	if (doc.head.querySelector("link[rel=stylesheet]"))
		warnings.push("Some stylesheets are linked instead of inlined, so the page may lose its styling when shared on its own");

	const meta = (attributes: Record<string, string>) =>
	{
		const el = doc.createElement("meta");
		for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
		return el;
	};
	const title = doc.createElement("title");
	title.textContent = input.title;
	doc.head.prepend(
		meta({ charset: "UTF-8" }),
		meta({ name: "viewport", content: "width=device-width, initial-scale=1.0" }),
		meta({ name: "format-detection", content: "telephone=no" }),
		title,
	);
	const style = doc.createElement("style");
	style.id = "long-page-style";
	style.textContent = getLongPageCss(input.style);
	doc.head.appendChild(style);

	const bodyClasses = new Set(`${bodyClass} ${input.bodyClasses ?? ""}`.split(/\s+/).filter(Boolean));
	const snapshotClasses = new Set((input.bodyClasses ?? "").split(/\s+/));
	// The live Obsidian theme wins over any stale classes in cached page HTML.
	if (snapshotClasses.has("theme-dark")) bodyClasses.delete("theme-light");
	else if (snapshotClasses.has("theme-light")) bodyClasses.delete("theme-dark");
	if (!bodyClasses.has("theme-light") && !bodyClasses.has("theme-dark")) bodyClasses.add("theme-light");
	bodyClasses.add("lp-body");
	bodyClasses.add(input.style === LongPageStyle.Mobile ? "lp-mobile" : "lp-desktop");
	doc.body.className = Array.from(bodyClasses).join(" ");

	const root = doc.createElement("div");
	root.id = "lp-root";
	doc.body.appendChild(root);

	// Resolve the shared tree to ordinary fragments so navigation also works without JS.
	interface NavigationItem { node: LongPageNavigationNode; pageIndex?: number; target?: string; children: NavigationItem[]; }
	const convert = (nodes: LongPageNavigationNode[]): NavigationItem[] => nodes.map((node) =>
	{
		const hashAt = node.href?.indexOf("#") ?? -1;
		const path = hashAt < 0 ? node.href : node.href?.slice(0, hashAt);
		const pageIndex = path ? pathToIndex.get(normalizePath(path)) : undefined;
		const hash = hashAt < 0 ? "" : safeDecode(node.href?.slice(hashAt + 1) ?? "");
		const item: NavigationItem = { node, pageIndex, children: [] };
		if (pageIndex !== undefined)
		{
			item.target = (hash && resolveTarget(pageIndex, hash)) || `lp-page-${pageIndex}`;
		}
		item.children = convert(node.children);
		return item;
	});
	const navigation = convert(input.navigation ?? []);
	// The entry tree describes the author's structure. Referenced pages remain
	// embedded and routable, but must never be inferred as directory entries.
	const hasToc = navigation.length > 0 && (prepared.length > 1 || navigation.some((item) => item.children.length > 0));
	const appendLabel = (el: HTMLElement, node: LongPageNavigationNode): void =>
	{
		const label = doc.createElement("span");
		label.className = "lp-nav-text";
		if (node.titleHtml) label.innerHTML = node.titleHtml;
		else label.textContent = node.title;
		if (node.iconHtml)
		{
			const icon = doc.createElement("span");
			icon.className = "lp-nav-icon";
			icon.setAttribute("aria-hidden", "true");
			icon.innerHTML = node.iconHtml;
			el.appendChild(icon);
		}
		el.appendChild(label);
		el.querySelectorAll("script, iframe, object, embed").forEach((child) => child.remove());
		el.querySelectorAll<HTMLElement>("a").forEach((child) => unwrapAnchor(child));
	};
	const renderList = (items: NavigationItem[]): HTMLUListElement =>
	{
		const list = doc.createElement("ul");
		list.className = "lp-nav-list";
		for (const item of items)
		{
			const li = doc.createElement("li");
			const label = doc.createElement(item.target ? "a" : "span");
			label.className = "lp-nav-link";
			appendLabel(label, item.node);
			if (item.target)
			{
				label.setAttribute("href", `#${item.target}`);
				label.setAttribute("data-page", `lp-page-${item.pageIndex}`);
			}
			if (item.children.length)
			{
				const details = doc.createElement("details");
				details.open = true;
				const summary = doc.createElement("summary");
				summary.className = "lp-nav-row";
				const chevron = doc.createElement("span");
				chevron.className = "lp-nav-chevron";
				chevron.setAttribute("aria-hidden", "true");
				chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>';
				summary.append(chevron, label);
				details.append(summary, renderList(item.children));
				li.appendChild(details);
			}
			else
			{
				const row = doc.createElement("div");
				row.className = "lp-nav-row lp-nav-leaf";
				row.appendChild(label);
				li.appendChild(row);
			}
			list.appendChild(li);
		}
		return list;
	};
	if (hasToc)
	{
		doc.body.classList.add("lp-has-toc");
		const nav = doc.createElement("nav");
		nav.id = "lp-toc";
		nav.className = "lp-toc";
		nav.setAttribute("aria-label", input.tocTitle);
		const navTitle = doc.createElement("div");
		navTitle.className = "lp-toc-title";
		navTitle.textContent = input.tocTitle;
		const close = doc.createElement("button");
		close.id = "lp-close";
		close.className = "lp-script-control";
		close.type = "button";
		close.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m5 5 10 10M15 5 5 15"/></svg>';
		close.setAttribute("aria-label", input.closeNavigationLabel);
		navTitle.appendChild(close);
		nav.append(navTitle, renderList(navigation));
		root.appendChild(nav);

		const toggle = doc.createElement("a");
		toggle.id = "lp-menu";
		toggle.href = "#lp-toc";
		toggle.className = "lp-fab";
		toggle.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 5h12M4 10h12M4 15h12"/></svg>';
		const toggleLabel = doc.createElement("span");
		toggleLabel.textContent = input.tocTitle;
		toggle.appendChild(toggleLabel);
		toggle.setAttribute("aria-controls", "lp-toc");
		doc.body.appendChild(toggle);
		const backdrop = doc.createElement("button");
		backdrop.id = "lp-backdrop";
		backdrop.className = "lp-script-control";
		backdrop.type = "button";
		backdrop.setAttribute("aria-label", input.closeNavigationLabel);
		backdrop.tabIndex = -1;
		doc.body.appendChild(backdrop);
	}

	const main = doc.createElement("main");
	main.id = "lp-content";
	root.appendChild(main);
	for (const page of prepared)
	{
		const section = doc.createElement("section");
		section.className = "lp-page leaf";
		section.id = `lp-page-${page.index}`;
		section.setAttribute("aria-label", page.title);
		section.appendChild(doc.importNode(page.content, true));
		if (hasToc)
		{
			const back = doc.createElement("a");
			back.className = "lp-back";
			back.href = "#lp-toc";
			back.textContent = `↑ ${input.backToTocLabel}`;
			section.appendChild(back);
		}
		main.appendChild(section);
	}
	const script = doc.createElement("script");
	script.textContent = getLongPageScript();
	doc.body.appendChild(script);

	return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, warnings };
}

/**
 * Layout for the long page. It is appended after the theme/plugin CSS and first
 * undoes the interactive shell (which pins html/body to the viewport and makes an
 * inner pane the scroller) before applying the mobile or desktop presentation.
 *
 * Deliberately avoids :is(), :has(), nesting and other recent selectors so that
 * older in-app web views still apply every rule.
 */
export function getLongPageCss(style: LongPageStyle): string
{
	const common = `
/* ---- undo the app-shell layout ---- */
html:root { background-color: transparent; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; contain: none !important; }
html:root body.lp-body { display: block !important; position: static !important; width: auto !important; max-width: none !important; height: auto !important; min-height: 100vh; max-height: none !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; contain: none !important; background-color: var(--background-primary, #ffffff); color: var(--text-normal, #222222); }
body.lp-body #lp-root { display: block !important; position: static !important; box-sizing: border-box; width: 100%; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; contain: none !important; margin: 0 auto; }
body.lp-body .lp-page { display: block; box-sizing: border-box; width: 100%; max-width: 100%; position: static !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; contain: none !important; flex: none !important; }
body.lp-body .lp-page .obsidian-document,
body.lp-body .lp-page .markdown-preview-view,
body.lp-body .lp-page .markdown-preview-sizer,
body.lp-body .lp-page .markdown-preview-section { display: block !important; position: static !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; contain: none !important; flex: none !important; transition: none !important; }
body.lp-body .lp-page .obsidian-document,
body.lp-body .lp-page .markdown-preview-view { width: auto !important; margin: 0 !important; padding: 0 !important; }
body.lp-body .lp-page .markdown-preview-sizer { box-sizing: border-box; width: 100% !important; max-width: var(--lp-width) !important; margin-left: auto !important; margin-right: auto !important; padding: 0 !important; }
body.lp-body .lp-page [id] { scroll-margin-top: 12px; }

/* ---- controls that need scripts are meaningless here ---- */
body.lp-body .lp-page .copy-code-button,
body.lp-body .lp-page .heading-collapse-indicator,
body.lp-body .lp-page .collapse-indicator,
body.lp-body .lp-page .list-collapse-indicator,
body.lp-body .lp-page .sidebar { display: none !important; }
/* with no way to unfold, show everything that was collapsed */
body.lp-body .lp-page .is-collapsed > .callout-content,
body.lp-body .lp-page .is-collapsed > .heading-children,
body.lp-body .lp-page .is-collapsed > ul,
body.lp-body .lp-page .is-collapsed > ol,
body.lp-body .lp-page .is-collapsed > pre { display: block !important; height: auto !important; max-height: none !important; overflow: visible !important; }
body.lp-body .lp-page span.lp-dead-link { color: inherit; text-decoration: none; cursor: text; }

/* ---- content that must not widen the page ---- */
body.lp-body .lp-page img, body.lp-body .lp-page video { max-width: 100% !important; height: auto !important; }
body.lp-body .lp-page svg, body.lp-body .lp-page canvas { max-width: 100%; }
body.lp-body .lp-page .lp-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
body.lp-body .lp-page pre { max-width: 100%; box-sizing: border-box; overflow-x: auto; -webkit-overflow-scrolling: touch; }
body.lp-body .lp-page p, body.lp-body .lp-page li, body.lp-body .lp-page td, body.lp-body .lp-page th, body.lp-body .lp-page blockquote { overflow-wrap: break-word; }

/* ---- contents ---- */
body.lp-body .lp-page + .lp-page { margin-top: 2.5em; padding-top: 2em; border-top: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.3)); }
body.lp-body .lp-back { display: block; box-sizing: border-box; max-width: var(--lp-width); margin: 2em auto 0; text-align: right; font-size: 0.85em; color: var(--text-muted, #888888); text-decoration: none; }

@media print {
	body.lp-body .lp-fab { display: none !important; }
	body.lp-body .lp-back { display: none !important; }
	body.lp-body .lp-page + .lp-page { margin-top: 0; padding-top: 0; border-top: 0; page-break-before: always; break-before: page; }
	body.lp-body .lp-toc { page-break-after: always; break-after: page; }
}
`;

	const desktop = `
/* ---- desktop presentation ---- */
body.lp-desktop { --lp-width: var(--file-line-width, 46rem); }
body.lp-desktop #lp-root { padding: 40px 24px 96px; }
`;

	const mobile = `
/* ---- mobile presentation ---- */
html:root body.lp-mobile { --lp-width: 100%; --file-line-width: 100%; --line-width: 100%; --line-width-adaptive: 100%; --line-height-normal: 1.75; --h1-size: 1.7em; --h2-size: 1.45em; --h3-size: 1.25em; --h4-size: 1.1em; }
body.lp-mobile #lp-root { padding: 14px 14px 72px; padding-left: max(14px, env(safe-area-inset-left)); padding-right: max(14px, env(safe-area-inset-right)); }
body.lp-mobile .lp-page pre, body.lp-mobile .lp-page pre code { white-space: pre-wrap !important; overflow-wrap: anywhere; word-break: break-word; }
body.lp-mobile .lp-page + .lp-page { margin-top: 2em; padding-top: 1.5em; }
`;

	return common + (style === LongPageStyle.Mobile ? mobile : desktop) + getNavigationCss();
}

/** Defaults stay readable until the router has initialized successfully. */
function getNavigationCss(): string
{
	return `
body.lp-body #lp-content { display: block !important; position: static !important; width: auto !important; min-width: 0; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; contain: none !important; }
body.lp-body .lp-script-control { display: none; }
/* Keep navigation independent from the exported Markdown theme's typography. */
body.lp-body #lp-toc { --lp-nav-accent: var(--text-accent, #6550b9); --lp-nav-active-bg: rgba(117,98,206,.12); box-sizing: border-box; max-width: var(--lp-width); margin: 0 auto 2em; padding: 0; border: 1px solid var(--background-modifier-border, #e5e7eb); border-radius: 14px; background: var(--background-secondary, #f8f9fb); color: var(--text-normal, #343641); font-family: var(--font-interface, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); font-size: 14px; font-weight: 400; line-height: 1.5; text-align: left; letter-spacing: normal; }
body.lp-body #lp-toc .lp-toc-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; box-sizing: border-box; min-height: 68px; margin: 0; padding: 16px 20px; border-bottom: 1px solid var(--background-modifier-border, #e5e7eb); color: var(--text-normal, #343641); font-size: 15px; font-weight: 650; line-height: 24px; letter-spacing: .02em; }
body.lp-body #lp-toc ul.lp-nav-list { display: block; box-sizing: border-box; margin: 0; padding: 12px; list-style: none; }
body.lp-body #lp-toc .lp-nav-list .lp-nav-list { margin: 2px 0 4px 19px; padding: 0 0 0 10px; border-left: 1px solid var(--background-modifier-border, #e5e7eb); }
body.lp-body #lp-toc .lp-nav-list > li { display: block; margin: 0; padding: 0; list-style: none; }
body.lp-body #lp-toc .lp-nav-list > li + li { margin-top: 4px; }
body.lp-body #lp-toc details { display: block; margin: 0; padding: 0; }
body.lp-body #lp-toc .lp-nav-row { display: flex; position: relative; box-sizing: border-box; align-items: center; gap: 6px; min-height: 40px; margin: 0; padding: 0 10px; border: 0; border-radius: 8px; color: inherit; background: transparent; box-shadow: none; list-style: none; transition: background-color 140ms ease, color 140ms ease; }
body.lp-body #lp-toc summary.lp-nav-row { cursor: pointer; font-weight: 500; }
body.lp-body #lp-toc summary.lp-nav-row::marker { content: ""; }
body.lp-body #lp-toc summary.lp-nav-row::-webkit-details-marker { display: none; }
body.lp-body #lp-toc .lp-nav-leaf { padding-left: 32px; }
body.lp-body #lp-toc .lp-nav-link { display: flex; flex: 1 1 0; align-items: center; gap: 8px; box-sizing: border-box; min-width: 0; min-height: 40px; margin: 0; padding: 9px 0; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; line-height: 22px; text-align: left; text-decoration: none; box-shadow: none; transform: none; }
body.lp-body #lp-toc .lp-nav-text { text-align: left; display: block; min-width: 0; margin: 0; padding: 0; white-space: normal; overflow-wrap: anywhere; word-break: normal; }
body.lp-body #lp-toc .lp-nav-text * { margin: 0; padding: 0; color: inherit; font-size: inherit; line-height: inherit; letter-spacing: inherit; }
body.lp-body #lp-toc .lp-nav-chevron { display: flex; flex: 0 0 16px; align-items: center; justify-content: center; width: 16px; height: 22px; color: var(--text-faint, #989ca8); }
body.lp-body #lp-toc .lp-nav-chevron svg { display: block; width: 16px; height: 16px; transition: transform 140ms ease; }
body.lp-body #lp-toc details[open] > summary > .lp-nav-chevron svg { transform: rotate(90deg); }
body.lp-body #lp-toc .lp-nav-icon { display: flex; flex: 0 0 18px; align-items: center; justify-content: center; width: 18px; margin: 0; color: var(--text-muted, #737987); }
body.lp-body #lp-toc .lp-nav-icon svg, body.lp-body #lp-toc .lp-nav-icon img { display: block; width: 18px; height: 18px; }
body.lp-body #lp-toc .lp-nav-row.lp-current { background: var(--lp-nav-active-bg); color: var(--lp-nav-accent); font-weight: 500; }
body.lp-body #lp-toc .lp-nav-row.lp-current::before { content: ""; position: absolute; top: 10px; bottom: 10px; left: 0; width: 3px; border-radius: 3px; background: var(--lp-nav-accent); }
body.lp-body #lp-toc .lp-nav-row.lp-current .lp-nav-icon, body.lp-body #lp-toc .lp-nav-row.lp-current .lp-nav-chevron { color: inherit; }
body.lp-body #lp-toc .lp-nav-row:focus, body.lp-body #lp-toc a.lp-nav-link:focus { outline: 2px solid var(--lp-nav-accent); outline-offset: -2px; }
body.lp-body #lp-toc #lp-close { align-items: center; justify-content: center; flex: 0 0 32px; width: 32px; height: 32px; min-width: 32px; min-height: 32px; margin: 0; padding: 6px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted, #737987); box-shadow: none; cursor: pointer; }
body.lp-body #lp-toc #lp-close svg { display: block; width: 20px; height: 20px; }
body.lp-body #lp-menu { display: inline-flex; align-items: center; justify-content: center; gap: 8px; position: fixed; left: 18px; bottom: 18px; z-index: 99; box-sizing: border-box; width: max-content; max-width: calc(100% - 36px); min-height: 44px; padding: 10px 16px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: var(--interactive-accent, #7562ce); color: var(--text-on-accent, #fff); font-size: 14px; font-weight: 600; line-height: 22px; text-decoration: none; box-shadow: 0 4px 16px rgba(0,0,0,.16); }
body.lp-body #lp-menu svg { display: block; flex: 0 0 18px; width: 18px; height: 18px; }
body.lp-mobile #lp-menu { left: auto; right: 18px; bottom: calc(18px + env(safe-area-inset-bottom)); }
@media (hover: hover) {
 body.lp-body #lp-toc .lp-nav-row:hover { background: var(--background-modifier-hover, rgba(128,128,128,.07)); }
 body.lp-body #lp-toc .lp-nav-row.lp-current:hover { background: var(--lp-nav-active-bg); }
 body.lp-body #lp-toc #lp-close:hover { background: var(--background-modifier-hover, rgba(128,128,128,.07)); color: var(--text-normal, #343641); }
}
@media (prefers-reduced-motion: reduce) {
 body.lp-body #lp-toc .lp-nav-row, body.lp-body #lp-toc .lp-nav-chevron svg { transition: none; }
}
html.lp-js body.lp-body .lp-page { display: none; }
html.lp-js body.lp-body .lp-page.lp-active { display: block; margin-top: 0; padding-top: 0; border-top: 0; }
html.lp-js body.lp-body .lp-script-control { display: block; }
html.lp-js body.lp-body #lp-toc { position: fixed; top: 0; bottom: 0; left: 0; width: 304px; max-width: 88vw; margin: 0; padding: 0 0 24px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; border: 0; border-right: 1px solid var(--background-modifier-border, #e5e7eb); border-radius: 0; z-index: 101; scrollbar-width: thin; }
html.lp-js body.lp-body #lp-toc .lp-toc-title { position: sticky; top: 0; z-index: 2; background: var(--background-secondary, #f8f9fb); }
html.lp-js body.lp-body #lp-toc #lp-close { display: flex; }
html.lp-js body.lp-body #lp-backdrop { display: none; }
html.lp-js body.lp-desktop.lp-has-toc #lp-content { margin-left: 304px; }
html.lp-js body.lp-desktop.lp-nav-closed #lp-toc { display: none; }
html.lp-js body.lp-desktop.lp-nav-closed #lp-content { margin-left: 0; }
html.lp-js body.lp-mobile #lp-toc { display: none; width: 344px; border-radius: 0 16px 16px 0; box-shadow: 12px 0 40px rgba(0,0,0,.12); font-size: 15px; }
body.lp-mobile #lp-toc .lp-nav-row, body.lp-mobile #lp-toc .lp-nav-link { min-height: 44px; }
body.lp-mobile #lp-toc .lp-nav-link { padding-top: 11px; padding-bottom: 11px; }
body.lp-mobile #lp-toc #lp-close { flex-basis: 40px; width: 40px; height: 40px; min-height: 40px; }
html.lp-js body.lp-mobile.lp-nav-open #lp-toc { display: block; }
html.lp-js body.lp-mobile.lp-nav-open #lp-menu { visibility: hidden; }
html.lp-js body.lp-mobile.lp-nav-open #lp-backdrop { display: block; position: fixed; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: rgba(0,0,0,.28); z-index: 100; }
html.lp-js body.lp-mobile.lp-nav-open { overflow: hidden !important; }
@media screen and (max-width: 700px) {
 html.lp-js body.lp-desktop.lp-has-toc #lp-content { margin-left: 0; }
 html.lp-js body.lp-desktop #lp-toc { display: none; width: 344px; border-radius: 0 16px 16px 0; box-shadow: 12px 0 40px rgba(0,0,0,.12); }
 html.lp-js body.lp-desktop.lp-nav-open #lp-toc { display: block; }
 html.lp-js body.lp-desktop.lp-nav-open #lp-menu { visibility: hidden; }
 html.lp-js body.lp-desktop.lp-nav-open #lp-backdrop { display: block; position: fixed; top: 0; right: 0; bottom: 0; left: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; background: rgba(0,0,0,.28); z-index: 100; }
 html.lp-js body.lp-desktop.lp-nav-open { overflow: hidden !important; }
}
@media print {
 body.lp-body #lp-root { display: block !important; }
 html.lp-js body.lp-body .lp-page { display: block; }
 html.lp-js body.lp-body #lp-toc { display: block !important; position: static; width: auto; max-width: none; padding: 0; overflow: visible; border-radius: 0; box-shadow: none; }
 html.lp-js body.lp-body #lp-toc .lp-toc-title { position: static; }
 html.lp-js body.lp-body #lp-content { margin-left: 0 !important; }
 body.lp-body #lp-menu, html.lp-js body.lp-body .lp-script-control { display: none !important; }
 body.lp-body #lp-toc details > ul { display: block !important; }
}
`;
}
