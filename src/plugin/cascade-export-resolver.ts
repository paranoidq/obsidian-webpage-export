import { TFile } from "obsidian";
import { Settings } from "src/plugin/settings/settings";
import { MarkdownRendererAPI } from "src/plugin/render-api/render-api";

type MetadataLink = {
	link?: string;
};

export interface CascadeExportNode
{
	file: TFile;
	sourcePath: string;
	parentSourcePath: string | null;
	depth: number;
	breadcrumbSourcePaths: string[];
	childSourcePaths: string[];
	isEntry: boolean;
}

export interface CascadeSectionOptions
{
	entryMarkdownOverride: string;
	entryOutputFileName: string;
	entryDisplayTitle: string;
	/** 0-based index among ATX H1s in the entry file (for DOM clipping after full-file render). */
	entrySectionIndex: number;
}

export class CascadeExportContext
{
	public readonly entryFile: TFile;
	public readonly entrySourcePath: string;
	public readonly files: TFile[];
	public readonly pageFiles: TFile[];
	public readonly resourceFiles: TFile[];
	public readonly nodes: Map<string, CascadeExportNode>;
	public readonly entryMarkdownOverride?: string;
	public readonly entryOutputFileName?: string;
	public readonly entryDisplayTitle?: string;
	public readonly entrySectionIndex?: number;
	private readonly resourceSourcePaths: Set<string>;

	constructor(
		entryFile: TFile,
		pageFiles: TFile[],
		resourceFiles: TFile[],
		nodes: Map<string, CascadeExportNode>,
		sectionOptions?: CascadeSectionOptions
	)
	{
		this.entryFile = entryFile;
		this.entrySourcePath = entryFile.path;
		this.files = pageFiles;
		this.pageFiles = pageFiles;
		this.resourceFiles = resourceFiles;
		this.nodes = nodes;
		this.resourceSourcePaths = new Set(resourceFiles.map((file) => file.path));
		this.entryMarkdownOverride = sectionOptions?.entryMarkdownOverride;
		this.entryOutputFileName = sectionOptions?.entryOutputFileName;
		this.entryDisplayTitle = sectionOptions?.entryDisplayTitle;
		this.entrySectionIndex = sectionOptions?.entrySectionIndex;
	}

	public getNode(sourcePath: string): CascadeExportNode | undefined
	{
		return this.nodes.get(sourcePath);
	}

	public isEntry(sourcePath: string): boolean
	{
		return sourcePath == this.entrySourcePath;
	}

	public isResource(sourcePath: string | undefined): boolean
	{
		return !!sourcePath && this.resourceSourcePaths.has(sourcePath);
	}
}

export class CascadeExportResolver
{
	public static collect(entryFile: TFile): CascadeExportContext
	{
		return this.collectInternal(entryFile);
	}

	/**
	 * Build a cascade graph scoped to links found in `sectionMarkdown` from the entry,
	 * then BFS through linked pages using normal file metadata.
	 */
	public static collectFromSection(entryFile: TFile, sectionOptions: CascadeSectionOptions): CascadeExportContext
	{
		return this.collectInternal(entryFile, sectionOptions);
	}

	private static collectInternal(entryFile: TFile, sectionOptions?: CascadeSectionOptions): CascadeExportContext
	{
		const pageFiles: TFile[] = [];
		const resourceFiles: TFile[] = [];
		const resourceSourcePaths = new Set<string>();
		const nodes = new Map<string, CascadeExportNode>();
		const pending: TFile[] = [entryFile];

		nodes.set(entryFile.path, {
			file: entryFile,
			sourcePath: entryFile.path,
			parentSourcePath: null,
			depth: 0,
			breadcrumbSourcePaths: [entryFile.path],
			childSourcePaths: [],
			isEntry: true,
		});

		while (pending.length > 0)
		{
			const file = pending.shift();
			if (!file) continue;

			const parentNode = nodes.get(file.path);
			if (!parentNode || pageFiles.some((queuedFile) => queuedFile.path == file.path)) continue;

			pageFiles.push(file);

			const linkedFiles = sectionOptions && file.path === entryFile.path
				? this.getLinkedFilesFromMarkdown(sectionOptions.entryMarkdownOverride, file)
				: this.getLinkedFiles(file);

			for (const linkedFile of linkedFiles)
			{
				if (!this.isCascadePageFile(linkedFile))
				{
					if (this.shouldExportAsCascadeResource(linkedFile) && !resourceSourcePaths.has(linkedFile.path))
					{
						resourceSourcePaths.add(linkedFile.path);
						resourceFiles.push(linkedFile);
					}
					continue;
				}

				if (!nodes.has(linkedFile.path))
				{
					nodes.set(linkedFile.path, {
						file: linkedFile,
						sourcePath: linkedFile.path,
						parentSourcePath: file.path,
						depth: parentNode.depth + 1,
						breadcrumbSourcePaths: [...parentNode.breadcrumbSourcePaths, linkedFile.path],
						childSourcePaths: [],
						isEntry: false,
					});
					pending.push(linkedFile);
				}

				if (!parentNode.childSourcePaths.includes(linkedFile.path))
					parentNode.childSourcePaths.push(linkedFile.path);
			}
		}

		return new CascadeExportContext(entryFile, pageFiles, resourceFiles, nodes, sectionOptions);
	}

