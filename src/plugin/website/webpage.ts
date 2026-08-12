import { FrontMatterCache, TFile } from "obsidian";
import { Path } from "src/plugin/utils/path";
import { Attachment } from "src/plugin/utils/downloadable";
import { OutlineTree } from "src/plugin/features/outline-tree";
import { Website } from "./website";
import { _MarkdownRendererInternal, ExportLog } from "src/plugin/render-api/render-api";
import { MarkdownRendererAPI } from "src/plugin/render-api/render-api";
import { ExportPipelineOptions } from "src/plugin/website/pipeline-options.js";
import { CascadeBreadcrumbItem, DocumentType } from "src/shared/website-data";
import { Settings } from "src/plugin/settings/settings";
import { AssetHandler } from "src/plugin/asset-loaders/asset-handler";
import { Shared } from "src/shared/shared";
import { moment } from "obsidian";
import { Utils } from "src/plugin/utils/utils";
import { clipRenderedContentToH1Section } from "src/plugin/utils/h1-split";
import { compressImageToDataUri, getCompressOptionsForLevel, toDataUri } from "src/plugin/utils/image-compressor";

export class WebpageOutputData
{
	public html: string = "";
	public title: string = "";
	public icon: string = "";
	public description: string = "";
	public author: string = "";
	public fullURL: string = "";
	public rssDate: string = "";
	public pathToRoot: string = "";
	public coverImageURL: string = "";
	public allTags: string[] = [];
	public inlineTags: string[] = [];
	public frontmatterTags: string[] = [];
	public aliases: string[] = [];
	public backlinks: Webpage[] = [];
	public headings: {heading: string, level: number, id: string, headingEl: HTMLElement}[] = [];
	public renderedHeadings: {heading: string, level: number, id: string}[] = [];
	public descriptionOrShortenedContent: string = "";
	public searchContent: string = "";
	public srcLinks: string[] = [];
	public hrefLinks: string[] = [];
	public linksToOtherFiles: string[] = [];
	public cascadeBreadcrumbs: CascadeBreadcrumbItem[] | undefined = undefined;
	public isCascadeEntry: boolean = false;
}

export class Webpage extends Attachment
{
	public get source(): TFile
	{
		return super.source as TFile;
	}

	public set source(file: TFile)
	{
		super.source = file;
	}

	public website: Website;
	public pageDocument: Document = document.implementation.createHTMLDocument();
	public attachments: Attachment[] = [];
	public type: DocumentType = DocumentType.Markdown;
	public title: string = "";
	public icon: string = "";

	/**
	 * @param file The original markdown file to export
	 * @param destination The absolute path to the FOLDER we are exporting to
	 * @param name The name of the file being exported without the extension
	 * @param website The website this file is part of
	 * @param options The options for exporting this file
	 */
	constructor(file: TFile, filename: string, website: Website, options?: ExportPipelineOptions)
	{
		if (!MarkdownRendererAPI.isConvertable(file.extension)) throw new Error("File type not supported: " + file.extension);

		const targetPath = website.getTargetPathForFile(file, filename);
		options = Object.assign(Settings.exportOptions, options);

		super("", targetPath, file, options, website.cascadeContext != undefined && !website.cascadeContext.isEntry(file.path));
		this.targetPath.setExtension("html");
		this.exportOptions = options;
		this.source = file;
		this.website = website;

		if (this.exportOptions.flattenExportPaths) 
			this.targetPath.parent = Path.emptyPath;
	}

	public outputData: WebpageOutputData = new WebpageOutputData();

	public async generateOutput()
	{
		const output = new WebpageOutputData();
		let stepStartedAt = Date.now();
		ExportLog.log("Output: serializing HTML...");
		output.html = this.html;
		ExportLog.log(`Output: HTML serialized in ${Date.now() - stepStartedAt}ms (${output.html.length} chars)`);

		output.title = this.title;
		output.icon = this.icon;

		stepStartedAt = Date.now();
		ExportLog.log("Output: building description...");
		output.description = this.descriptionOrShortenedContent;
		ExportLog.log(`Output: description finished in ${Date.now() - stepStartedAt}ms`);

		output.author = this.author;
		output.fullURL = this.fullURL;
		output.rssDate = this.rssDate;
		output.pathToRoot = this.pathToRoot.path;
		output.coverImageURL = this.coverImageURL ?? "";
		output.allTags = this.allTags;
		output.frontmatterTags = this.frontmatterTags;
		output.aliases = this.aliases;
		output.backlinks = this.backlinks;
		output.headings = this.headings;

		stepStartedAt = Date.now();
		ExportLog.log("Output: rendering headings...");
		output.renderedHeadings = await this.getRenderedHeadings();
		ExportLog.log(`Output: headings finished in ${Date.now() - stepStartedAt}ms`);

		output.descriptionOrShortenedContent = output.description;

		stepStartedAt = Date.now();
		ExportLog.log("Output: building search content...");
		output.searchContent = this.searchContent;
		ExportLog.log(`Output: search content finished in ${Date.now() - stepStartedAt}ms`);

		output.srcLinks = this.srcLinks;
		output.hrefLinks = this.hrefLinks;
		output.linksToOtherFiles = this.linksToOtherFiles;
		output.cascadeBreadcrumbs = await this.getCascadeBreadcrumbs();
		output.isCascadeEntry = this.website.cascadeContext?.isEntry(this.source.path) ?? false;

		this.data = output.html;

		this.outputData = output;
	}

