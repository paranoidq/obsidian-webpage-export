import { MarkdownRendererOptions } from "./api-options";
import { Component, Notice, WorkspaceLeaf, MarkdownRenderer as ObsidianRenderer, MarkdownPreviewView, loadMermaid, TFile, MarkdownView, View, MarkdownPreviewRenderer, TAbstractFile, TFolder, Setting } from "obsidian";
import { TabManager } from "src/plugin/utils/tab-manager";
import * as electron from 'electron';
import { Settings, SettingsPage } from "src/plugin/settings/settings";
import { Path } from "src/plugin/utils/path";
import { SimpleFileListGenerator } from "src/plugin/features/simple-list-generator";
import { DataviewRenderer } from "./dataview-renderer";
import { Utils } from "../utils/utils";
import { AssetLoader } from "../asset-loaders/base-asset";
import { AssetType } from "../asset-loaders/asset-types";
import { IconHandler } from "../utils/icon-handler";
import { AssetHandler } from "../asset-loaders/asset-handler";

export namespace MarkdownRendererAPI {
	export const viewableMediaExtensions = ["png", "jpg", "jpeg", "svg", "gif", "bmp", "ico", "mp4", "mov", "avi", "webm", "mpeg", "mp3", "wav", "ogg", "aac", "pdf", "html", "htm", "json", "txt", "yaml"];
	export const convertableExtensions = ["md", "canvas", "base", "drawing", "excalidraw", ...viewableMediaExtensions]; // drawing is an alias for excalidraw

	export function extentionToTag(extention: string) {
		if (["png", "jpg", "jpeg", "svg", "gif", "bmp", "ico"].includes(extention)) return "img";
		else if (["mp4", "mov", "avi", "webm", "mpeg"].includes(extention)) return "video";
		else if (["mp3", "wav", "ogg", "aac"].includes(extention)) return "audio";
		else if (["pdf"].includes(extention)) return "embed";
		else return "iframe";
	}

	export async function renderMarkdownToString(markdown: string, options?: MarkdownRendererOptions): Promise<string | undefined> {
		options = Object.assign(new MarkdownRendererOptions(), options);
		const html = await _MarkdownRendererInternal.renderMarkdown(markdown, options);
		if (!html) return;
		if (options.postProcess) await _MarkdownRendererInternal.postProcessHTML(html, options);
		const text = html.innerHTML;
		if (!options.container) html.remove();
		return text;
	}

	export async function renderMarkdownToElement(markdown: string, options?: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		options = Object.assign(new MarkdownRendererOptions(), options);
		const html = await _MarkdownRendererInternal.renderMarkdown(markdown, options);
		if (!html) return;
		if (options.postProcess) await _MarkdownRendererInternal.postProcessHTML(html, options);
		return html;
	}

	export async function renderFile(file: TFile, options?: MarkdownRendererOptions): Promise<{ contentEl: HTMLElement; viewType: string; } | undefined> {
		options = Object.assign(new MarkdownRendererOptions(), options);
		const result = await _MarkdownRendererInternal.renderFile(file, options);
		if (!result) return;
		if (options.postProcess) {
			ExportLog.log("Post-processing rendered HTML...");
			const startedAt = Date.now();
			await _MarkdownRendererInternal.postProcessHTML(result.contentEl, options);
			ExportLog.log(`Post-process finished in ${Date.now() - startedAt}ms`);
		}
		return result;
	}

	export async function renderFileToString(file: TFile, options?: MarkdownRendererOptions): Promise<string | undefined> {
		options = Object.assign(new MarkdownRendererOptions(), options);
		const result = await this.renderFile(file, options);
		if (!result) return;
		const text = result.contentEl.innerHTML;
		if (!options.container) result.contentEl.remove();
		return text;
	}

	export async function renderFilePathToString(filePath: string, options?: MarkdownRendererOptions): Promise<string | undefined> {
		const file = app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) return;
		return await this.renderFileToString(file, options);
	}

	export async function renderMarkdownSimple(markdown: string): Promise<string | undefined> {
		const container = document.body.createDiv();
		await _MarkdownRendererInternal.renderSimpleMarkdown(markdown, container);
		const text = container.innerHTML;
		container.remove();
		return text;
	}

	export async function renderMarkdownSimpleEl(markdown: string, container: HTMLElement) {
		await _MarkdownRendererInternal.renderSimpleMarkdown(markdown, container);
	}

	export function isConvertable(extention: string) {
		if (extention.startsWith(".")) extention = extention.substring(1);
		return this.convertableExtensions.contains(extention);
	}

	export function isExcalidrawFile(file: TFile): boolean {
		return _MarkdownRendererInternal.isExcalidrawFile(file);
	}

	export function checkCancelled(): boolean {
		return _MarkdownRendererInternal.checkCancelled();
	}

	export async function beginBatch(options?: MarkdownRendererOptions) {
		options = Object.assign(new MarkdownRendererOptions(), options);
		await _MarkdownRendererInternal.beginBatch(options);
	}

	export function endBatch() {
		_MarkdownRendererInternal.endBatch();
		ExportLog.resetProgress();
	}

}

export namespace _MarkdownRendererInternal {
	export let overlayProgress: boolean = true;
	export let renderLeaf: WorkspaceLeaf | undefined;
	export let electronWindow: electron.BrowserWindow | undefined;
	export let errorInBatch: boolean = false;
	export let cancelled: boolean = false;
	export let batchStarted: boolean = false;
	let logContainer: HTMLElement | undefined;
	let loadingContainer: HTMLElement | undefined;
	let fileListContainer: HTMLElement | undefined;

	export const batchDocument = document.implementation.createHTMLDocument();
	let markdownView: MarkdownView | undefined;

	const infoColor = "var(--text-normal)";
	const warningColor = "var(--color-yellow)";
	const errorColor = "var(--color-red)";
	const infoBoxColor = "rgba(0,0,0,0.15)"
	const warningBoxColor = "rgba(var(--color-yellow-rgb), 0.15)";
	const errorBoxColor = "rgba(var(--color-red-rgb), 0.15)";
	export const arrowHTML = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='svg-icon right-triangle'><path d='M3 8L12 17L21 8'></path></svg>";

	export function checkCancelled(): boolean {
		if (_MarkdownRendererInternal.cancelled || !_MarkdownRendererInternal.renderLeaf) {
			ExportLog.log("cancelled");
			_MarkdownRendererInternal.endBatch();
			return true;
		}

		return false;
	}

	async function delay(ms: number) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async function waitUntil(condition: () => boolean, timeout: number = 1000, interval: number = 100): Promise<boolean> {
		if (condition()) return true;

		const startedAt = Date.now();
		return new Promise((resolve) => {
			const intervalId = setInterval(() => {
				if (condition()) {
					clearInterval(intervalId);
					resolve(true);
				} else if (Date.now() - startedAt >= timeout) {
					clearInterval(intervalId);
					resolve(false);
				}
			}, interval);
		});
	}