	private static isCascadePageFile(file: TFile): boolean
	{
		if (!MarkdownRendererAPI.isConvertable(file.extension)) return false;
		// Excalidraw drawings are inlined as SVG in the parent page; opening them as
		// separate cascade pages forces a full Excalidraw editor load and is very slow.
		if (MarkdownRendererAPI.isExcalidrawFile(file)) return false;
		return !MarkdownRendererAPI.viewableMediaExtensions.contains(file.extension);
	}

	private static shouldExportAsCascadeResource(file: TFile): boolean
	{
		const extension = file.extension.toLowerCase();
		if (["html", "htm", "pdf"].includes(extension)) return true;
		return !MarkdownRendererAPI.isConvertable(extension);
	}

	private static getLinkedFiles(file: TFile): TFile[]
	{
		const cache = app.metadataCache.getFileCache(file);
		const metadataLinks: MetadataLink[] = [
			...(cache?.links ?? []),
			...(cache?.embeds ?? []),
		];
		const linkedFiles: TFile[] = [];
		const seen = new Set<string>();

		for (const metadataLink of metadataLinks)
		{
			const target = this.resolveLink(metadataLink.link, file);
			if (!target || seen.has(target.path)) continue;

			seen.add(target.path);
			linkedFiles.push(target);
		}

		return linkedFiles;
	}

	private static getLinkedFilesFromMarkdown(markdown: string, sourceFile: TFile): TFile[]
	{
		const linkedFiles: TFile[] = [];
		const seen = new Set<string>();
		const withoutCode = this.stripFencedCodeBlocks(markdown);

		const wikiRegex = /!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
		let wikiMatch: RegExpExecArray | null;
		while ((wikiMatch = wikiRegex.exec(withoutCode)) !== null)
		{
			const target = this.resolveLink(wikiMatch[1], sourceFile);
			if (!target || seen.has(target.path)) continue;
			seen.add(target.path);
			linkedFiles.push(target);
		}

		const mdRegex = /!?\[([^\]]*)\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g;
		let mdMatch: RegExpExecArray | null;
		while ((mdMatch = mdRegex.exec(withoutCode)) !== null)
		{
			const target = this.resolveLink(mdMatch[2], sourceFile);
			if (!target || seen.has(target.path)) continue;
			seen.add(target.path);
			linkedFiles.push(target);
		}

		return linkedFiles;
	}

	private static stripFencedCodeBlocks(markdown: string): string
	{
		const lines = markdown.replace(/\r\n/g, "\n").split("\n");
		const result: string[] = [];
		let inFence = false;
		let fenceMarker = "";

		for (const line of lines)
		{
			const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/);
			if (fenceMatch)
			{
				const ticks = fenceMatch[1];
				if (!inFence)
				{
					inFence = true;
					fenceMarker = ticks;
				}
				else if (ticks[0] === fenceMarker[0] && ticks.length >= fenceMarker.length && fenceMatch[2].trim() === "")
				{
					inFence = false;
					fenceMarker = "";
				}
				continue;
			}

			if (!inFence) result.push(line);
		}

		return result.join("\n");
	}

	private static resolveLink(link: string | undefined, sourceFile: TFile): TFile | undefined
	{
		const linkPath = this.cleanLinkPath(link);
		if (!linkPath || this.isExternalLink(linkPath)) return;

		const target = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
		if (!(target instanceof TFile)) return;
		if (!Settings.isPathAllowedByFilePicker(target.path)) return;

		return target;
	}

	private static cleanLinkPath(link: string | undefined): string
	{
		return (link ?? "")
			.split("#")[0]
			.split("?")[0]
			.trim();
	}

	private static isExternalLink(link: string): boolean
	{
		return link.startsWith("http://")
			|| link.startsWith("https://")
			|| link.startsWith("mailto:")
			|| link.startsWith("data:")
			|| (!link.startsWith("app://") && /\w+:(\/\/|\\\\)/.test(link));
	}
}