	private async getCascadeBreadcrumbs(): Promise<CascadeBreadcrumbItem[] | undefined>
	{
		const context = this.website.cascadeContext;
		const node = context?.getNode(this.source.path);
		if (!context || !node) return undefined;

		const crumbs: CascadeBreadcrumbItem[] = [];
		for (const sourcePath of node.breadcrumbSourcePaths)
		{
			const crumbNode = context.getNode(sourcePath);
			if (!crumbNode) continue;

			const webpage = this.website.index.getWebpage(sourcePath);
			const title = webpage?.title || (await _MarkdownRendererInternal.getTitleForFile(crumbNode.file)).title;
			const path = webpage?.targetPath.path ?? this.website.getTargetPathForFile(crumbNode.file).setExtension("html").path;

			crumbs.push({
				title,
				path,
				isEntry: context.isEntry(sourcePath),
			});
		}

		return crumbs;
	}

	private get searchContent(): string
	{
		const contentElement = this.sizerElement ?? this.viewElement ?? this.pageDocument?.body;
		if (!contentElement)
		{
			return "";
		}

		const skipSelector = ".math, svg, img, .frontmatter, .metadata-container, .heading-after, style, script, .excalidraw-svg, .excalidraw-plugin, img.excalidraw-export-img";
		function getTextNodes(element: HTMLElement): Node[]
		{
			const textNodes = [];
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
	
			let node;
			while (node = walker.nextNode()) 
			{
				if (node.parentElement?.closest(skipSelector))
				{
					continue;
				}

				textNodes.push(node);
			}
	
			return textNodes;
		}

		const textNodes = getTextNodes(contentElement);

		let content = '';
		for (const node of textNodes) 
		{
			content += ' ' + node.textContent + ' ';
		}

		content += this.hrefLinks.join(" ");
		content += this.srcLinks.join(" ");

		content = content.trim().replace(/\s+/g, ' ');

		return content;
	}

	/**
	 * The HTML string for the file
	 */
	private get html(): string
	{
		// Strip long data URIs before serialize — registry holds the only copy.
		for (const el of Array.from(this.pageDocument.querySelectorAll("[data-media-pending-strip], [data-media-id]")))
		{
			const src = el.getAttribute("src") ?? "";
			if (src.startsWith("data:") || el.hasAttribute("data-media-pending-strip"))
			{
				el.removeAttribute("src");
			}
			el.removeAttribute("data-media-pending-strip");
		}
		const htmlString = "<!DOCTYPE html> " + this.pageDocument.documentElement.outerHTML;
		return htmlString;
	}

	/**
	 * The element that contains the content of the document, aka the markdown-preview-view or view-content
	 */
	private get viewElement(): HTMLElement | undefined
	{
		return this.pageDocument.querySelector(".obsidian-document") as HTMLElement;
	}

	/**
	 * The element that determines the size of the document, aka the markdown-preview-sizer
	 */
	private get sizerElement(): HTMLElement | undefined
	{
		return (this.pageDocument.querySelector(".canvas-wrapper") ?? this.pageDocument.querySelector(".markdown-preview-sizer") ?? this.pageDocument.querySelector(".obsidian-document")) as HTMLElement | undefined;
	}

	/**
	 * The header eleent which holds the title and various other non-body text info
	 */
	private get headerElement(): HTMLElement | undefined
	{
		return this.pageDocument.querySelector(".header") as HTMLElement | undefined;
	}

	/**
	 * The footer element which holds the footer text
	 */
	private get footerElement(): HTMLElement | undefined
	{
		return this.pageDocument.querySelector(".footer") as HTMLElement | undefined;
	}

	/**
	 * The relative path from exportPath to rootFolder
	 */
	private get pathToRoot(): Path
	{
		const ptr = Path.getRelativePath(this.targetPath, new Path(this.targetPath.workingDirectory), true);
		return ptr;
	}

	private get allTags(): string[]
	{
		const tags = this.frontmatterTags.concat(this.inlineTags);

		// remove duplicates
		const uniqueTags = tags.filter((tag, index) => tags.indexOf(tag) == index);

		return uniqueTags;
	}

	private get frontmatterTags(): string[]
	{
		let tags: string[] = [];
		const frontmatterTags = this.frontmatter?.tags || [];
		
		// if frontmatter.tags is not an array, make it an array
		if(!Array.isArray(frontmatterTags)){
			tags = [String(frontmatterTags)];
		} else {
			tags = frontmatterTags.map((tag) => String(tag));
		}

		// if a tag doesn't start with a #, add it
		tags = tags.map(tag => tag.startsWith("#") ? tag : "#" + tag);
		
		return tags;
	}