	async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T | undefined> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<undefined>((resolve) => {
					timer = setTimeout(() => {
						ExportLog.warning(`Timed out after ${timeoutMs}ms: ${label}`);
						resolve(undefined);
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	function unfoldHiddenPreviewContainers(root: HTMLElement): HTMLElement[]
	{
		const unfolded: HTMLElement[] = [];

		root.querySelectorAll(".callout-content, .admonition-content").forEach((element) =>
		{
			const el = element as HTMLElement;
			const computed = window.getComputedStyle(el);
			if (el.style.display === "none" || computed.display === "none")
			{
				el.style.display = "";
				unfolded.push(el);
			}
			if (computed.maxHeight === "0px" || el.style.maxHeight === "0")
			{
				el.style.maxHeight = "";
				el.style.overflow = "";
			}
		});

		root.querySelectorAll(".admonition.is-collapsed, .admonition-folded, .admonition[data-collapsed='true']").forEach((element) =>
		{
			element.classList.remove("is-collapsed", "admonition-folded");
			element.removeAttribute("data-collapsed");
		});

		return unfolded;
	}

	const EXCALIDRAW_FALLBACK_MARKER = "Switch to EXCALIDRAW VIEW";
	const EXCALIDRAW_CREATE_SVG_TIMEOUT_MS = 8000;
	const EXCALIDRAW_CREATE_PNG_TIMEOUT_MS = 20000;
	const excalidrawSvgCache = new Map<string, HTMLElement>();
	const excalidrawSvgInflight = new Map<string, Promise<HTMLElement | undefined>>();
	/** embedPath -> { hostNotePath, line0 } for markdown-context placement */
	const excalidrawEmbedLocations = new Map<string, { hostPath: string; line0: number }>();

	export function isExcalidrawFile(file: TFile): boolean
	{
		if (file.extension === "excalidraw" || file.extension === "drawing" || file.path.endsWith(".excalidraw.md")) return true;
		return app.metadataCache.getFileCache(file)?.frontmatter?.["excalidraw-plugin"] != undefined;
	}

	function resolveEmbedTarget(link: string | undefined, sourcePath: string): TFile | undefined
	{
		if (!link) return;

		let linkPath = link;
		if (linkPath.startsWith("app://"))
		{
			try
			{
				// @ts-ignore
				linkPath = app.vault.resolveFileUrl(linkPath)?.path ?? "";
			}
			catch
			{
				linkPath = linkPath.replace(/^app:\/\/[^/]+\//, "");
			}
		}

		linkPath = decodeURIComponent(linkPath)
			.split("#")[0]
			.split("?")[0]
			.split("|")[0]
			.trim();

		const target = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
		return target instanceof TFile ? target : undefined;
	}

	function getFallbackEmbedFile(element: HTMLElement, sourceFile: TFile): TFile | undefined
	{
		const embed = element.closest(".internal-embed") as HTMLElement | null;
		const markdownEmbed = element.closest(".markdown-embed") as HTMLElement | null;
		const links = [
			embed?.getAttribute("src"),
			markdownEmbed?.querySelector(".markdown-embed-link")?.getAttribute("href"),
			markdownEmbed?.querySelector(".markdown-embed-link")?.getAttribute("data-href"),
			markdownEmbed?.querySelector(".markdown-embed-title")?.textContent,
		];

		for (const link of links)
		{
			const file = resolveEmbedTarget(link ?? undefined, sourceFile.path);
			if (file && isExcalidrawFile(file)) return file;
		}

		return undefined;
	}

	function embedHasRenderedExcalidraw(element: HTMLElement): boolean
	{
		if (element.querySelector(".excalidraw-svg, .excalidraw-plugin")) return true;
		// Raw drawing notes include this marker until Excalidraw replaces the embed.
		if ((element.textContent ?? "").includes(EXCALIDRAW_FALLBACK_MARKER)) return false;
		if (element.querySelector("pre > code, .language-compressed-json")) return false;
		if (element.querySelector("img[src], svg")) return true;
		return false;
	}

	function isLikelyExcalidrawEmbed(element: HTMLElement): boolean
	{
		if ((element.textContent ?? "").includes(EXCALIDRAW_FALLBACK_MARKER)) return true;
		if (embedHasRenderedExcalidraw(element)) return true;
		const src = element.getAttribute("src") ?? "";
		if (src.includes(".excalidraw") || src.endsWith(".drawing")) return true;
		const title = element.querySelector(".markdown-embed-title")?.textContent ?? "";
		if (title.includes(".excalidraw") || title.endsWith(".drawing")) return true;
		return false;
	}

	function hasPendingGenericPluginBlocks(root: HTMLElement): boolean
	{
		const empties = Array.from(root.querySelectorAll("[class^='block-language-']:empty")) as HTMLElement[];
		return empties.some((element) => {
			const embed = element.closest(".internal-embed, .markdown-embed") as HTMLElement | null;
			if (embed && isLikelyExcalidrawEmbed(embed)) return false;
			return true;
		});
	}

	function escapeAttrSelectorValue(value: string): string
	{
		return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	function rememberExcalidrawEmbedLocations(sourceFile: TFile): void
	{
		const cache = app.metadataCache.getFileCache(sourceFile);
		for (const embed of cache?.embeds ?? [])
		{
			const target = app.metadataCache.getFirstLinkpathDest(embed.link, sourceFile.path);
			if (!(target instanceof TFile) || !isExcalidrawFile(target)) continue;
			const line0 = embed.position?.start?.line;
			if (line0 == null) continue;
			excalidrawEmbedLocations.set(target.path, { hostPath: sourceFile.path, line0 });
		}
	}

	function markExcalidrawEmbedSections(
		sections: { lineStart: number; lineEnd: number; el: HTMLElement }[],
		sourceFile: TFile
	): void
	{
		rememberExcalidrawEmbedLocations(sourceFile);
		const cache = app.metadataCache.getFileCache(sourceFile);

		// Diagnostic: preview section line ranges often don't match metadata lines.
		if (sections.length > 0)
		{
			const sample = sections.slice(0, 3).map((s) => `${s.lineStart}-${s.lineEnd}`).join(", ");
			const last = sections[sections.length - 1];
			ExportLog.log(`Preview section line sample: [${sample}, …, ${last.lineStart}-${last.lineEnd}] (n=${sections.length})`);
		}

		for (const embed of cache?.embeds ?? [])
		{
			const target = app.metadataCache.getFirstLinkpathDest(embed.link, sourceFile.path);
			if (!(target instanceof TFile) || !isExcalidrawFile(target)) continue;
			const line0 = embed.position?.start?.line;
			if (line0 == null) continue;

			const lines = [line0, line0 + 1];
			const containing = sections.find((s) =>
				s.el && lines.some((line) => typeof s.lineStart === "number" && typeof s.lineEnd === "number" && s.lineStart <= line && line <= s.lineEnd)
			);
			if (containing?.el)
			{
				containing.el.setAttribute("data-excalidraw-export", target.path);
				ExportLog.log(`Marked section lines ${containing.lineStart}-${containing.lineEnd} for ${target.path}`);
				continue;
			}

			const before = sections
				.filter((s) => s.el && typeof s.lineEnd === "number" && s.lineEnd < line0)
				.sort((a, b) => b.lineEnd - a.lineEnd)[0];
			if (before?.el)
			{
				before.el.setAttribute("data-excalidraw-insert-after", target.path);
				ExportLog.log(`Marked insert-after section ${before.lineStart}-${before.lineEnd} for ${target.path}`);
				continue;
			}

			const after = sections
				.filter((s) => s.el && typeof s.lineStart === "number" && s.lineStart > line0)
				.sort((a, b) => a.lineStart - b.lineStart)[0];
			if (after?.el)
			{
				after.el.setAttribute("data-excalidraw-insert-before", target.path);
				ExportLog.log(`Marked insert-before section ${after.lineStart}-${after.lineEnd} for ${target.path}`);
				continue;
			}

			ExportLog.log(`No section line anchors for Excalidraw at metadata line ${line0}; will use markdown text placement`);
		}
	}

	function getExcalidrawFilesFromMetadata(sourceFile: TFile): TFile[]
	{
		rememberExcalidrawEmbedLocations(sourceFile);
		const cache = app.metadataCache.getFileCache(sourceFile);
		const files: TFile[] = [];
		const seen = new Set<string>();
		for (const embed of cache?.embeds ?? [])
		{
			const target = app.metadataCache.getFirstLinkpathDest(embed.link, sourceFile.path);
			if (!(target instanceof TFile) || !isExcalidrawFile(target) || seen.has(target.path)) continue;
			seen.add(target.path);
			files.push(target);
		}
		return files;
	}

	function findBlockContainingText(root: HTMLElement, needle: string): HTMLElement | undefined
	{
		if (!needle) return;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode()))
		{
			if (!node.textContent?.includes(needle)) continue;
			const block = (node.parentElement?.closest(
				".markdown-preview-section, .el-p, .el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6, p, li, h1, h2, h3, h4, h5, h6"
			) as HTMLElement | null) ?? node.parentElement ?? undefined;
			if (block && root.contains(block)) return block;
		}
		return;
	}

	async function placeSlotByMarkdownContext(root: HTMLElement, sourceFile: TFile, embedLine0: number, slot: HTMLElement): Promise<boolean>
	{
		const md = await app.vault.cachedRead(sourceFile);
		const lines = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

		const normalize = (raw: string) =>
			raw.trim()
				.replace(/!\[\[.*?\]\]/g, "")
				.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
				.replace(/[*_`~>#]/g, "")
				.trim();

		for (let i = embedLine0 + 1; i < Math.min(lines.length, embedLine0 + 25); i++)
		{
			const plain = normalize(lines[i] ?? "");
			if (plain.length < 8) continue;
			const needle = plain.slice(0, 36);
			const block = findBlockContainingText(root, needle);
			if (!block) continue;
			block.before(slot);
			ExportLog.log(`Placed Excalidraw before text «${needle}»`);
			return true;
		}

		for (let i = embedLine0 - 1; i >= Math.max(0, embedLine0 - 25); i--)
		{
			const plain = normalize(lines[i] ?? "");
			if (plain.length < 8) continue;
			const needle = plain.slice(0, 36);
			const block = findBlockContainingText(root, needle);
			if (!block) continue;
			block.after(slot);
			ExportLog.log(`Placed Excalidraw after text «${needle}»`);
			return true;
		}

		return false;
	}

	async function ensureExcalidrawSlot(root: HTMLElement, file: TFile, sourceFile: TFile): Promise<HTMLElement>
	{
		const escaped = escapeAttrSelectorValue(file.path);
		const existing = root.querySelector(`[data-excalidraw-export="${escaped}"]`) as HTMLElement | null;
		if (existing) return existing;

		// Prefer replacing Obsidian's leftover embed/img for this drawing (often a broken <img>).
		const leftovers = findLeftoverExcalidrawHosts(root, file, sourceFile);
		if (leftovers.length > 0)
		{
			let host = leftovers[0];
			// <img> cannot host child export nodes — swap for a slot div.
			if (/^(IMG|VIDEO|AUDIO|EMBED|SOURCE)$/i.test(host.tagName))
			{
				const replacement = document.createElement("div");
				replacement.className = "internal-embed excalidraw-export-slot";
				replacement.setAttribute("data-excalidraw-export", file.path);
				host.replaceWith(replacement);
				host = replacement;
			}
			else
			{
				host.classList.add("internal-embed", "excalidraw-export-slot");
				host.setAttribute("data-excalidraw-export", file.path);
			}
			for (let i = 1; i < leftovers.length; i++) leftovers[i].remove();
			ExportLog.log(`Reusing leftover Excalidraw embed host for ${file.path}`);
			return host;
		}

		const slot = document.createElement("div");
		slot.className = "internal-embed excalidraw-export-slot";
		slot.setAttribute("data-excalidraw-export", file.path);

		const afterAnchor = root.querySelector(`[data-excalidraw-insert-after="${escaped}"]`);
		if (afterAnchor)
		{
			afterAnchor.after(slot);
			return slot;
		}

		const beforeAnchor = root.querySelector(`[data-excalidraw-insert-before="${escaped}"]`);
		if (beforeAnchor)
		{
			beforeAnchor.before(slot);
			return slot;
		}

		const loc = excalidrawEmbedLocations.get(file.path);
		if (loc && loc.hostPath === sourceFile.path)
		{
			const placed = await placeSlotByMarkdownContext(root, sourceFile, loc.line0, slot);
			if (placed) return slot;
		}

		root.appendChild(slot);
		ExportLog.warning(`Excalidraw slot appended at end for ${file.path}`);
		return slot;
	}

	function excalidrawMatchNeedles(file: TFile): string[]
	{
		return [
			file.path,
			file.name,
			file.basename,
			file.basename.replace(/\.excalidraw$/i, ""),
		].filter(Boolean);
	}

	function attrLooksLikeExcalidrawFile(attr: string | null | undefined, file: TFile): boolean
	{
		if (!attr) return false;
		let decoded = attr;
		try { decoded = decodeURIComponent(attr); } catch { /* keep raw */ }
		return excalidrawMatchNeedles(file).some((needle) => decoded.includes(needle));
	}

	function findLeftoverExcalidrawHosts(root: HTMLElement, file: TFile, sourceFile: TFile): HTMLElement[]
	{
		const hosts = new Set<HTMLElement>();
		const candidates = Array.from(root.querySelectorAll(
			[
				".internal-embed",
				".markdown-embed",
				".media-embed",
				"img[src]",
				"img[data-broken-src]",
				"img.is-broken-image",
				"img.excalidraw-embedded-img",
				"img[filesource]",
				".excalidraw-svg",
			].join(", ")
		)) as HTMLElement[];

		for (const el of candidates)
		{
			// Keep our injected export; remove native preview leftovers.
			if (el.matches("[data-export-excalidraw='1'], .excalidraw-export-img, .excalidraw-export-slot")) continue;
			if (el.closest("[data-export-excalidraw='1'], .excalidraw-export-slot")) continue;
			if (el.getAttribute("data-excalidraw-export") === file.path) continue;

			const resolved = getFallbackEmbedFile(el, sourceFile);
			const matched =
				resolved?.path === file.path ||
				attrLooksLikeExcalidrawFile(el.getAttribute("src"), file) ||
				attrLooksLikeExcalidrawFile(el.getAttribute("filesource"), file) ||
				attrLooksLikeExcalidrawFile(el.getAttribute("data-broken-src"), file) ||
				attrLooksLikeExcalidrawFile(el.getAttribute("alt"), file) ||
				attrLooksLikeExcalidrawFile(el.querySelector("img[filesource]")?.getAttribute("filesource"), file) ||
				attrLooksLikeExcalidrawFile(el.querySelector(".markdown-embed-link")?.getAttribute("href"), file) ||
				attrLooksLikeExcalidrawFile(el.querySelector(".markdown-embed-link")?.getAttribute("data-href"), file) ||
				attrLooksLikeExcalidrawFile(el.querySelector(".markdown-embed-title")?.textContent, file) ||
				(el.classList.contains("excalidraw-embedded-img") &&
					attrLooksLikeExcalidrawFile(el.getAttribute("filesource"), file)) ||
				((el.textContent ?? "").includes(EXCALIDRAW_FALLBACK_MARKER) &&
					attrLooksLikeExcalidrawFile(el.querySelector(".markdown-embed-title")?.textContent ?? el.getAttribute("src"), file));

			if (!matched) continue;

			// Prefer the wrapper Excalidraw injects around its blob preview image.
			const host = (el.closest(
				".excalidraw-svg:not(.excalidraw-export-img), .internal-embed, .markdown-embed, .media-embed"
			) as HTMLElement | null) ?? el;
			if (host.closest("[data-export-excalidraw='1'], .excalidraw-export-slot")) continue;
			hosts.add(host);
		}

		return Array.from(hosts);
	}

	function removeLeftoverExcalidrawHosts(root: HTMLElement, file: TFile, sourceFile: TFile, keep: HTMLElement): void
	{
		for (const host of findLeftoverExcalidrawHosts(root, file, sourceFile))
		{
			if (host === keep || keep.contains(host) || host.contains(keep)) continue;
			host.remove();
			ExportLog.log(`Removed leftover Excalidraw DOM node for ${file.path}`);
		}
	}

	function getExcalidrawAutomate(): any | undefined
	{
		// @ts-ignore
		return window.ExcalidrawAutomate ?? app.plugins?.plugins?.["obsidian-excalidraw-plugin"]?.ea;
	}

	async function readCompanionExcalidrawSvg(file: TFile): Promise<SVGElement | undefined>
	{
		const folder = file.parent?.path ? file.parent.path + "/" : "";
		const baseName = file.basename.replace(/\.excalidraw$/i, "");
		const candidates = [
			`${folder}${file.basename}.svg`,
			`${folder}${baseName}.svg`,
			`${folder}${file.basename}.light.svg`,
			`${folder}${baseName}.light.svg`,
		];

		for (const path of candidates)
		{
			const svgFile = app.vault.getAbstractFileByPath(path);
			if (!(svgFile instanceof TFile)) continue;
			try
			{
				const text = await app.vault.read(svgFile);
				if (!text.includes("<svg")) continue;
				const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
				const svg = parsed.documentElement;
				if (svg instanceof SVGSVGElement) return document.importNode(svg, true);
			}
			catch (error)
			{
				ExportLog.warning(error, `Failed reading companion SVG ${path}`);
			}
		}

		return undefined;
	}

	async function inlineSvgImageHrefs(svg: SVGElement, sourceFile: TFile): Promise<number>
	{
		const images = Array.from(svg.querySelectorAll("image"));
		let inlined = 0;

		for (const image of images)
		{
			const href =
				image.getAttribute("href") ??
				image.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
				"";
			if (!href || href.startsWith("data:")) continue;

			let file: TFile | undefined;
			let linkPath = href;

			if (linkPath.startsWith("app://"))
			{
				try
				{
					// @ts-ignore
					file = app.vault.resolveFileUrl(linkPath) ?? undefined;
				}
				catch { /* fall through */ }

				if (!file)
				{
					linkPath = decodeURIComponent(linkPath)
						.replace(/^app:\/\/[^/]+\//, "")
						.split("?")[0]
						.split("#")[0];
					// Strip absolute vault prefix if present
					const adapter = app.vault.adapter as { basePath?: string };
					const vaultPath = adapter.basePath?.replace(/\\/g, "/");
					if (vaultPath && linkPath.startsWith(vaultPath))
						linkPath = linkPath.substring(vaultPath.length).replace(/^\//, "");
					const abstract = app.vault.getAbstractFileByPath(linkPath);
					if (abstract instanceof TFile) file = abstract;
				}
			}
			else
			{
				linkPath = decodeURIComponent(linkPath).split("?")[0].split("#")[0].split("|")[0];
				const dest = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
				if (dest instanceof TFile) file = dest;
			}

			if (!file)
			{
				// Try beside the drawing / in its attachments folder
				const baseName = linkPath.split("/").pop() ?? linkPath;
				const parentPath = sourceFile.parent?.path ?? "";
				const guesses = [
					baseName,
					`${parentPath}/${baseName}`,
					`${parentPath}/attachments/${baseName}`,
					linkPath,
				];
				for (const guess of guesses)
				{
					const abstract = app.vault.getAbstractFileByPath(guess);
					if (abstract instanceof TFile)
					{
						file = abstract;
						break;
					}
					const dest = app.metadataCache.getFirstLinkpathDest(guess, sourceFile.path);
					if (dest instanceof TFile)
					{
						file = dest;
						break;
					}
				}
			}

			if (!file)
			{
				ExportLog.warning(`Could not resolve Excalidraw image href: ${href.slice(0, 160)}`);
				continue;
			}

			try
			{
				const data = Buffer.from(await app.vault.readBinary(file));
				const ext = file.extension.toLowerCase();
				const mime =
					ext === "svg" ? "image/svg+xml" :
					ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
					ext === "png" ? "image/png" :
					ext === "gif" ? "image/gif" :
					ext === "webp" ? "image/webp" :
					`image/${ext || "png"}`;
				const dataUri = `data:${mime};base64,${data.toString("base64")}`;
				image.setAttribute("href", dataUri);
				image.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUri);
				inlined++;
			}
			catch (error)
			{
				ExportLog.warning(error, `Failed inlining Excalidraw image ${file.path}`);
			}
		}

		return inlined;
	}

	async function countExcalidrawEmbeddedFiles(file: TFile): Promise<number>
	{
		try
		{
			const md = await app.vault.cachedRead(file);
			const section = md.split(/##\s+Embedded Files\b/i)[1]?.split(/##\s+|%%/)[0] ?? "";
			return (section.match(/:\s*\[\[.+?\]\]/g) ?? []).length;
		}
		catch
		{
			return 0;
		}
	}

	function countRenderableSvgImages(svg: SVGElement): { total: number; data: number; external: number }
	{
		const images = Array.from(svg.querySelectorAll("image, img"));
		let data = 0;
		let external = 0;
		for (const image of images)
		{
			const href =
				image.getAttribute("href") ??
				image.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
				image.getAttribute("src") ??
				"";
			if (!href) continue;
			if (href.startsWith("data:")) data++;
			else external++;
		}
		return { total: data + external, data, external };
	}

	function svgLooksComplete(svg: SVGElement, expectedImages: number): boolean
	{
		const counts = countRenderableSvgImages(svg);
		const markup = svg.outerHTML ?? "";
		if (markup.length < 400) return false;
		// Unresolved app:// (or other) hrefs become broken images in standalone HTML.
		if (counts.external > 0) return false;
		if (expectedImages > 0 && counts.data < expectedImages) return false;
		return true;
	}

	async function blobToDataUri(blob: Blob): Promise<string>
	{
		const buffer = Buffer.from(await blob.arrayBuffer());
		const mime = blob.type || "image/png";
		return `data:${mime};base64,${buffer.toString("base64")}`;
	}

	async function waitForExcalidrawViewReady(expectedImages: number, timeoutMs = 12000): Promise<any | undefined>
	{
		const started = Date.now();
		while (Date.now() - started < timeoutMs)
		{
			if (checkCancelled() || !renderLeaf) return;
			const view = renderLeaf.view as any;
			if (view?.getViewType?.() === "excalidraw")
			{
				const sceneFiles = Object.keys(view.excalidrawData?.scene?.files ?? {}).length;
				const dictFiles = Object.keys(view.filesStore ?? view.imagesDict ?? {}).length;
				const loaded = Math.max(sceneFiles, dictFiles);
				const hasScene = !!view.excalidrawData?.scene?.elements?.length;
				if (hasScene && (expectedImages === 0 || loaded >= expectedImages || Date.now() - started > timeoutMs * 0.7))
				{
					ExportLog.log(`Excalidraw view ready (sceneFiles=${sceneFiles}, dict=${dictFiles}, expected=${expectedImages})`);
					return view;
				}
			}
			await delay(100);
		}
		const view = renderLeaf?.view as any;
		if (view?.getViewType?.() === "excalidraw") return view;
		return;
	}

	async function restoreRenderLeafFile(restoreFile: TFile, drawingPath: string): Promise<void>
	{
		if (!renderLeaf || restoreFile.path === drawingPath) return;
		try
		{
			await renderLeaf.openFile(restoreFile, { active: false });
		}
		catch { /* ignore restore failures */ }
	}

	async function renderExcalidrawPngElement(file: TFile, ea: any, expectedImages: number): Promise<HTMLElement | undefined>
	{
		if (!ea?.createPNG) return;
		try
		{
			ea.reset?.();
			const created = await withTimeout(
				Promise.resolve(ea.createPNG(file.path, 2, { withBackground: true, withTheme: true })),
				EXCALIDRAW_CREATE_PNG_TIMEOUT_MS,
				`ExcalidrawAutomate.createPNG(${file.path})`
			);
			let blob: Blob | undefined;
			if (created instanceof Blob) blob = created;
			else if (created && typeof (created as any).arrayBuffer === "function") blob = created as Blob;
			if (!blob || blob.size < 256)
			{
				ExportLog.warning(`createPNG returned empty/tiny blob for ${file.path}`);
				return;
			}
			// Nested screenshots should inflate the PNG well beyond a bare wireframe.
			if (expectedImages > 0 && blob.size < Math.max(8_000, expectedImages * 4_000))
			{
				ExportLog.warning(`createPNG too small (${blob.size} B) for ${expectedImages} embedded file(s); treating as incomplete`);
				return;
			}

			const img = document.createElement("img");
			img.className = "excalidraw-svg excalidraw-export-img";
			img.setAttribute("data-export-excalidraw", "1");
			img.alt = file.basename;
			img.src = await blobToDataUri(blob);
			ExportLog.log(`createPNG finished for ${file.path} (${Math.round(blob.size / 1024)} KB)`);
			return img;
		}
		catch (error)
		{
			ExportLog.warning(error, `ExcalidrawAutomate.createPNG failed for ${file.path}`);
			return;
		}
	}

	async function renderExcalidrawSvgElement(file: TFile, ea: any | undefined, view: any | undefined, expectedImages: number): Promise<SVGElement | undefined>
	{
		let svg: SVGElement | undefined;

		const companion = await readCompanionExcalidrawSvg(file);
		if (companion && svgLooksComplete(companion, expectedImages))
		{
			svg = companion;
			ExportLog.log(`Used companion SVG for ${file.path}`);
		}

		if (!svg && view?.excalidrawData?.scene && view?.svg)
		{
			try
			{
				const created = await withTimeout(
					Promise.resolve(view.svg(view.excalidrawData.scene, "", false)),
					EXCALIDRAW_CREATE_SVG_TIMEOUT_MS,
					`excalidraw view.svg(${file.path})`
				);
				if (created instanceof SVGSVGElement)
				{
					svg = created;
					ExportLog.log(`view.svg finished for ${file.path}`);
				}
			}
			catch (error)
			{
				ExportLog.warning(error, `view.svg failed for ${file.path}`);
			}
		}

		if (!svg && ea?.createSVG)
		{
			try
			{
				ea.reset?.();
				const created = await withTimeout(
					Promise.resolve(ea.createSVG(file.path)),
					EXCALIDRAW_CREATE_SVG_TIMEOUT_MS,
					`ExcalidrawAutomate.createSVG(${file.path})`
				);
				if (created instanceof SVGSVGElement)
				{
					svg = created;
					ExportLog.log(`createSVG finished for ${file.path}`);
				}
			}
			catch (error)
			{
				ExportLog.warning(error, `ExcalidrawAutomate.createSVG failed for ${file.path}`);
			}
		}

		if (!svg) return;
		const inlined = await inlineSvgImageHrefs(svg, file);
		const counts = countRenderableSvgImages(svg);
		ExportLog.log(`Inlined ${inlined} image(s) inside Excalidraw SVG for ${file.path} (data=${counts.data}, external=${counts.external}, expected=${expectedImages})`);
		if (!svgLooksComplete(svg, expectedImages))
		{
			ExportLog.warning(`Rejecting incomplete Excalidraw SVG for ${file.path}`);
			return;
		}
		return svg;
	}

	async function renderExcalidrawExportElement(file: TFile, restoreFile: TFile): Promise<HTMLElement | undefined>
	{
		const cached = excalidrawSvgCache.get(file.path);
		if (cached) return cached.cloneNode(true) as HTMLElement;

		const inflight = excalidrawSvgInflight.get(file.path);
		if (inflight)
		{
			const shared = await inflight;
			return shared ? shared.cloneNode(true) as HTMLElement : undefined;
		}

		const task = (async (): Promise<HTMLElement | undefined> => {
			const startedAt = Date.now();
			const expectedImages = await countExcalidrawEmbeddedFiles(file);
			ExportLog.log(`Rendering Excalidraw export for ${file.path} (embedded files=${expectedImages})...`);

			const ea = getExcalidrawAutomate();
			let view: any | undefined;
			let element: HTMLElement | undefined;

			// Fast path: EA APIs load the template + EmbeddedFilesLoader without opening the editor.
			if (ea)
			{
				element = await renderExcalidrawPngElement(file, ea, expectedImages);
			}
			if (!element)
			{
				const svg = await renderExcalidrawSvgElement(file, ea, undefined, expectedImages);
				if (svg)
				{
					const isLight = !svg.getAttribute("filter");
					if (!isLight) svg.removeAttribute("filter");
					svg.classList.add(isLight ? "light" : "dark");
					const wrapper = document.createElement("div");
					wrapper.classList.add("excalidraw-svg");
					wrapper.setAttribute("data-export-excalidraw", "1");
					wrapper.appendChild(svg);
					element = wrapper;
				}
			}

			// Slow path: open the drawing so scene files populate, then retry.
			if (!element && renderLeaf)
			{
				try
				{
					ExportLog.log(`Opening Excalidraw view to load embedded files for ${file.path}...`);
					await renderLeaf.openFile(file, { active: false });
					view = await waitForExcalidrawViewReady(expectedImages);
					if (ea) element = await renderExcalidrawPngElement(file, ea, expectedImages);
					if (!element)
					{
						const svg = await renderExcalidrawSvgElement(file, ea, view, expectedImages);
						if (svg)
						{
							const isLight = !svg.getAttribute("filter");
							if (!isLight) svg.removeAttribute("filter");
							svg.classList.add(isLight ? "light" : "dark");
							const wrapper = document.createElement("div");
							wrapper.classList.add("excalidraw-svg");
							wrapper.setAttribute("data-export-excalidraw", "1");
							wrapper.appendChild(svg);
							element = wrapper;
						}
					}
				}
				catch (error)
				{
					ExportLog.warning(error, `Failed opening Excalidraw view for ${file.path}`);
				}
				finally
				{
					await restoreRenderLeafFile(restoreFile, file.path);
				}
			}

			if (!element)
			{
				ExportLog.warning(`Could not render Excalidraw embed: ${file.path}`);
				return;
			}

			ExportLog.log(`Excalidraw export element ready for ${file.path} in ${Date.now() - startedAt}ms`);
			excalidrawSvgCache.set(file.path, element.cloneNode(true) as HTMLElement);
			return element;
		})();

		excalidrawSvgInflight.set(file.path, task);
		try
		{
			const element = await task;
			return element ? element.cloneNode(true) as HTMLElement : undefined;
		}
		finally
		{
			excalidrawSvgInflight.delete(file.path);
		}
	}

	function applyExcalidrawExportToEmbed(target: HTMLElement, element: HTMLElement): void
	{
		target.classList.add("internal-embed");
		target.innerHTML = "";
		target.appendChild(element);
	}

	async function fixFallbackExcalidrawEmbeds(root: HTMLElement, sourceFile: TFile): Promise<void>
	{
		ExportLog.log("Processing Excalidraw embeds...");
		const startedAt = Date.now();

		// @ts-ignore
		if (!app.plugins?.enabledPlugins?.has("obsidian-excalidraw-plugin"))
		{
			ExportLog.log("Excalidraw plugin not enabled; skipping embed recovery");
			return;
		}

		const metaFiles = getExcalidrawFilesFromMetadata(sourceFile);
		ExportLog.log(`Metadata lists ${metaFiles.length} Excalidraw embed(s)`);
		if (metaFiles.length === 0) return;

		for (const file of metaFiles)
		{
			const target = await ensureExcalidrawSlot(root, file, sourceFile);
			removeLeftoverExcalidrawHosts(root, file, sourceFile, target);
			if (target.querySelector("[data-export-excalidraw='1']")) continue;

			const element = await renderExcalidrawExportElement(file, sourceFile);
			if (!element)
			{
				ExportLog.warning(`Could not render Excalidraw embed: ${file.path}`);
				continue;
			}

			applyExcalidrawExportToEmbed(target, element);
			removeLeftoverExcalidrawHosts(root, file, sourceFile, target);
			// Final sweep: any native Excalidraw blob preview for this drawing.
			const escaped = escapeAttrSelectorValue(file.path);
			root.querySelectorAll(`img.excalidraw-embedded-img[filesource="${escaped}"], img[filesource="${escaped}"]`).forEach((img) => {
				if (img.closest(".excalidraw-export-slot, [data-export-excalidraw='1']")) return;
				const host = (img.closest(".excalidraw-svg, .internal-embed, .media-embed") as HTMLElement | null) ?? img;
				if (host === target || target.contains(host)) return;
				host.remove();
				ExportLog.log(`Swept native Excalidraw preview for ${file.path}`);
			});
			ExportLog.log(`Injected Excalidraw export into DOM for ${file.path}`);
		}

		ExportLog.log(`Excalidraw embed processing finished in ${Date.now() - startedAt}ms`);
	}

	function failRender(file: TFile | undefined, message: any): undefined {
		if (checkCancelled()) return undefined;

		ExportLog.error(message, `Rendering ${file?.path ?? " custom markdown "} failed: `);
		return;
	}

	export async function renderFile(file: TFile, options: MarkdownRendererOptions): Promise<{ contentEl: HTMLElement, viewType: string } | undefined> {
		if (MarkdownRendererAPI.viewableMediaExtensions.contains(file.extension)) {
			return { contentEl: await createMediaPage(file, options), viewType: "attachment" };
		}

		const loneFile = !batchStarted;
		if (loneFile) {
			ExportLog.log("Exporting single file, starting batch");
			await _MarkdownRendererInternal.beginBatch(options);
		}

		const success = await waitUntil(() => renderLeaf != undefined || checkCancelled(), 2000, 1);
		if (!success || !renderLeaf) return failRender(file, "Failed to get leaf for rendering!");

		let html: HTMLElement | undefined;

		try {
			await renderLeaf.openFile(file, { active: false });
		}
		catch (e) {
			return failRender(file, e);
		}

		const view = renderLeaf.view;
		const viewType = view.getViewType();

		switch (viewType) {
			case "markdown":
				// @ts-ignore
				const preview = view.previewMode;
				html = await renderMarkdownView(preview, options);
				break;
			case "kanban":
				html = await renderGeneric(view, options);
				break;
			case "excalidraw":
				html = await renderExcalidraw(view, options);
				break;
			case "canvas":
				html = await renderCanvas(view, options);
				break;
			default:
				html = await renderGeneric(view, options);
				break;
		}

		if (checkCancelled()) return undefined;
		if (!html) return failRender(file, "Failed to render file!");

		if (loneFile) _MarkdownRendererInternal.endBatch();

		return { contentEl: html, viewType: viewType };
	}

	export async function renderMarkdown(markdown: string, options: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		const loneFile = !batchStarted;
		if (loneFile) {
			ExportLog.log("Exporting single file, starting batch");
			await _MarkdownRendererInternal.beginBatch(options);
		}

		const success = await waitUntil(() => renderLeaf != undefined || checkCancelled(), 2000, 1);
		if (!success || !renderLeaf) return failRender(undefined, "Failed to get leaf for rendering!");


		const view: MarkdownView = markdownView ?? new MarkdownView(renderLeaf);
		renderLeaf.view = view;

		try {
			view.setViewData(markdown, false);
		}
		catch (e) {
			return failRender(undefined, e);
		}


		let html: HTMLElement | undefined;

		// @ts-ignore
		const preview = view.previewMode;
		html = await renderMarkdownView(preview, options);

		if (checkCancelled()) return undefined;
		if (!html) return failRender(undefined, "Failed to render file!");

		if (loneFile) _MarkdownRendererInternal.endBatch();

		return html;
	}

	async function renderMarkdownViewFallback(preview: MarkdownPreviewView, options: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		preview.load();
		// @ts-ignore
		const renderer = preview.renderer;

		try {
			await renderer.unfoldAllHeadings();
			await renderer.unfoldAllLists();
			await renderer.parseSync();
		}
		catch (e) {
			ExportLog.error(e, "Failed to unfold or parse renderer!");
		}

		// @ts-ignore
		if (!window.mermaid) {
			await loadMermaid();
		}

		const sections = renderer.sections as { "rendered": boolean, "height": number, "computed": boolean, "lines": number, "lineStart": number, "lineEnd": number, "used": boolean, "highlightRanges": number, "level": number, "headingCollapsed": boolean, "shown": boolean, "usesFrontMatter": boolean, "html": string, "el": HTMLElement }[];

		// @ts-ignore
		const newMarkdownEl = document.body.createDiv({ attr: { class: "obsidian-document " + (preview.renderer?.previewEl?.className ?? "") } });
		const newSizerEl = newMarkdownEl.createDiv({ attr: { class: "markdown-preview-sizer" } });

		if (!newMarkdownEl || !newSizerEl) return failRender(preview.file, "Please specify a container element, or enable keepViewContainer!");

		preview.containerEl = newSizerEl;

		// @ts-ignore
		const promises: Promise<any>[] = [];
		const foldedCallouts: HTMLElement[] = [];
		for (const section of sections) {
			section.shown = true;
			section.rendered = false;
			// @ts-ignore
			section.resetCompute();
			// @ts-ignore
			section.setCollapsed(false);
			section.el.empty();

			newSizerEl.appendChild(section.el);

			// @ts-ignore
			await section.render();

			// @ts-ignore
			let success = await waitUntil(() => (section.el && section.rendered) || checkCancelled(), 2000, 1);
			if (!success) return failRender(preview.file, "Failed to render section!");

			await renderer.measureSection(section);
			success = await waitUntil(() => section.computed || checkCancelled(), 2000, 1);
			if (!success) return failRender(preview.file, "Failed to compute section!");

			// compile dataview
			if (DataviewRenderer.isDataviewEnabled())
			{
				const dataviewInfo = DataviewRenderer.getDataViewsFromHTML(section.el)[0];
				if (dataviewInfo) {
					const dataviewContainer = document.body.createDiv();
					dataviewContainer.classList.add(`block-language-${dataviewInfo.keyword}`);
					dataviewInfo.preEl.replaceWith(dataviewContainer);
					await new DataviewRenderer(preview, preview.file, dataviewInfo?.query, dataviewInfo.keyword).generate(dataviewContainer);
				}
			}

			// @ts-ignore
			await preview.postProcess(section, promises, renderer.frontmatter);

			foldedCallouts.push(...unfoldHiddenPreviewContainers(section.el));

			// wait for transclusions
			await waitUntil(() => !section.el.querySelector(".markdown-preview-pusher") || section.el.querySelector(".markdown-preview-pusher + *") != null || checkCancelled(), 500, 1);
			if (checkCancelled()) return undefined;

			if ((section.el.querySelector(".markdown-preview-pusher") && !section.el.querySelector(".markdown-preview-pusher + *"))) {
				ExportLog.warning("Transclusions were not rendered correctly in file " + preview.file.name + "!");
			}

			// wait for generic plugins (skip Excalidraw embed placeholders; recovered later)
			await waitUntil(() => !hasPendingGenericPluginBlocks(section.el) || checkCancelled(), 500, 1);
			if (checkCancelled()) return undefined;

			await fixFallbackExcalidrawEmbeds(section.el, preview.file);
			if (checkCancelled()) return undefined;

			// convert canvas elements into images here because otherwise they will lose their data when moved
			const canvases = Array.from(section.el.querySelectorAll("canvas:not(.pdf-embed canvas)")) as HTMLCanvasElement[];
			for (const canvas of canvases) {
				const data = canvas.toDataURL();
				if (data.length < 100) {
					ExportLog.log(canvas.outerHTML, "Failed to render canvas based plugin element in file " + preview.file.name + ":");
					canvas.remove();
					continue;
				}

				const image = document.body.createEl("img");
				image.src = data;
				image.style.width = canvas.style.width || "100%";
				image.style.maxWidth = "100%";
				canvas.replaceWith(image);
			};

			//console.debug(section.el.outerHTML); // for some reason adding this line here fixes an issue where some plugins wouldn't render

			const invalidPluginBlocks = Array.from(section.el.querySelectorAll("[class^='block-language-']:empty"));
			for (const block of invalidPluginBlocks) {
				ExportLog.warning(`Plugin element ${block.className || block.parentElement?.className || "unknown"} from ${preview.file.name} not rendered correctly!`);
			}
		}

		// @ts-ignore
		await Promise.all(promises);

		// refold callouts
		for (const callout of foldedCallouts) {
			callout.style.display = "none";
		}

		newSizerEl.empty();

		// create the markdown-preview-pusher element
		if (options.createPusherElement) {
			newSizerEl.createDiv({ attr: { class: "markdown-pusher", style: "width: 1px; height: 0.1px; margin-bottom: 0px;" } });
		}

		// move all of them back in since rendering can cause some sections to move themselves out of their container
		for (const section of sections) {
			newSizerEl.appendChild(section.el.cloneNode(true));
		}

		// get banner plugin banner and insert it before the sizer element
		const banner = preview.containerEl.querySelector(".obsidian-banner-wrapper");
		if (banner) {
			newSizerEl.before(banner);
		}

		// if we aren't keeping the view element then only keep the content of the sizer element
		if (options.createDocumentContainer === false) {
			newMarkdownEl.outerHTML = newSizerEl.innerHTML;
		}

		options.container?.appendChild(newMarkdownEl);

		if (options.unifyTitleFormat) {
			var title = await _MarkdownRendererInternal.getTitleForFile(preview.file);
			var icon = await _MarkdownRendererInternal.getIconForFile(preview.file);
			let iconSVG = await MarkdownRendererAPI.renderMarkdownSimple(icon.icon) ?? icon.icon;
			_MarkdownRendererInternal.addTitle(options.container ?? newMarkdownEl, title.title, title.isDefault, iconSVG, icon.isDefault, preview.file, options);
		}

		return newMarkdownEl;
	}

	export async function renderMarkdownView(preview: MarkdownPreviewView, options: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		// @ts-ignore
		if (preview.show)
			// @ts-ignore
			preview.show();

		if (!preview.rerender || options.useFallbackRenderer) {
			console.log(`Rendering ${preview.file.name} using fallback method`);
			return renderMarkdownViewFallback(preview, options);
		}

		// @ts-ignore
		const renderer: any = preview.renderer;

		try {
			await renderer.unfoldAllHeadings();
			await renderer.unfoldAllLists();
			await renderer.parseSync();
		} catch (e) {
			ExportLog.error(e, "Failed to unfold or parse renderer!");
		}

		// @ts-ignore
		if (!window.mermaid) {
			await loadMermaid();
		}

		const sections = renderer.sections as {
			rendered: boolean;
			height: number;
			computed: boolean;
			lines: number;
			lineStart: number;
			lineEnd: number;
			used: boolean;
			highlightRanges: number;
			level: number;
			headingCollapsed: boolean;
			shown: boolean;
			usesFrontMatter: boolean;
			html: string;
			el: HTMLElement;
		}[];

		// @ts-ignore
		const newMarkdownEl = batchDocument.body.createDiv({
			attr: {
				// @ts-ignore
				class: "obsidian-document " + (preview.renderer?.previewEl?.className ?? ""),
			},
		});
		const newSizerEl = newMarkdownEl.createDiv({
			attr: { class: "markdown-preview-sizer markdown-preview-section" },
		});

		if (!newMarkdownEl || !newSizerEl)
			return failRender(
				preview.file,
				"Please specify a container element, or enable keepViewContainer!"
			);

		const previewEl: HTMLElement = renderer.previewEl;
		const sizerEl: HTMLElement =
			previewEl.querySelector(".markdown-preview-sizer") ?? previewEl;
		previewEl.style.minHeight = sizerEl.style.minHeight;

		await Utils.delay(16);

		unfoldHiddenPreviewContainers(preview.containerEl);
		unfoldHiddenPreviewContainers(previewEl);

		let rendered = false;
		// @ts-ignore
		preview.renderer.onRendered(() => {
			console.log("Rendered");
			rendered = true;
		});

		// @ts-ignore
		preview.rerender(true);

		await Utils.delay(5);

		previewEl.style.minHeight = sizerEl.style.minHeight;

		await Utils.delay(5);

		// wait for rendering to finish using callback
		let renderSuccess = await waitUntil(
			() => rendered || checkCancelled(),
			2000,
			16
		);
		if (checkCancelled()) return undefined;
		if (!renderSuccess)
			return failRender(preview.file, "Failed to render preview!");

		// @ts-ignore
		const foldedCallouts: HTMLElement[] = [];
		for (const section of sections) {
			foldedCallouts.push(...unfoldHiddenPreviewContainers(section.el));
		}
		foldedCallouts.push(...unfoldHiddenPreviewContainers(preview.containerEl));

		await Utils.delay(5);

		// wait until the sizer contains all the sections
		ExportLog.log("Waiting for all sections to be counted...");
		var sectionsSuccess = await waitUntil(
			() => {
				console.log(sizerEl.children.length, sections.length);
				return (
					sizerEl.children.length >= sections.length ||
					checkCancelled()
				);
			},
			4000,
			5
		);
		if (checkCancelled()) return undefined;

		if (!sectionsSuccess) {
			console.log(
				sizerEl.children.length,
				sections.length,
				sizerEl.children,
				sections
			);
			ExportLog.warning(
				"Failed to render all sections in file " +
					preview.file.name +
					", using fallback!"
			);
			return renderMarkdownViewFallback(preview, options);
		}

		await Utils.delay(50);

		// compile dataview
		if (DataviewRenderer.isDataviewEnabled())
		{
			const dataviewInfos = DataviewRenderer.getDataViewsFromHTML(
				preview.containerEl
			);
			for (const dataviewInfo of dataviewInfos) {
				await new DataviewRenderer(
					preview,
					preview.file,
					dataviewInfo?.query,
					dataviewInfo.keyword
				).generate(dataviewInfo.preEl);
			}
		}

		// wait for transclusions
		ExportLog.log("Waiting for transclusions to render...");
		await waitUntil(
			() =>
				!preview.containerEl.querySelector(
					".markdown-preview-pusher"
				) ||
				preview.containerEl.querySelector(
					".markdown-preview-pusher + *"
				) != null ||
				checkCancelled(),
			2000,
			5
		);
		if (checkCancelled()) return undefined;

		if (
			preview.containerEl.querySelector(".markdown-preview-pusher") &&
			!preview.containerEl.querySelector(".markdown-preview-pusher + *")
		) {
			ExportLog.warning(
				"Transclusions were not rendered correctly in file " +
					preview.file.name +
					"!"
			);
		}

		// wait for generic plugins (skip Excalidraw embed placeholders; recovered later)
		ExportLog.log("Waiting for generic plugins to render...");
		const genericPluginsStartedAt = Date.now();
		await waitUntil(
			() => !hasPendingGenericPluginBlocks(preview.containerEl) || checkCancelled(),
			2000,
			16
		);
		ExportLog.log(`Generic plugin wait finished in ${Date.now() - genericPluginsStartedAt}ms`);
		if (checkCancelled()) return undefined;

		// check for invalid plugin blocks
		const invalidPluginBlocks = Array.from(
			preview.containerEl.querySelectorAll(
				"[class^='block-language-']:empty"
			)
		).filter((block) => {
			const embed = (block as HTMLElement).closest(".internal-embed, .markdown-embed") as HTMLElement | null;
			return !(embed && isLikelyExcalidrawEmbed(embed));
		});
		for (const block of invalidPluginBlocks) {
			ExportLog.warning(
				`Plugin element ${
					block.className ||
					block.parentElement?.className ||
					"unknown"
				} from ${preview.file.name} not rendered correctly!`
			);
		}

		// convert canvas elements into images here because otherwise they will lose their data when moved
		const canvasStartedAt = Date.now();
		const canvases = Array.from(
			sizerEl.querySelectorAll(
				"canvas:not(.pdf-embed canvas)"
			)
		) as HTMLCanvasElement[];
		ExportLog.log(`Converting ${canvases.length} canvas element(s)...`);
		for (const canvas of canvases) {
			// wait until the canvas is rendered
			ExportLog.log("Waiting for canvas-based plugin to render...");
			let canvasSuccess = await waitUntil(
				() => canvas.toDataURL().length > 100 || checkCancelled(),
				1000,
				16
			);
			if (!canvasSuccess) continue;

			const data = canvas.toDataURL();

			const image = batchDocument.body.createEl("img");
			image.src = data;
			image.style.width = canvas.style.width || "100%";
			image.style.maxWidth = "100%";
			canvas.replaceWith(image);
		}
		ExportLog.log(`Canvas conversion finished in ${Date.now() - canvasStartedAt}ms`);

		// Mark which preview sections own Excalidraw embeds (export leaf often never
		// materializes the embed DOM, so we inject by section line mapping later).
		markExcalidrawEmbedSections(sections, preview.file);

		// refold callouts
		for (const callout of foldedCallouts) {
			callout.style.display = "none";
		}

		newSizerEl.empty();

		// create the markdown-preview-pusher element
		if (options.createPusherElement) {
			newSizerEl.createDiv({
				attr: {
					class: "markdown-pusher",
					style: "width: 1px; height: 0.1px; margin-bottom: 0px;",
				},
			});
		}

		const cloneStartedAt = Date.now();
		// cloneNode avoids HTML serialize/parse of large Excalidraw SVGs (innerHTML is a major stall)
		for (const child of Array.from(sizerEl.childNodes)) {
			newSizerEl.appendChild(child.cloneNode(true));
		}
		ExportLog.log(`Cloned preview DOM in ${Date.now() - cloneStartedAt}ms`);
		if (checkCancelled()) return undefined;

		// Stop live preview work (Excalidraw native SVG, Number Headings refresh, etc.)
		// so it cannot stall the rest of the export on the shared UI thread.
		try {
			sizerEl.empty();
			ExportLog.log("Cleared live preview to stop background plugin work");
		} catch { /* ignore */ }

		// Inject Excalidraw into the exported clone via createSVG (not native preview)
		await fixFallbackExcalidrawEmbeds(newSizerEl, preview.file);
		if (checkCancelled()) return undefined;

		// get banner plugin banner and insert it before the sizer element
		const banner = preview.containerEl.querySelector(
			".obsidian-banner-wrapper"
		);
		if (banner) {
			newSizerEl.before(banner);
		}
		// if we aren't keeping the view element then only keep the content of the sizer element
		if (options.createDocumentContainer === false) {
			newMarkdownEl.outerHTML = newSizerEl.innerHTML;
		}

		ExportLog.log("Appending rendered document to export container...");
		options.container?.appendChild(newMarkdownEl);

		if (options.unifyTitleFormat) {
			ExportLog.log("Applying unified title format...");
			const titleStartedAt = Date.now();
			let title = await _MarkdownRendererInternal.getTitleForFile(
				preview.file
			);
			let icon = await _MarkdownRendererInternal.getIconForFile(
				preview.file
			);
			let iconSVG =
				(await MarkdownRendererAPI.renderMarkdownSimple(icon.icon)) ??
				icon.icon;
			_MarkdownRendererInternal.addTitle(
				options.container ?? newMarkdownEl,
				title.title,
				title.isDefault,
				iconSVG,
				icon.isDefault,
				preview.file,
				options
			);
			ExportLog.log(`Title format finished in ${Date.now() - titleStartedAt}ms`);
		}

		ExportLog.log("Markdown view render complete");
		return newMarkdownEl;
	}

	export async function renderSimpleMarkdown(markdown: string, container: HTMLElement) {
		const renderComp = new Component();
		renderComp.load();
		await ObsidianRenderer.render(app, markdown, container, "/", renderComp);
		renderComp.unload();

		const renderedEl = container.children[container.children.length - 1];
		if (renderedEl && renderedEl.tagName == "P") {
			renderedEl.outerHTML = renderedEl.innerHTML; // remove the outer <p> tag
		}

		// remove tags
		container.querySelectorAll("a.tag").forEach((element: HTMLAnchorElement) => {
			element.remove();
		});

		//remove rendered lists and replace them with plain text
		container.querySelectorAll("ol").forEach((listEl: HTMLElement) => {
			if (listEl.parentElement) {
				const start = listEl.getAttribute("start") ?? "1";
				listEl.parentElement.createSpan().outerHTML = `${start}. ${listEl.innerText}`;
				listEl.remove();
			}
		});
		container.querySelectorAll("ul").forEach((listEl: HTMLElement) => {
			if (listEl.parentElement) {
				listEl.parentElement.createSpan().innerHTML = "- " + listEl.innerHTML;
				listEl.remove();
			}
		});
		container.querySelectorAll("li").forEach((listEl: HTMLElement) => {
			if (listEl.parentElement) {
				listEl.parentElement.createSpan().innerHTML = listEl.innerHTML;
				listEl.remove();
			}
		});
	}

	async function renderGeneric(view: View, options: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		await delay(2000);

		if (checkCancelled()) return undefined;

		// @ts-ignore
		const contentEl = view.contentEl.cloneNode(true);
		options.container?.appendChild(contentEl);

		return contentEl;
	}

	async function renderExcalidraw(view: any, options: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		await delay(500);

		// @ts-ignore
		const scene = view.excalidrawData.scene;

		// @ts-ignore
		const svg = await view.svg(scene, "", false);

		// remove rect fill
		const isLight = !svg.getAttribute("filter");
		if (!isLight) svg.removeAttribute("filter");
		svg.classList.add(isLight ? "light" : "dark");

		let contentEl = batchDocument.body.createDiv();
		contentEl.classList.add("obsidian-document");
		const sizerEl = contentEl.createDiv();
		sizerEl.classList.add("excalidraw-plugin");

		sizerEl.appendChild(svg);

		if (checkCancelled()) return undefined;

		if (options.createDocumentContainer === false) {
			contentEl = svg;
		}

		options.container?.appendChild(contentEl);

		return contentEl;
	}

	export async function getIconForFile(file: TAbstractFile): Promise<{ icon: string; isDefault: boolean }> {
		if (!file) return { icon: "", isDefault: true };

		let iconOutput = "";
		let iconProperty: string | undefined = "";
		let useDefaultIcon = false;
		let useFile = file;

		if (useFile instanceof TFolder) {
			// look for icon property on a file inside the folder with the same name as the folder
			let childFile = app.vault.getFileByPath(file.path + "/" + file.name + ".md");
			if (childFile) useFile = childFile;

			if (!childFile && Settings.exportOptions.fileNavigationOptions.showDefaultFolderIcons) {
				iconProperty = Settings.exportOptions.fileNavigationOptions.defaultFolderIcon;
				useDefaultIcon = true;
			}
		}

		if (useFile instanceof TFile)
		{
			const fileCache = app.metadataCache.getFileCache(useFile);
			const frontmatter = fileCache?.frontmatter;
			iconProperty = frontmatter?.icon ?? frontmatter?.sticker ?? frontmatter?.banner_icon; // banner plugin support
			if (!iconProperty && Settings.exportOptions.fileNavigationOptions.showDefaultFileIcons) {
				useDefaultIcon = true;
				const isMedia = AssetLoader.extentionToType(useFile.extension) == AssetType.Media;
				iconProperty = isMedia ? Settings.exportOptions.fileNavigationOptions.defaultMediaIcon : Settings.exportOptions.fileNavigationOptions.defaultFileIcon;
				if (useFile.extension == "canvas") iconProperty = "lucide//layout-dashboard";
			}
		}

		iconOutput = await IconHandler.getIcon(iconProperty ?? "");

		// add iconize icon as frontmatter if iconize exists
		const isUnchangedNotEmojiNotHTML = (iconProperty == iconOutput && iconOutput.length < 40) && !IconHandler.isEmojiPresentation(iconOutput) && !iconOutput.includes("<") && !iconOutput.includes(">");
		let parsedAsIconize = false;

		//@ts-ignore
		if ((useDefaultIcon || !iconProperty || isUnchangedNotEmojiNotHTML) && app?.plugins?.enabledPlugins?.has("obsidian-icon-folder")) {
			//@ts-ignore
			const fileToIconName = app.plugins.plugins['obsidian-icon-folder'].data;
			const noteIconsEnabled = fileToIconName.settings.iconsInNotesEnabled ?? false;

			// only add icon if rendering note icons is enabled
			// bectheause that is what we rely on to get  icon
			if (noteIconsEnabled) {
				const iconIdentifier = fileToIconName.settings.iconIdentifier ?? ":";
				let iconProperty = fileToIconName[file.path];

				if (iconProperty && typeof iconProperty != "string") {
					iconProperty = iconProperty.iconName ?? "";
				}

				if (iconProperty && typeof iconProperty == "string" && iconProperty.trim() != "") {
					// Never write frontmatter during export — it retriggers preview plugins
					// (Number Headings, Excalidraw, etc.) and can stall the export leaf.
					if (!batchStarted && file instanceof TFile)
						app.fileManager.processFrontMatter(file, (frontmatter) => {
							frontmatter.icon = iconProperty;
						});

					const trimmedIcon = iconProperty.trim();
					const isEmoji = IconHandler.isEmojiPresentation(trimmedIcon);

					if (isEmoji) iconOutput = await IconHandler.getIcon(iconProperty);
					else iconOutput = iconIdentifier + iconProperty + iconIdentifier;

					parsedAsIconize = true;
				}
			}
		}

		if (!parsedAsIconize && isUnchangedNotEmojiNotHTML) iconOutput = "";

		return { icon: iconOutput, isDefault: useDefaultIcon };
	}

	export async function getTitleForFile(file: TAbstractFile): Promise<{ title: string; isDefault: boolean }> {
		if (!file) return { title: "NULL ERROR", isDefault: true };
		
		let title = file.name;
		let isDefaultTitle = true;
		if (file instanceof TFile) {
			const fileCache = app.metadataCache.getFileCache(file);
			const frontmatter = fileCache?.frontmatter;
			const titleFromFrontmatter = frontmatter?.[Settings.titleProperty] ?? frontmatter?.["banner_header"]; // banner plugin support
			title = (titleFromFrontmatter ?? file.basename)?.toString() ?? "";

			if (title.endsWith(".excalidraw")) {
				title = title.substring(0, title.length - 11);
			}

			if (title != file.basename) {
				isDefaultTitle = false;
			}
		}

		if (file instanceof TFolder) {
			title = file.name;
			isDefaultTitle = true;
		}

		return { title: title, isDefault: isDefaultTitle };
	}

	export async function addTitle(documentRoot: HTMLElement, title: string, isDefaultTitle: boolean, icon: string, isDefaultIcon: boolean, source: TFile, exportOptions: MarkdownRendererOptions) {
		// remove inline title
		const inlineTitle = documentRoot.querySelector(".inline-title");
		inlineTitle?.remove();

		// remove make.md title
		const makeTitle = documentRoot.querySelector(".mk-inline-context");
		makeTitle?.remove();

		// remove mod-header
		const modHeader = documentRoot.querySelector(".mod-header");
		modHeader?.remove();

		// create header and footer
		const sizerElement = documentRoot.querySelector(".markdown-preview-sizer");
		const header = sizerElement?.createDiv({ cls: "header" });
		header?.createDiv({ cls: "data-bar" });
		const footer = sizerElement?.createDiv({ cls: "footer" });
		footer?.createDiv({ cls: "data-bar" });

		if (header) sizerElement?.prepend(header);

		// remove banner header
		documentRoot.querySelector(".banner-header")?.remove();

		// Create h1 inline title
		const titleEl = documentRoot.createEl("h1");
		titleEl.classList.add("page-title", "heading");
		if (document.body.classList.contains("show-inline-title")) titleEl.classList.add("inline-title");
		titleEl.id = title;

		if (exportOptions.addPageIcon) {
			let pageIcon = undefined;
			// Create a div with icon
			if ((icon != "" && !isDefaultIcon)) {
				pageIcon = documentRoot.createEl("div");
				pageIcon.id = "webpage-icon";
				pageIcon.innerHTML = icon;
			}

			// Insert title into the title element
			await _MarkdownRendererInternal.renderSimpleMarkdown(title, titleEl);

			// remove new lines
			titleEl.innerHTML = titleEl.innerHTML.replace(/\n/g, "");

			if (pageIcon) {
				titleEl.prepend(pageIcon);
			}
		}

		// Insert title into the document
		(header ?? sizerElement)?.prepend(titleEl);
	}

	export async function renderCanvas(view: any, options: MarkdownRendererOptions): Promise<HTMLElement | undefined> {
		if (checkCancelled()) return undefined;

		// this is to decide whether to inline the HTML of certain node or not
		let allExportedPaths = Settings.getAllFilesFromPaths(options.filesToExport);

		const canvas = view.canvas;

		const nodes = canvas.nodes;
		const edges = canvas.edges;

		canvas.zoomToFit();
		await delay(500);

		for (const node of nodes) {
			let n = node[1];
			n.placeholderEl?.detach();
			n.containerEl?.appendChild(n.contentEl);
			n.render();
		}

		for (const edge of edges) {
			await edge[1].render();
		}

		let contentEl = view.contentEl;
		const canvasEl = contentEl.querySelector(".canvas");

		if (!canvasEl)
		{
			console.log(contentEl.innerHTML);
			return failRender(view.file, "Failed to render canvas! Canvas element not found!");	
		}

		const edgeContainer = canvasEl.createEl("svg", { cls: "canvas-edges" });
		const edgeHeadContainer = canvasEl.createEl("svg", { cls: "canvas-edges" });

		for (const pair of nodes) {
			const node = pair[1]; // value is the node
			const nodeEl = node.nodeEl;
			const nodeFile: TFile | undefined = node.file ?? undefined;
			const embedEl = nodeEl.querySelector(".markdown-embed-content.node-insert-event");
			const childPreview = node?.child?.previewMode;

			const optionsCopy = Object.assign({}, options);
			optionsCopy.container = embedEl;
			optionsCopy.unifyTitleFormat = (nodeFile && nodeFile != view.file) ?? false;

			if (nodeFile && embedEl && childPreview) {
				embedEl.innerHTML = "";

				if ((options.inlineHTML || !allExportedPaths.contains(nodeFile.path)) && childPreview) {
					console.log("Inlining child preview", nodeFile.path);
					if (childPreview.owner) {
						childPreview.owner.file =
							childPreview.file ??
							childPreview.owner.file ??
							view.file;
					}
					childPreview.owner.file =
						childPreview.file ??
						childPreview.owner.file ??
						view.file;
				}

				await renderMarkdownView(childPreview, optionsCopy);
			}

			if (node.url) {
				const iframe = node.contentEl?.createEl("iframe");
				if (iframe) {
					iframe.src = node.url;
					iframe.classList.add("canvas-link");
					iframe.setAttribute("style", "border:none; width:100%; height:100%;");
					iframe.setAttribute("title", "Canvas card with embedded webpage: " + node.url);
				}
			}

			await delay(100);
		}

		for (const edge of edges) {
			const edgeEl = edge[1].lineGroupEl;
			const headEl = edge[1].lineEndGroupEl;

			edgeContainer.appendChild(edgeEl);
			edgeHeadContainer.appendChild(headEl);

			if (edge[1].label) {
				const labelEl = edge[1].labelElement.wrapperEl;
				canvasEl.appendChild(labelEl);
			}
		}


		if (checkCancelled()) return undefined;

		for (const pair of nodes) {
			const node = pair[1];
			const nodeEl = node.nodeEl;
			canvasEl.appendChild(nodeEl);
		}

		let newContentEl: HTMLElement;
		if (options.createDocumentContainer === false) {
			newContentEl = canvasEl.cloneNode(true) as HTMLElement;
		}
		else {
			newContentEl = contentEl.cloneNode(true) as HTMLElement;
		}

		newContentEl?.querySelector(".mod-zoomed-out")?.classList?.remove("mod-zoomed-out");

		options.container?.appendChild(newContentEl);


		return newContentEl;
	}

	export async function createMediaPage(file: TFile, options: MarkdownRendererOptions): Promise<HTMLElement> {
		const contentEl = batchDocument.body.createDiv({ attr: { class: "obsidian-document" } });
		const embedType = MarkdownRendererAPI.extentionToTag(file.extension);

		let media = contentEl.createEl(embedType);

		if (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement)
			media.controls = true;

		let path = file.path;
		if (file.extension == "html") {
			let pathObj = new Path(path);
			pathObj.setFileName(pathObj.basename + "-content");
		}
		media.src = file.path;

		options.container?.appendChild(contentEl);
		contentEl.appendChild(media);
		return contentEl;
	}

	export async function postProcessHTML(html: HTMLElement, options: MarkdownRendererOptions) {
		if (!html.classList.contains("obsidian-document")) {
			const viewContainer = (html.classList.contains("view-content") || html.classList.contains("markdown-preview-view")) ? html : html.querySelector(".view-content, .markdown-preview-view");
			if (!viewContainer) {
				ExportLog.error("Failed to find view container in rendered HTML!");
				return;
			}

			viewContainer.classList.add("obsidian-document");
		}

		// remove the extra elements if they are not wanted
		if (!options.keepModHeaderFooter) {
			html.querySelectorAll(".mod-header, .mod-footer").forEach((e: HTMLElement) => e.remove());
		}

		// add .heading to every header
		html.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((element: HTMLElement) => {
			element.classList.add("heading");
		});

		// transclusions put a div inside a p tag, which is invalid html. Fix it here
		html.querySelectorAll("p:has(> .inline-embed.markdown-embed)").forEach((element) => {
			const elParent = element.parentElement as HTMLElement;
			const span = batchDocument.body.createEl("span");
			span.style.display = "block";
			span.style.marginBlockStart = "var(--p-spacing)";
			span.style.marginBlockEnd = "var(--p-spacing)";

			span.innerHTML = element.innerHTML;
			element.remove();
			let embed = span.querySelector(".inline-embed.markdown-embed") as HTMLElement;
			embed.innerHTML = elParent.innerHTML;
			elParent.innerHTML = "";
			elParent.appendChild(span);
		});

		// encode all text input values into attributes
		html.querySelectorAll("input[type=text]").forEach((element: HTMLElement) => {
			// @ts-ignore
			element.setAttribute("value", element.value);
			// @ts-ignore
			element.value = "";
		});

		// encode all text area values into text content
		html.querySelectorAll("textarea").forEach((element: HTMLElement) => {
			// @ts-ignore
			element.textContent = element.value;
		});

		// convert tag href to search query
		html.querySelectorAll("a.tag").forEach((element: HTMLAnchorElement) => {
			const split = element.href.split("#");
			const tag = split[1] ?? element.href.substring(1); // remove the #
			element.setAttribute("data-href", element.getAttribute("href") ?? "");
			element.setAttribute("href", `?query=tag:${tag}`);
		});

		// convert all hard coded image / media widths into max widths
		html.querySelectorAll("img, video, .media-embed:has( > :is(img, video))").forEach((element: HTMLElement) => {
			const width = element.getAttribute("width");
			if (width) {
				element.removeAttribute("width");
				element.style.width = (width.trim() != "") ? (width + "px") : "";
				element.style.maxWidth = "100%";
			}
		});

		// replace obsidian's pdf embeds with normal embeds
		html.querySelectorAll("span.internal-embed.pdf-embed").forEach((pdf: HTMLElement) => {
			const embed = batchDocument.body.createEl("embed");
			embed.setAttribute("src", pdf.getAttribute("src") ?? "");
			embed.style.width = pdf.style.width || '100%';
			embed.style.maxWidth = "100%";
			embed.style.height = pdf.style.height || '800px';

			const container = pdf.parentElement?.parentElement;

			container?.querySelectorAll("*").forEach((el) => el.remove());

			if (container) container.appendChild(embed);
		});

		// remove all MAKE.md elements
		html.querySelectorAll("div[class^='mk-']").forEach((element: HTMLElement) => {
			element.remove();
		});

		// move frontmatter before markdown-preview-sizer
		const frontmatter = html.querySelector(".frontmatter");
		if (frontmatter) {
			const frontmatterParent = frontmatter.parentElement;
			const sizer = html.querySelector(".markdown-preview-sizer");
			if (sizer) {
				sizer.before(frontmatter);
			}
			frontmatterParent?.remove();
		}

		// add lazy loading to iframe elements
		html.querySelectorAll("iframe").forEach((element: HTMLIFrameElement) => {
			element.setAttribute("loading", "lazy");
		});

		// add collapse icons to lists if they don't already have them
		const collapsableListItems = Array.from(html.querySelectorAll("li:has(ul), li:has(ol)"));
		for (const item of collapsableListItems) {
			let collapseIcon = item.querySelector(".collapse-icon");
			if (!collapseIcon) {
				collapseIcon = item.createDiv({ cls: "list-collapse-indicator collapse-indicator collapse-icon" });
				collapseIcon.innerHTML = this.arrowHTML;
				item.prepend(collapseIcon);
			}
		}

		// if the dynamic table of contents plugin is included on this page
		// then parse each list item and render markdown for it
		const tocEls = Array.from(html.querySelectorAll(".block-language-toc.dynamic-toc li > a"));
		for (const element of tocEls) {
			const renderEl = batchDocument.body.createDiv();
			renderSimpleMarkdown(element.textContent ?? "", renderEl);
			element.textContent = renderEl.textContent;
			renderEl.remove();
		}

		// Keep text-default symbols (↔™…) as text-sized glyphs instead of oversized color emoji
		IconHandler.forceTextPresentationInElement(html);
	}

	export async function beginBatch(options: MarkdownRendererOptions) {
		if (batchStarted) return;

		errorInBatch = false;
		cancelled = false;
		batchStarted = true;
		loadingContainer = undefined;
		logContainer = undefined;
		logShowing = false;
		excalidrawSvgCache.clear();
		excalidrawSvgInflight.clear();
		excalidrawEmbedLocations.clear();
		batchDocument.open();
		if (!batchDocument.body) {
			batchDocument.write("<body></body>");
		}

		renderLeaf = TabManager.openNewTab("tab", "horizontal", true);
		markdownView = new MarkdownView(renderLeaf);

		// @ts-ignore
		const parentFound = await waitUntil(() => (renderLeaf && renderLeaf.parent) || checkCancelled(), 2000, 1);
		if (!parentFound) {
			try {
				renderLeaf.detach();
			}
			catch (e) {
				ExportLog.error(e, "Failed to detach render leaf: ");
			}

			if (!checkCancelled()) {
				new Notice("Error: Failed to create leaf for rendering!");
				throw new Error("Failed to create leaf for rendering!");
			}

			return;
		}

		const obsidianWindow = renderLeaf.view.containerEl.win;
		// @ts-ignore
		electronWindow = obsidianWindow.electronWindow as electron.BrowserWindow;
		electronWindow.webContents.setBackgroundThrottling(false);

		document.body.classList.add("html-export-running");

		if (overlayProgress)
			createLoadingContainer();
	}

	export function cancelExport() {
		if (!batchStarted || cancelled) return;

		cancelled = true;
		endBatch();
	}

	export function endBatch() {
		if (!batchStarted) return;

		document.body.classList.remove("html-export-running");
		electronWindow?.webContents.setBackgroundThrottling(true);

		if (renderLeaf) {
			if (!errorInBatch) {
				ExportLog.log("Closing render window");
				renderLeaf.detach();
			}
			else {
				ExportLog.warning("Error in batch, leaving render window open");
				_reportProgress(1, "Completed with errors", "Please see the log for more details.", errorColor);

				// make sure the button still closes the leaf
				const closebutton = loadingContainer?.querySelector(".html-progress-cancel") as HTMLButtonElement;
				const localRenderLeaf = renderLeaf;
				closebutton.onclick = () => localRenderLeaf?.detach();
				closebutton.textContent = "Close";
			}
		}

		electronWindow?.setProgressBar(-1);

		electronWindow = undefined;
		renderLeaf = undefined;
		loadingContainer = undefined;
		fileListContainer = undefined;
		excalidrawSvgCache.clear();
		excalidrawSvgInflight.clear();
		excalidrawEmbedLocations.clear();

		batchStarted = false;
	}

	function generateLogEl(title: string, message: any, textColor: string, backgroundColor: string): HTMLElement {
		const logEl = batchDocument.body.createEl("div");
		logEl.className = "html-progress-log-item";
		logEl.style.display = "flex";
		logEl.style.flexDirection = "column";
		logEl.style.marginBottom = "2px";
		logEl.style.fontSize = "12px";
		logEl.innerHTML =
			`
		<div class="html-progress-log-title" style="font-weight: bold; margin-left: 1em;"></div>
		<div class="html-progress-log-message" style="margin-left: 2em; font-size: 0.8em;white-space: pre-wrap;"></div>
		`;
		logEl.querySelector(".html-progress-log-title")!.textContent = title;
		logEl.querySelector(".html-progress-log-message")!.textContent = message.toString();

		logEl.style.color = textColor;
		logEl.style.backgroundColor = backgroundColor;
		logEl.style.borderLeft = `5px solid ${textColor}`;
		logEl.style.borderBottom = "1px solid var(--divider-color)";
		logEl.style.borderTop = "1px solid var(--divider-color)";

		return logEl;
	}

	function createLoadingContainer() {
		if (!loadingContainer) {
			loadingContainer = batchDocument.body.createDiv();
			loadingContainer.outerHTML =
				`
			<div class="html-progress-wrapper">
				<div class="html-progress-content">
					<div class="html-progress-inner">
						<h1>Generating HTML</h1>
						<progress class="html-progress-bar" value="0" min="0" max="1"></progress>
						<span class="html-progress-sub"></span>
						<button class="html-progress-cancel">Cancel</button>
					</div>
					<div class="html-progress-log">
						<h1>Export Log</h1>
					</div>
				</div>
			</div>
			`
			loadingContainer = batchDocument.querySelector(".html-progress-wrapper") as HTMLElement;
			let cancelButton = loadingContainer.querySelector(".html-progress-cancel") as HTMLButtonElement;
			cancelButton.onclick = () => cancelExport();

			// @ts-ignore
			renderLeaf.containerEl.before(loadingContainer);
		}
	}

	let logShowing = false;
	function appendLogEl(logEl: HTMLElement) {
		logContainer = loadingContainer?.querySelector(".html-progress-log") ?? undefined;

		if (!logContainer || !renderLeaf) {
			console.error("Failed to append log element, log container or render leaf is undefined!");
			return;
		}

		if (!logShowing) {
			renderLeaf.view.containerEl.win.resizeTo(1000, 500);
			logContainer.style.display = "flex";
			logShowing = true;
		}

		logContainer.appendChild(logEl);
		// @ts-ignore
		logEl.scrollIntoView({ behavior: "instant", block: "end", inline: "end" });
	}

	export async function _reportProgress(fraction: number, message: string, subMessage: string, progressColor: string) {
		if (!batchStarted) return;

		// @ts-ignore
		if (!renderLeaf?.parent?.parent) return;

		// @ts-ignore
		const loadingContainer = renderLeaf.parent.parent.containerEl.querySelector(`.html-progress-wrapper`);
		if (!loadingContainer) return;

		const progressBar = loadingContainer.querySelector("progress");
		if (progressBar) {
			progressBar.value = fraction;
			progressBar.style.backgroundColor = "transparent";
			progressBar.style.color = progressColor;
		}


		const messageElement = loadingContainer.querySelector("h1");
		if (messageElement) {
			messageElement.innerText = message;
		}

		const subMessageElement = loadingContainer.querySelector("span.html-progress-sub") as HTMLElement;
		if (subMessageElement) {
			subMessageElement.innerText = subMessage;
		}

		electronWindow?.setProgressBar(fraction);
	}

	export async function _setFileList(items: string[], options: { icons?: string[] | string, renderAsMarkdown?: boolean, title?: string }) {
		const contaienr = loadingContainer?.querySelector(".html-progress-content") as HTMLElement;
		if (!contaienr) return;

		const fileList = new SimpleFileListGenerator(items, options);
		const fileListEl = await fileList.generate(contaienr);
		contaienr.prepend(fileListEl);
		if (fileListContainer) fileListContainer.remove();
		fileListContainer = fileListEl;
	}

	export async function _reportError(messageTitle: string, message: any, fatal: boolean) {
		if (!batchStarted) return;

		errorInBatch = true;

		// @ts-ignore
		const found = await waitUntil(() => renderLeaf && renderLeaf.parent && renderLeaf.parent.parent, 100, 10);
		if (!found) return;

		appendLogEl(generateLogEl(messageTitle, message, errorColor, errorBoxColor));

		if (fatal) {
			renderLeaf = undefined;
			loadingContainer = undefined;
			logContainer = undefined;
		}
	}

	export async function _reportWarning(messageTitle: string, message: any) {
		if (!batchStarted) return;

		// @ts-ignore
		const found = await waitUntil(() => renderLeaf && renderLeaf.parent && renderLeaf.parent.parent, 100, 10);
		if (!found) return;

		appendLogEl(generateLogEl(messageTitle, message, warningColor, warningBoxColor));
	}

	export async function _reportInfo(messageTitle: string, message: any) {
		if (!batchStarted) return;

		// @ts-ignore
		const found = await waitUntil(() => renderLeaf && renderLeaf.parent && renderLeaf.parent.parent, 100, 10);
		if (!found) return;

		appendLogEl(generateLogEl(messageTitle, message, infoColor, infoBoxColor));
	}

}

export namespace ExportLog {
	export let fullLog: string = "";
	let totalProgress = 1;
	let currentProgress = 0;

	function logToString(message: any, title: string) {
		const messageString = (typeof message === "string") ? message : JSON.stringify(message).replaceAll("\n", "\n\t\t");
		const titleString = title != "" ? title + "\t" : "";
		const log = `${titleString}${messageString}\n`;
		return log;
	}

	function humanReadableJSON(object: any) {
		// remove any properties starting with info_
		object = SettingsPage.deepCopy(object);
		object = SettingsPage.deepRemoveStartingWith(object, "info_");
		object = SettingsPage.deepRemoveStartingWith(object, "filesToExport");
		object = SettingsPage.deepRemoveStartingWith(object, "alwaysEnabled");
		object = SettingsPage.deepRemoveStartingWith(object, "featureId");
		const string = JSON.stringify(object, null, 2);
		return string;
	}

	export function log(message: any, messageTitle: string = "") {
		pullPathLogs();

		messageTitle = `[INFO] ${messageTitle}`
		fullLog += logToString(message, messageTitle);

		if (messageTitle != "") console.log(messageTitle + " ", message);
		else console.log(message);

		if (SettingsPage.loaded && !(Settings.logLevel == "all")) return;

		_MarkdownRendererInternal._reportInfo(messageTitle, message);
	}

	export function warning(message: any, messageTitle: string = "") {
		pullPathLogs();

		messageTitle = `[WARNING] ${messageTitle}`
		fullLog += logToString(message, messageTitle);

		if (messageTitle != "") console.warn(messageTitle + " ", message);
		else console.warn(message);

		if (SettingsPage.loaded && !["warning", "all"].contains(Settings.logLevel)) return;

		_MarkdownRendererInternal._reportWarning(messageTitle, message);
	}

	export function error(message: any, messageTitle: string = "", fatal: boolean = false) {
		pullPathLogs();

		messageTitle = (fatal ? "[FATAL ERROR] " : "[ERROR] ") + messageTitle;
		fullLog += logToString(message, messageTitle);

		if (fatal && messageTitle == "Error") messageTitle = "Fatal Error";
		if (messageTitle != "") console.error(messageTitle + " ", message);
		else console.error(message);

		if (SettingsPage.loaded && !fatal && !["error", "warning", "all"].contains(Settings.logLevel)) return;

		_MarkdownRendererInternal._reportError(messageTitle, message, fatal);
	}

	export function addToProgressCap(progress: number) {
		totalProgress += progress;
	}

	export function resetProgress() {
		totalProgress = 1;
		currentProgress = 0;
	}

	export function progress(progressBy: number, message: string, subMessage: string, progressColor: string = "var(--interactive-accent)") {
		currentProgress += progressBy;
		setProgress(currentProgress / totalProgress, message, subMessage, progressColor);
	}

	export function setProgress(fraction: number, message: string, subMessage: string, progressColor: string = "var(--interactive-accent)") {
		fullLog += logToString({ fraction, message, subMessage }, "Progress");
		pullPathLogs();
		_MarkdownRendererInternal._reportProgress(fraction, message, subMessage, progressColor);
	}

	export function setFileList(items: string[], options: { icons?: string[] | string, renderAsMarkdown?: boolean, title?: string }) {
		_MarkdownRendererInternal._setFileList(items, options);
	}

	function pullPathLogs() {
		const logs = Path.dequeueLog();
		for (const thisLog of logs) {
			switch (thisLog.type) {
				case "info":
					log(thisLog.message, thisLog.title);
					break;
				case "warn":
					warning(thisLog.message, thisLog.title);
					break;
				case "error":
					error(thisLog.message, thisLog.title, false);
					break;
				case "fatal":
					error(thisLog.message, thisLog.title, true);
					break;
			}
		}
	}

	export function getDebugInfo() {
		let debugInfo = "";

		debugInfo += `Log:\n${fullLog}\n\n`;

		debugInfo += `Settings:\n${humanReadableJSON({ ...Settings })}\n\n`;

		// @ts-ignore
		const loadedPlugins = Object.values(app.plugins.plugins).filter((plugin) => plugin._loaded == true).map((plugin) => plugin.manifest.name).join("\n\t");
		debugInfo += `Enabled Plugins:\n\t${loadedPlugins}`;

		return debugInfo;
	}

	export function testThrowError(chance: number) {
		if (Math.random() < chance) {
			throw new Error("Test error");
		}
	}

	export function isCancelled() {
		return _MarkdownRendererInternal.checkCancelled();
	}
}

