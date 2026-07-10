import { TFile } from "obsidian";
import { CascadeExportContext } from "src/plugin/cascade-export-resolver";
import { Settings } from "src/plugin/settings/settings";
import { _MarkdownRendererInternal } from "src/plugin/render-api/render-api";
import { FileTree, FileTreeItem } from "./file-tree";
import { Website } from "src/plugin/website/website";
import { Webpage } from "src/plugin/website/webpage";

type ContentParent = FileTreeItem | CascadeContentTree;

export class CascadeContentTree extends FileTree
{
	private website: Website;
	private cascadeContext: CascadeExportContext;
	private entryWebpage: Webpage | undefined;
	private entryExportPath: string;
	private headingSlugCounts = new Map<string, number>();

	public constructor(website: Website, cascadeContext: CascadeExportContext, entryWebpage: Webpage | undefined)
	{
		super([], false, false);
		this.website = website;
		this.cascadeContext = cascadeContext;
		this.entryWebpage = entryWebpage;
		this.entryExportPath = entryWebpage?.targetPath.path ?? "";
		this.renderMarkdownTitles = true;
		this.addCollapseAllButton = true;
		this.addExpandAllButton = true;
		this.addDepthControl = true;
		this.class = "cascade-content-tree ";
		this.minCollapsableDepth = 1;
		this.generateWithItemsClosed = false;
	}

	protected override async populateTree(): Promise<void>
	{
		this.children = [];
		this.pathToItem.clear();
		this.headingSlugCounts.clear();

		const entryFile = this.cascadeContext.entryFile;
		const entryIcon = (await _MarkdownRendererInternal.getIconForFile(entryFile)).icon;

		const entryRoot = new FileTreeItem(this, this, 1);
		entryRoot.title = this.cascadeContext.entryDisplayTitle || entryFile.basename;
		entryRoot.icon = entryIcon;
		entryRoot.href = this.entryExportPath;
		entryRoot.dataRef = this.entryExportPath;
		entryRoot.isEntry = true;
		entryRoot.isFolder = true;
		this.children.push(entryRoot);
		this.pathToItem.set(this.entryExportPath, entryRoot);
		this.pathToItem.set(entryFile.path, entryRoot);

		if (entryFile.extension === "md")
		{
			const markdown = this.cascadeContext.entryMarkdownOverride
				?? await app.vault.read(entryFile);
			this.parseMarkdownContent(markdown, entryFile, entryRoot, !!this.cascadeContext.entryMarkdownOverride);
		}

		this.assignContentTreeOrder();
	}