	private get inlineTags(): string[]
	{
		const tagCaches = app.metadataCache.getFileCache(this.source)?.tags?.values();
		const tags: string[] = [];
		if (tagCaches)
		{
			tags.push(...Array.from(tagCaches).map((tag) => tag.tag));
		}

		return tags;
	}

	public get headings(): {heading: string, level: number, id: string, headingEl: HTMLElement}[]
	{
		const headers: {heading: string, level: number, id: string, headingEl: HTMLElement}[] = [];
		if (this.pageDocument)
		{
			this.pageDocument.querySelectorAll(".heading").forEach((headerEl: HTMLElement) =>
			{
				let level = parseInt(headerEl.tagName[1]);
				if (headerEl.closest("[class^='block-language-']") || headerEl.closest(".markdown-embed.inline-embed")) level += 6;
				const heading = headerEl.getAttribute("data-heading") ?? headerEl.innerText ?? "";
				headers.push({heading, level, id: headerEl.id, headingEl: headerEl});
			});
		}

		return headers;
	}

	private async getRenderedHeadings(): Promise<{ heading: string; level: number; id: string; }[]>
	{
		const headings = this.headings.map((header) => {return {heading: header.heading, level: header.level, id: header.id}});
		
		for (const header of headings)
		{
			const h = await MarkdownRendererAPI.renderMarkdownSimple(header.heading) ?? header.heading;
			header.heading = h;
		}

		return headings;
	}

	private get aliases(): string[]
	{
		const aliases = this.frontmatter?.aliases ?? [];
		return aliases;
	}

	private get description(): string
	{
		return this.frontmatter["description"] || this.frontmatter["summary"] || "";
	}

	private get descriptionOrShortenedContent(): string
	{
		let description = this.description;
		let localThis = this;

		if (!description)
		{
			if(!this.viewElement) return "";
			const content = this.viewElement.cloneNode(true) as HTMLElement;
			// Heavy media/svg copies dominate export time and are useless for descriptions.
			content.querySelectorAll(`h1, h2, h3, h4, h5, h6, .mermaid, table, mjx-container, style, script, svg,
.excalidraw-svg, .excalidraw-plugin, .mod-header, .mod-footer, .metadata-container, .frontmatter,
img, video, audio, canvas`).forEach((heading) => heading.remove());

			// update image links
			content.querySelectorAll("[src]").forEach((el: HTMLImageElement) => 
			{
				let src = el.getAttribute("src");
				if (!src) return;
				if (src.startsWith("http") || src.startsWith("data:")) return;
				if (src.startsWith("data:")) 
				{
					el.remove();
					return;
				}
				src = src.replace("app://obsidian", "");
				src = src.replace(".md", "");
				const path = Path.joinStrings(this.exportOptions.rssOptions.siteUrl ?? "", src);
				el.setAttribute("src", path.path);
			});

			// update normal links
			content.querySelectorAll("[href]").forEach((el: HTMLAnchorElement) => 
			{
				let href = el.getAttribute("href");
				if (!href) return; 
				if (href.startsWith("http") || href.startsWith("data:")) return;
				href = href.replace("app://obsidian", "");
				href = href.replace(".md", "");
				const path = Path.joinStrings(this.exportOptions.rssOptions.siteUrl ?? "", href);
				el.setAttribute("href", path.path);
			});

			function keepTextLinksImages(element: HTMLElement) 
			{
				const walker = localThis.pageDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
				let node;
				const nodes = [];
				while (node = walker.nextNode()) 
				{
					if (node.nodeType == Node.ELEMENT_NODE)
					{
						const element = node as HTMLElement;
						if (element.tagName == "A" || element.tagName == "IMG" || element.tagName == "BR")
						{
							nodes.push(element);
						}

						if (element.tagName == "DIV")
						{
							const classes = element.parentElement?.classList;
							if (classes?.contains("heading-children") || classes?.contains("markdown-preview-sizer"))
							{
								nodes.push(document.createElement("br"));
							}
						}

						if (element.tagName == "LI") 
						{
							nodes.push(document.createElement("br"));
						}
					}
					else
					{
						if (node.parentElement?.tagName != "A" && node.parentElement?.tagName != "IMG")
							nodes.push(node);
					}
				}

				element.innerHTML = "";
				element.append(...nodes);
			}

			
			keepTextLinksImages(content);

			//remove subsequent br tags
			content.querySelectorAll("br").forEach((br: HTMLElement) => 
			{
				const next = br.nextElementSibling;
				if (next?.tagName == "BR") br.remove();
			});

			// remove br tags at the start and end of the content
			const first = content.firstElementChild;
			if (first?.tagName == "BR") first.remove();
			const last = content.lastElementChild;
			if (last?.tagName == "BR") last.remove();

			description = content.innerHTML;
			// Keep descriptions short — full HTML here previously ballooned with media.
			if (description.length > 2000) description = description.slice(0, 2000);
			content.remove();
		}

		// remove multiple whitespace characters in a row
		description = description.replace(/\s{2,}/g, " ");

		return description ?? "";
	}

	private get author(): string
	{
		return this.frontmatter["author"] || this.exportOptions.rssOptions.authorName || "";
	}

	private get fullURL(): string
	{
		const url = Path.joinStrings(this.exportOptions.rssOptions.siteUrl ?? "", this.targetPath.path).path;
		return url;
	}

	private get rssDate(): string
	{
		// if it has a date in the frontmatter, use that
		const date = this.frontmatter[Settings.rssDateProperty];
		console.log(date);
		if (date) return date;

		// if it doesn't, use the file's modified date
		const mtimeMs = this.source.stat.mtime;
		const rssDate = new Date(mtimeMs).toISOString();
		return rssDate;
	}

	private get backlinks(): Webpage[]
	{
		// @ts-ignore
		const backlinks = Array.from(app.metadataCache.getBacklinksForFile(this.source)?.data?.keys?.() || []);
		let linkedWebpages = backlinks.map((path: string) => this.website.index.getWebpage(path)) as Webpage[];
		linkedWebpages = linkedWebpages.filter((page) => page != undefined);
		return linkedWebpages;
	}

	private get coverImageURL(): string | undefined
	{
		if (!this.viewElement) return undefined;
		const images = Array.from(this.viewElement.querySelectorAll("img")) as HTMLImageElement[];
		let mediaPathStr = "";
		for (const img of images)
		{
			if (img.classList.contains("is-broken-image")) continue;
			const src = img.getAttribute("src") ?? "";
			if (!src || src.startsWith("data:")) continue;
			mediaPathStr = src;
			break;
		}
		if (!mediaPathStr) return undefined;

		if (!mediaPathStr.startsWith("http") && !mediaPathStr.startsWith("data:"))
		{
			// Use getFilePathFromSrc to properly resolve app:// URLs and other paths
			const resolvedPath = this.website.getFilePathFromSrc(mediaPathStr, this.source.path);
			const attachment = this.website.index.getFile(resolvedPath.pathname, true);
			
			if (attachment) {
				mediaPathStr = attachment.targetPath.path;
			} else {
				// Fallback to resolved path if attachment not found
				mediaPathStr = resolvedPath.path;
			}
			
			const mediaPath = Path.joinStrings(this.exportOptions.rssOptions.siteUrl ?? "", mediaPathStr);
			mediaPathStr = mediaPath.path;
		}

		return mediaPathStr;
	}

	private get frontmatter(): FrontMatterCache
	{
		const frontmatter = app.metadataCache.getFileCache(this.source)?.frontmatter ?? {};
		return frontmatter;
	}

	private get srcLinks(): string[]
	{
		const srcEls = this.srcLinkElements.map((item) => item.getAttribute("src")) as string[];
		return srcEls;
	}
	private get hrefLinks(): string[]
	{
		const hrefEls = this.hrefLinkElements.map((item) => item.getAttribute("href")) as string[];
		return hrefEls;
	}
	private get srcLinkElements(): HTMLImageElement[]
	{
		// Only real media hosts — never SVG <image>/Excalidraw internals.
		// Skip already-inlined data URIs (getAttribute copies megabytes of base64).
		const srcEls = Array.from(this.pageDocument.querySelectorAll(
			".obsidian-document img[src], .obsidian-document video[src], .obsidian-document audio[src], .obsidian-document source[src], .obsidian-document embed[src]"
		)) as HTMLImageElement[];
		return srcEls.filter((el) => {
			if (el.closest("head, .excalidraw-svg, .excalidraw-plugin")) return false;
			if (el.hasAttribute("data-media-id") || el.hasAttribute("data-media-pending-strip")) return false;
			const src = el.getAttribute("src") ?? "";
			return !src.startsWith("data:") && !src.startsWith("blob:");
		});
	}
	private get hrefLinkElements(): HTMLAnchorElement[]
	{
		// Only anchors. Generic [href] also matches SVG <image href>/<use href> inside
		// Excalidraw and stalls when those attributes hold large data URIs.
		return Array.from(this.pageDocument.querySelectorAll(
			".obsidian-document a[href], .obsidian-document area[href]"
		)).filter((el) => !el.closest("head, .excalidraw-svg, .excalidraw-plugin")) as HTMLAnchorElement[];
	}

	/**
	 * Temporarily detach Excalidraw SVG subtrees so querySelectorAll/remap don't walk
	 * thousands of vector nodes and huge data-URI attributes.
	 */
	private withExcalidrawDetached<T>(fn: () => T): T
	{
		const stubs: { host: Element; parent: Node; next: ChildNode | null }[] = [];
		const hosts = Array.from(this.pageDocument.querySelectorAll(".excalidraw-svg, .excalidraw-plugin, img.excalidraw-export-img"));
		for (const host of hosts)
		{
			if (!host.parentNode) continue;
			stubs.push({ host, parent: host.parentNode, next: host.nextSibling });
			host.remove();
		}
		try
		{
			return fn();
		}
		finally
		{
			for (const { host, parent, next } of stubs)
			{
				parent.insertBefore(host, next);
			}
		}
	}
	private get linksToOtherFiles(): string[]
	{
		const links = this.hrefLinks;
		const otherFiles = links.filter((link) => !link.startsWith("#") && !link.startsWith(Shared.libFolderName + "/") && !link.startsWith("http") && !link.startsWith("data:"));
		return otherFiles;
	}