	private parseMarkdownContent(markdown: string, sourceFile: TFile, entryRoot: FileTreeItem, skipLeadingH1: boolean = false): void
	{
		const lines = this.stripFrontmatterAndCodeBlocks(markdown);
		const headingStack: { level: number; item: FileTreeItem }[] = [];
		const listStack: (FileTreeItem | undefined)[] = [];
		const listIndentWidths: number[] = [];
		let skippedLeadingH1 = false;

		for (const line of lines)
		{
			const contentLine = line.replace(/^(?:>\s*)*/, "");

			const headingMatch = contentLine.match(/^(#{1,6})\s+(.+)$/);
			if (headingMatch)
			{
				const level = headingMatch[1].length;
				const title = headingMatch[2].trim();
				listStack.length = 0;
				listIndentWidths.length = 0;

				if (skipLeadingH1 && !skippedLeadingH1 && level === 1)
				{
					skippedLeadingH1 = true;
					continue;
				}

				while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level)
					headingStack.pop();

				const parent = headingStack.length > 0
					? headingStack[headingStack.length - 1].item
					: entryRoot;

				const item = this.createTreeItem(parent, title);
				item.href = this.getHeadingHref(title);
				item.dataRef = item.href;
				item.isFolder = false;

				parent.children.push(item);
				headingStack.push({ level, item });
				continue;
			}

			const listMatch = contentLine.match(/^(\s*)(?:[-*+](?:\s+\[[ xX]\])?|\d+\.)\s+(.+)$/);
			if (listMatch)
			{
				const indentLevel = this.getListIndentLevel(listMatch[1], listIndentWidths);
				const rawContent = listMatch[2].trim();
				listStack.length = indentLevel + 1;

				const parent = indentLevel === 0
					? (headingStack.length > 0 ? headingStack[headingStack.length - 1].item : entryRoot)
					: (listStack[indentLevel - 1] ?? entryRoot);

				const linkedFile = this.extractFirstInternalLink(rawContent, sourceFile);
				const displayTitle = this.getListItemTitle(rawContent, linkedFile);

				if (linkedFile)
				{
					const exportPath = this.getExportPath(linkedFile);
					if (exportPath)
					{
						const item = this.createTreeItem(parent, displayTitle);
						item.href = exportPath;
						item.dataRef = exportPath;
						item.isFolder = false;
						parent.children.push(item);
						listStack[indentLevel] = item;
						this.pathToItem.set(exportPath, item);
						this.pathToItem.set(linkedFile.path, item);
						continue;
					}
				}

				const item = this.createTreeItem(parent, displayTitle);
				item.isFolder = true;
				parent.children.push(item);
				listStack[indentLevel] = item;
			}
		}

		this.finalizeFolderStates(entryRoot);
	}

	private finalizeFolderStates(item: FileTreeItem): void
	{
		for (const child of item.children)
		{
			this.finalizeFolderStates(child);
		}

		if (item.isEntry) return;

		if (item.children.length > 0)
		{
			item.isFolder = true;
		}
		else if (item.href?.includes("#"))
		{
			item.isFolder = false;
		}
		else if (!item.href)
		{
			item.isFolder = true;
		}
	}

	private createTreeItem(parent: ContentParent, title: string): FileTreeItem
	{
		const depth = parent instanceof FileTreeItem ? parent.depth + 1 : 1;
		const item = new FileTreeItem(this, parent, depth);
		item.title = title;
		return item;
	}

	private stripFrontmatterAndCodeBlocks(markdown: string): string[]
	{
		const result: string[] = [];
		let inFrontmatter = false;
		let frontmatterChecked = false;
		let inCodeBlock = false;

		for (const line of markdown.split("\n"))
		{
			if (!frontmatterChecked)
			{
				if (line.trim() === "---")
				{
					inFrontmatter = !inFrontmatter;
					if (!inFrontmatter) frontmatterChecked = true;
					continue;
				}
				if (inFrontmatter) continue;
				frontmatterChecked = true;
			}

			if (line.trim().startsWith("```"))
			{
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) continue;

			result.push(line);
		}

		return result;
	}

	private getListIndentLevel(whitespace: string, indentWidths: number[]): number
	{
		const width = this.measureIndentWidth(whitespace);

		if (indentWidths.length === 0 || width <= indentWidths[0])
		{
			indentWidths.length = 0;
			indentWidths.push(width);
			return 0;
		}

		let indentLevel = 0;
		for (let i = indentWidths.length - 1; i >= 0; i--)
		{
			if (width > indentWidths[i])
			{
				indentLevel = i + 1;
				break;
			}
		}

		if (indentWidths[indentLevel] !== width)
		{
			indentWidths.length = indentLevel + 1;
			indentWidths[indentLevel] = width;
		}

		return indentLevel;
	}

	private measureIndentWidth(whitespace: string): number
	{
		let width = 0;
		for (const char of whitespace)
			width += char === "\t" ? 4 : 1;

		return width;
	}

	private getHeadingHref(title: string): string
	{
		const slug = title.replaceAll(" ", "_").replaceAll(":", "").replaceAll("__", "_");
		const count = this.headingSlugCounts.get(slug) ?? 0;
		this.headingSlugCounts.set(slug, count + 1);
		return `${this.entryExportPath}#${slug}_${count}`;
	}

	private extractFirstInternalLink(content: string, sourceFile: TFile): TFile | undefined
	{
		if (content.includes("![[")) return undefined;

		const wikiMatch = content.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
		if (wikiMatch)
		{
			const resolved = this.resolveLink(wikiMatch[1], sourceFile);
			if (resolved) return resolved;
		}

		const mdMatch = content.match(/\[([^\]]*)\]\(([^)#]+)(?:#[^)]*)?\)/);
		if (mdMatch)
		{
			const resolved = this.resolveLink(mdMatch[2], sourceFile);
			if (resolved) return resolved;
		}

		return undefined;
	}

	private getListItemTitle(content: string, linkedFile: TFile | undefined): string
	{
		const wikiMatch = content.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
		if (wikiMatch)
			return (wikiMatch[2] ?? wikiMatch[1]).trim();

		const mdMatch = content.match(/\[([^\]]*)\]\(([^)]+)\)/);
		if (mdMatch && mdMatch[1].trim())
			return mdMatch[1].trim();

		if (linkedFile)
			return linkedFile.basename.replace(/\.md$/, "");

		return content
			.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, link, alias) => alias ?? link)
			.replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
			.replace(/[*_~`]/g, "")
			.trim();
	}

	private resolveLink(link: string | undefined, sourceFile: TFile): TFile | undefined
	{
		const linkPath = (link ?? "").split("#")[0].split("?")[0].trim();
		if (!linkPath || this.isExternalLink(linkPath)) return undefined;

		const target = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
		if (!(target instanceof TFile)) return undefined;
		if (!Settings.isPathAllowedByFilePicker(target.path)) return undefined;

		return target;
	}

	private isExternalLink(link: string): boolean
	{
		return link.startsWith("http://")
			|| link.startsWith("https://")
			|| link.startsWith("mailto:")
			|| link.startsWith("data:")
			|| (!link.startsWith("app://") && /\w+:(\/\/|\\\\)/.test(link));
	}

	private getExportPath(file: TFile): string | undefined
	{
		const webpage = this.website.index.getWebpage(file.path);
		if (webpage) return webpage.targetPath.path;

		const attachment = this.website.index.getFile(file.path, true);
		return attachment?.targetPath.path;
	}

	private assignContentTreeOrder(): void
	{
		const orderCounter = { value: 0 };
		for (const child of this.children)
			this.assignContentTreeOrderRecursive(child, orderCounter);
	}

	private assignContentTreeOrderRecursive(item: FileTreeItem, orderCounter: { value: number }): void
	{
		if (item.href)
			item.treeOrder = orderCounter.value++;

		for (const child of item.children)
			this.assignContentTreeOrderRecursive(child, orderCounter);
	}

	public override getItemBySourcePath(sourcePath: string): FileTreeItem | undefined
	{
		return this.pathToItem.get(sourcePath);
	}
}