	public async build(): Promise<Webpage | undefined>
	{
		let isMedia = MarkdownRendererAPI.viewableMediaExtensions.contains(this.source.extension);
		if (isMedia) this.type = DocumentType.Attachment;
		
		this.viewElement?.setAttribute("data-type", this.type);

		// get title and icon
		const titleInfo = await _MarkdownRendererInternal.getTitleForFile(this.source);
		const iconInfo = await _MarkdownRendererInternal.getIconForFile(this.source);
		const displayTitle = this.website.cascadeContext?.isEntry(this.source.path)
			? this.website.cascadeContext.entryDisplayTitle
			: undefined;
		this.title = displayTitle || titleInfo.title;
		this.icon = iconInfo.icon;
		this.icon = await MarkdownRendererAPI.renderMarkdownSimple(this.icon) ?? this.icon;
	

		if (this.exportOptions.inlineMedia) 
		{
			try
			{
				ExportLog.log(`Inlining media for ${this.source.path}...`);
				const startedAt = Date.now();
				await this.inlineMedia();
				ExportLog.log(`Inline media finished in ${Date.now() - startedAt}ms`);
			}
			catch (error)
			{
				ExportLog.warning(error, `Problem inlining media for ${this.source.path}; continuing without broken embeds`);
			}
		}

		if (this.exportOptions.addHeadTag)
		{
			ExportLog.log("Adding document head...");
			const startedAt = Date.now();
			await this.addHead();
			ExportLog.log(`Add head finished in ${Date.now() - startedAt}ms`);
		}

		if (this.exportOptions.fixLinks)
		{
			ExportLog.log("Remapping links...");
			let startedAt = Date.now();
			this.remapLinks();
			ExportLog.log(`remapLinks finished in ${Date.now() - startedAt}ms`);
			startedAt = Date.now();
			this.remapEmbedLinks();
			ExportLog.log(`remapEmbedLinks finished in ${Date.now() - startedAt}ms`);
		}

		// add math styles to the document. They are here and not in <head> because they are unique to each document
		if (this.exportOptions.addMathjaxStyles && this.type != DocumentType.Attachment)
		{
			ExportLog.log("Adding mathjax styles...");
			const mathStyleEl = document.createElement("style");
			mathStyleEl.id = "MJX-CHTML-styles";
			await AssetHandler.mathjaxStyles.load();
			mathStyleEl.innerHTML = AssetHandler.mathjaxStyles.data as string;
			this.viewElement?.prepend(mathStyleEl);
		}

		// inject outline
		if (this.exportOptions.outlineOptions.enabled)
		{
			ExportLog.log("Generating outline...");
			const startedAt = Date.now();
			const headerTree = new OutlineTree(this, 1);
			headerTree.id = "outline";
			headerTree.title = "Table Of Contents";
			headerTree.showNestingIndicator = false;
			headerTree.generateWithItemsClosed = this.exportOptions.outlineOptions.startCollapsed === true;
			headerTree.minCollapsableDepth = this.exportOptions.outlineOptions.minCollapseDepth ?? 2;
			this.exportOptions.outlineOptions.insertFeature(this.pageDocument.documentElement, await headerTree.generate());
			ExportLog.log(`Outline finished in ${Date.now() - startedAt}ms`);
		}

		// if html will be inlined, un-collapse the tree containing this file
		const fileExplorer = this.pageDocument.querySelector("#file-explorer");
		if (fileExplorer && this.exportOptions.fileNavigationOptions.exposeStartingPath && this.exportOptions.inlineHTML)
		{
			const unixPath = this.targetPath.path;
			let fileElement: HTMLElement = fileExplorer?.querySelector(`[href="${unixPath}"]`) as HTMLElement;
			fileElement = fileElement?.closest(".tree-item") as HTMLElement;
			while (fileElement)
			{
				fileElement?.classList.remove("is-collapsed");
				const children = fileElement?.querySelector(".tree-item-children") as HTMLElement;
				if(children) children.style.display = "block";
				fileElement = fileElement?.parentElement?.closest(".tree-item") as HTMLElement;
			}
		}

		if (this.exportOptions.includeJS)
		{
			ExportLog.log("Injecting body JS...");
			const bodyScript = this.pageDocument.createElement("script");
			bodyScript.setAttribute("defer", "");
			// textContent (not innerText) — innerText can surface script source in print.
			bodyScript.textContent = AssetHandler.themeLoadJS.data.toString();
			this.pageDocument.head.appendChild(bodyScript);
		}

		this.pageDocument.documentElement.lang = moment.locale();

		ExportLog.log("Generating webpage output data...");
		const outputStartedAt = Date.now();
		await this.generateOutput();
		ExportLog.log(`Generate output finished in ${Date.now() - outputStartedAt}ms`);

		return this;
	}

	public async renderDocument(): Promise<Webpage | undefined>
	{
		this.pageDocument.documentElement.innerHTML = this.website.webpageTemplate.getDocElementInner();

		// render the file
		const centerContent = this.pageDocument.querySelector("#center-content") as HTMLElement;
		if (!centerContent) return undefined;

		const options = {...this.exportOptions, container: centerContent};
		// Always render the real vault file (never setViewData on it). For H1-split
		// entry pages, clip the preview DOM to the target section afterwards.
		const renderInfo = await MarkdownRendererAPI.renderFile(this.source, options);

		const contentEl = renderInfo?.contentEl;
		if (!contentEl) return undefined;
		if (MarkdownRendererAPI.checkCancelled()) return undefined;

		// set the document's type
		this.type = (renderInfo?.viewType as DocumentType) ?? DocumentType.Markdown;

		if (this.type == "markdown")
		{
			contentEl.classList.toggle("allow-fold-headings", this.exportOptions.documentOptions.allowFoldingHeadings);
			contentEl.classList.toggle("allow-fold-lists", this.exportOptions.documentOptions.allowFoldingLists);
			contentEl.classList.add("is-readable-line-width");

			const cssclasses = this.frontmatter['cssclasses'];
			if (cssclasses && cssclasses.length > 0) contentEl.classList.add(...cssclasses);

			const sectionIndex = this.website.cascadeContext?.isEntry(this.source.path)
				? this.website.cascadeContext.entrySectionIndex
				: undefined;
			if (sectionIndex !== undefined)
				clipRenderedContentToH1Section(contentEl, sectionIndex);
		}

		if(this.sizerElement) this.sizerElement.style.paddingBottom = "";

		return this;
	}

	public async getAttachments(): Promise<Attachment[]>
	{
		const sources = this.srcLinks;
		for (const src of sources)
		{
			if ((!src.startsWith("app://") && /\w+:(\/\/|\\\\)/.exec(src)) || // link is a URL except for app://
				src.startsWith("data:") || // link is a data URL
				src.startsWith("blob:") || // temporary browser object URLs are handled by inlineMedia
				Utils.isExternalUrl(src))
			continue;

			try
			{
				const sourcePath = this.website.getFilePathFromSrc(src, this.source.path).pathname;
				let attachment = this.attachments.find((attachment) => attachment.sourcePath == sourcePath);
				attachment ??= this.website.index.getFile(sourcePath);
				attachment ??= await this.website.createAttachmentFromSrc(src, this.source);
				
				if (!sourcePath || !attachment)
				{
					ExportLog.log("Attachment source not found: " + src);
					continue;
				}

				if (!this.attachments.includes(attachment)) 
					this.attachments.push(attachment);
			}
			catch (error)
			{
				ExportLog.warning(error, `Skipping attachment that failed to load: ${src}`);
			}
		}

		return this.attachments;
	}

	public resolveLink(link: string | null, linkEl: HTMLElement, preferAttachment: boolean = false): string | undefined
	{
		if (!link) return "";
		if ((!link.startsWith("app://") && /\w+:(\/\/|\\\\)/.exec(link)))
			return;
		if (link.startsWith("data:"))
			return;
		if (link.startsWith("blob:"))
			return;
		if (link?.startsWith("?")) 
			return;
		if (link.startsWith("mailto:"))
			return;

		if (link.startsWith("#"))
		{
			let headerText = (linkEl?.getAttribute("data-href") ?? link).replaceAll(" ", "_").replaceAll(":", "").replaceAll("__", "_").substring(1);
			
			// Only apply numbering if this header is in the headerMap (i.e., it's an actual header)
			if (this.headerMap.has(headerText)) {
				let hrefValue = `#${headerText}_${this.headerMap.get(headerText)}`;
				if (!this.exportOptions.relativeHeaderLinks)
					hrefValue = this.targetPath + hrefValue;
				return hrefValue;
			}
			
			// For non-header links (like footnotes), return the link unchanged
			return link;
		}

		const linkSplit = link.split("#")[0].split("?")[0];
		const attachmentPath = this.website.getFilePathFromSrc(linkSplit, this.source.path);
		const attachment = this.website.index.getFile(attachmentPath.pathname, preferAttachment);
		if (!attachment)
		{
			// otherwise resolve it as best as possible
			const resolved = attachmentPath.slugify(this.exportOptions.slugifyPaths).setExtension("html");
			return resolved.path;
		}

		let hash = (linkEl?.getAttribute("data-href") ?? link).split("#")[1] ?? "";
		if (hash != "") hash = "#" + hash;

		if (attachment instanceof Webpage && attachment.targetPath.extensionName == "html")
		{
			const headerText = hash.replaceAll(" ", "_").replaceAll(":", "").replaceAll("__", "_").substring(1);
			// Only apply numbering if this header is in the headerMap
			if (this.headerMap.has(headerText)) {
				const headerId = this.headerMap.get(headerText);
				hash = `#${headerText}_${headerId}`;
			}
			// Otherwise keep the hash unchanged (for footnotes, etc.)
		}

		return attachment.targetPath.path + hash;
	}

	readonly headerMap = new Map();
	private remapLinks()
	{
		this.withExcalidrawDetached(() => {
			ExportLog.log("remapLinks: indexing headers...");
			// convert the data-heading to the id
			this.pageDocument
				.querySelectorAll(".obsidian-document h1, .obsidian-document h2, .obsidian-document h3, .obsidian-document h4, .obsidian-document h5, .obsidian-document h6")
				.forEach((headerEl) => {
					let headerText = (headerEl.getAttribute("data-heading") ?? headerEl.textContent ?? "").replaceAll(" ", "_").replaceAll(":", "").replaceAll("__", "_");
					let headerId = this.headerMap.get(headerText);
					if (headerId) {
						headerId = `${+headerId + 1}`;
					} else {
						headerId = "0";
					}

					this.headerMap.set(headerText, headerId);

					headerEl.setAttribute(
						"id",
						`${headerText}_${headerId}`
					);
				});

			const links = this.hrefLinkElements;
			ExportLog.log(`Remapping ${links.length} anchor href(s)...`);
			for (const link of links) {
				const href = link.getAttribute("href");
				const newHref = this.resolveLink(href, link);
				link.setAttribute("href", newHref ?? href ?? "");
				link.setAttribute("target", "_self");
				link.classList.toggle("is-unresolved", !newHref);
			}
		});
	}

	private remapEmbedLinks()
	{
		this.withExcalidrawDetached(() => {
			const links = this.srcLinkElements;
			ExportLog.log(`Remapping ${links.length} media src(s)...`);
			for (const link of links)
			{
				const src = link.getAttribute("src");
				const newSrc = this.resolveLink(src, link, true);
				link.setAttribute("src", newSrc ?? src ?? "");
				link.setAttribute("target", "_self");
				link.classList.toggle("is-unresolved", !newSrc);
			}
		});
	}

	private async addHead()
	{
		let rootPath = this.pathToRoot.slugified(this.exportOptions.slugifyPaths).path;
		if (rootPath == "") rootPath = ".";
		const description = this.description || (this.exportOptions.siteName + " - " + this.title);
		let head =
`
<title>${this.title}</title>
<base href="${rootPath}">
<meta name="pathname" content="${this.targetPath}">
<meta name="description" content="${description}">
<meta property="og:title" content="${this.title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${this.fullURL}">
<meta property="og:image" content="${this.coverImageURL}">
`;
		if (this.author && this.author != "")
		{
			head += `<meta name="author" content="${this.author}">`;
		} 

		this.pageDocument.head.innerHTML = head + this.pageDocument.head.innerHTML;
	}

	private async maybeCompressDataUri(dataUri: string): Promise<string>
	{
		const options = getCompressOptionsForLevel(this.exportOptions.imageCompressionLevel);
		if (!options) return dataUri;
		const compressed = await compressImageToDataUri(dataUri, undefined, options);
		return compressed ?? dataUri;
	}

	/**
	 * Register compressed media on the website registry and point the element
	 * at data-media-id only (long base64 lives once in the registry).
	 * Also set src immediately so ImageViewer eligibility works before hydrate
	 * in contexts where registry hydrate has not run yet (e.g. mid-build).
	 * At combine time src is stripped to short refs; hydrate restores src.
	 */
	private applyInlineMedia(mediaEl: Element, key: string, dataUri: string): void
	{
		this.website.registerInlineMedia(key, dataUri);
		mediaEl.setAttribute("data-media-id", key);
		// Keep src during page build so rendering/tools see the image; strip at combine.
		mediaEl.setAttribute("src", dataUri);
		mediaEl.setAttribute("data-media-pending-strip", "1");
	}

	private async inlineMedia()
	{
		// Skip finished exports / plugin chrome, but still catch native Excalidraw
		// preview blobs (.excalidraw-embedded-img with dead blob: URLs).
		const elements = Array.from(this.pageDocument.querySelectorAll(
			".obsidian-document img[src], .obsidian-document video[src], .obsidian-document audio[src], .obsidian-document source[src], .obsidian-document embed[src]"
		)).filter((el) => {
			if (el.closest("head, .excalidraw-plugin")) return false;
			if (el.matches("[data-export-excalidraw='1'], .excalidraw-export-img")) return false;
			if (el.closest(".excalidraw-export-slot, [data-export-excalidraw='1']")) return false;
			if (el.matches(".excalidraw-embedded-img, [filesource]")) return true;
			if (el.closest(".excalidraw-svg")) return false;
			return true;
		});
		for (const mediaEl of elements)
		{
			try
			{
				const rawSrc = mediaEl.getAttribute("src") ?? "";
				if (!rawSrc) continue;

				const fileSource = mediaEl.getAttribute("filesource") ?? "";
				const isNativeExcalidrawPreview =
					mediaEl.classList.contains("excalidraw-embedded-img") ||
					/\.excalidraw/i.test(fileSource) ||
					/\.excalidraw/i.test(rawSrc) ||
					/\.drawing(\b|$)/i.test(rawSrc);

				if (isNativeExcalidrawPreview)
				{
					const host = (mediaEl.closest(".excalidraw-svg, .internal-embed, .markdown-embed, .media-embed") as HTMLElement | null) ?? mediaEl;
					if (host.querySelector("[data-export-excalidraw='1']") || host.classList.contains("excalidraw-export-slot")) continue;
					ExportLog.log(`Removing native Excalidraw preview media: ${(fileSource || rawSrc).slice(0, 160)}`);
					host.remove();
					continue;
				}

				if (rawSrc.startsWith("blob:"))
				{
					try
					{
						const response = await fetch(rawSrc);
						if (!response.ok)
						{
							this.markBrokenMediaElement(mediaEl, rawSrc);
							continue;
						}

						const blob = await response.blob();
						const buffer = Buffer.from(await blob.arrayBuffer());
						const type = blob.type || "application/octet-stream";
						const dataUri = await this.maybeCompressDataUri(toDataUri(type, buffer));
						const key = `blob:${rawSrc}`;
						this.applyInlineMedia(mediaEl, key, dataUri);
					}
					catch
					{
						this.markBrokenMediaElement(mediaEl, rawSrc);
					}
					continue;
				}

				// External http(s) embeds: inline when reachable; otherwise show broken-image placeholder
				if (Utils.isExternalUrl(rawSrc))
				{
					const dataUri = await Utils.fetchAsDataUri(rawSrc);
					if (!dataUri)
					{
						this.markBrokenMediaElement(mediaEl, rawSrc);
						continue;
					}
					const compressed = await this.maybeCompressDataUri(dataUri);
					this.applyInlineMedia(mediaEl, `url:${rawSrc}`, compressed);
					continue;
				}

				if (rawSrc.startsWith("data:")) continue;

				const filePath = this.website.getFilePathFromSrc(rawSrc, this.source.path);
				const vaultFileEarly = !filePath.isEmpty
					? app.vault.getFileByPath(filePath.pathname)
					: null;
				if (vaultFileEarly && MarkdownRendererAPI.isExcalidrawFile(vaultFileEarly))
				{
					if (mediaEl.matches("[data-export-excalidraw='1'], .excalidraw-export-img")) continue;
					const host = (mediaEl.closest(".internal-embed, .markdown-embed, .media-embed, .excalidraw-svg") as HTMLElement | null) ?? mediaEl;
					if (host.querySelector("[data-export-excalidraw='1']")) continue;
					ExportLog.log(`Removing leftover Excalidraw media file node: ${vaultFileEarly.path}`);
					host.remove();
					continue;
				}

				if (filePath.isEmpty || filePath.isDirectory || filePath.isAbsolute) continue;

				const base64 = await filePath.readAsString("base64");
				if (!base64)
				{
					this.markBrokenMediaElement(mediaEl, rawSrc);
					continue;
				}

				let ext = filePath.extensionName;

				//@ts-ignore
				const registryType = app.viewRegistry.typeByExtension[ext];
				const imageExtensions = new Set([
					"png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "apng",
				]);
				const type = imageExtensions.has(ext)
					? "image"
					: (registryType ?? "application");

				if (ext === "svg") ext += "+xml";

				const dataUri = await this.maybeCompressDataUri(`data:${type}/${ext};base64,${base64}`);
				const vaultFile = app.vault.getFileByPath(filePath.pathname);
				const key = vaultFile
					? `vault:${vaultFile.path}`
					: `path:${filePath.pathname || filePath.path}`;
				this.applyInlineMedia(mediaEl, key, dataUri);
			}
			catch (error)
			{
				const rawSrc = mediaEl.getAttribute("src") ?? "";
				ExportLog.warning(error, `Using broken-image placeholder for media: ${rawSrc}`);
				this.markBrokenMediaElement(mediaEl, rawSrc);
			}
		};
	}

	private markBrokenMediaElement(mediaEl: Element, src: string)
	{
		ExportLog.warning(`Media URL unreachable, using broken-image placeholder: ${src}`);
		mediaEl.setAttribute("src", Utils.BROKEN_IMAGE_DATA_URI);
		mediaEl.setAttribute("data-broken-src", src);
		mediaEl.setAttribute("alt", mediaEl.getAttribute("alt") || "Broken image");
		mediaEl.classList.add("is-broken-image");
		mediaEl.setAttribute("title", `Broken image: ${src}`);
	}

	public dispose()
	{
		this.viewElement?.remove();
		// @ts-ignore
		this.pageDocument = undefined;
	}
}
