# Cascade Resource Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entry-file cascade exports copy linked non-page files into `resources/` and keep generated note pages in the existing entry/`links/` layout.

**Architecture:** Extend the cascade resolver into a page/resource classifier, then make `Website` copy cascade resources before page rendering so existing link rewriting can find them in the index. Keep normal exports unchanged by gating all new path and save behavior behind `cascadeContext`.

**Tech Stack:** TypeScript, Obsidian plugin APIs (`TFile`, metadata cache), existing `Website`, `Webpage`, `Attachment`, and frontend `LinkHandler` pipeline.

---

## File Structure

- Modify `src/plugin/cascade-export-resolver.ts`: classify cascade files into rendered page files and copied resource files.
- Modify `src/plugin/exporter.ts`: pass only cascade page files into the page build and save cascade resources alongside combined HTML.
- Modify `src/plugin/utils/downloadable.ts`: allow trusted resource attachments to preserve raw `.html/.htm` filenames.
- Modify `src/plugin/website/website.ts`: build resource target paths under `resources/`, create resource attachments, and expose resource downloads.
- Modify `src/plugin/website/index.ts`: avoid inlining cascade resource bytes into combined HTML metadata.
- Modify `src/frontend/main/website.ts`: distinguish generated documents from known non-page files.
- Modify `src/frontend/main/links.ts`: let resource links follow normal browser behavior instead of client-side page navigation.

## Task 1: Classify Cascade Pages And Resources

**Files:**
- Modify: `src/plugin/cascade-export-resolver.ts`

- [ ] **Step 1: Extend cascade context types**

In `src/plugin/cascade-export-resolver.ts`, replace the current imports and context shape with this structure:

```ts
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

export class CascadeExportContext
{
	public readonly entryFile: TFile;
	public readonly entrySourcePath: string;
	public readonly files: TFile[];
	public readonly pageFiles: TFile[];
	public readonly resourceFiles: TFile[];
	public readonly nodes: Map<string, CascadeExportNode>;
	private readonly resourceSourcePaths: Set<string>;

	constructor(entryFile: TFile, pageFiles: TFile[], resourceFiles: TFile[], nodes: Map<string, CascadeExportNode>)
	{
		this.entryFile = entryFile;
		this.entrySourcePath = entryFile.path;
		this.files = pageFiles;
		this.pageFiles = pageFiles;
		this.resourceFiles = resourceFiles;
		this.nodes = nodes;
		this.resourceSourcePaths = new Set(resourceFiles.map((file) => file.path));
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
```

- [ ] **Step 2: Update collection logic**

Replace `collect()` with this implementation. It keeps BFS traversal only for page files and records resources without traversing them:

```ts
public static collect(entryFile: TFile): CascadeExportContext
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

		for (const linkedFile of this.getLinkedFiles(file))
		{
			if (!this.isCascadePageFile(linkedFile))
			{
				if (!resourceSourcePaths.has(linkedFile.path))
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

	return new CascadeExportContext(entryFile, pageFiles, resourceFiles, nodes);
}
```

- [ ] **Step 3: Add page classification helper**

Add this private helper inside `CascadeExportResolver`:

```ts
private static isCascadePageFile(file: TFile): boolean
{
	if (!MarkdownRendererAPI.isConvertable(file.extension)) return false;
	return !MarkdownRendererAPI.viewableMediaExtensions.contains(file.extension);
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/plugin/cascade-export-resolver.ts
git commit -m "Classify cascade resource files"
```

## Task 2: Copy Cascade Resources Under `resources/`

**Files:**
- Modify: `src/plugin/utils/downloadable.ts`
- Modify: `src/plugin/website/website.ts`

- [ ] **Step 1: Let resource attachments preserve `.html` filenames**

In `src/plugin/utils/downloadable.ts`, update the `Attachment` constructor signature and rename guard:

```ts
constructor(
	data: string | Buffer,
	target: Path,
	source: TFile | undefined | null,
	options: ExportPipelineOptions,
	preserveExportRoot: boolean = false,
	preserveHtmlFileName: boolean = false
)
{
	// @ts-ignore
	if (target.extensionName == "html" && !preserveHtmlFileName && !Object.getPrototypeOf(this).constructor.name.contains("Webpage")) target.setFileName(target.basename + "-content");
	if (target.isDirectory) throw new Error("target must be a file: " + target.path);
	if (target.isAbsolute) throw new Error("(absolute) Target must be a relative path with the working directory set to the root: " + target.path);
	this.preserveExportRoot = preserveExportRoot;
	this.exportOptions = options;
	this.source = source ?? null;
	this.data = data;
	this.targetPath = target;
}
```

- [ ] **Step 2: Add resource path helpers to `Website`**

In `src/plugin/website/website.ts`, add a constant near the imports:

```ts
const cascadeResourceFolderName = "resources";
```

Update `getCascadeTargetPathForFile()` so resources route to `resources/` and pages route to the existing entry/`links/` layout:

```ts
public getCascadeTargetPathForFile(file: TFile, filename?: string): Path
{
	const targetPath = new Path(file.path);
	if (filename) targetPath.fullName = filename;
	targetPath.setWorkingDirectory((this.destination ?? Path.vaultPath.joinString("Web Export")).path);

	if (this.cascadeContext?.isResource(file.path))
	{
		targetPath.reparse(Path.joinStrings(cascadeResourceFolderName, file.path).path);
		if (filename) targetPath.fullName = filename;
	}
	else if (this.cascadeContext && !this.cascadeContext.isEntry(file.path))
	{
		targetPath.reparse(Path.joinStrings("links", file.path).path);
		if (filename) targetPath.fullName = filename;
	}

	targetPath.slugify(this.exportOptions.slugifyPaths);
	return targetPath;
}
```

- [ ] **Step 3: Add attachment creation helper**

In `src/plugin/website/website.ts`, add this method before `createAttachmentFromSrc()`:

```ts
public async createAttachmentForFile(file: TFile, target?: Path, preserveHtmlFileName: boolean = false): Promise<Attachment | undefined>
{
	const data = Buffer.from(await app.vault.readBinary(file));
	const attachmentTarget = target ?? new Path(file.path, this.destination.path).slugify(this.exportOptions.slugifyPaths);
	return new Attachment(data, attachmentTarget, file, this.exportOptions, false, preserveHtmlFileName);
}
```

- [ ] **Step 4: Add cascade resources to the index before page rendering**

In `src/plugin/website/website.ts`, add this method before `buildTemplate()`:

```ts
private async loadCascadeResourceFiles(): Promise<void>
{
	if (!this.cascadeContext) return;

	for (const file of this.cascadeContext.resourceFiles)
	{
		const target = this.getCascadeTargetPathForFile(file);
		const attachment = await this.createAttachmentForFile(file, target, true);
		if (!attachment) continue;

		attachment.showInTree = false;
		await this.index.addFile(attachment, true);
	}
}
```

Then call it in `load()` immediately after `this.webpageTemplate` is created and before the `for (const file of this.sourceFiles)` loop:

```ts
await this.loadCascadeResourceFiles();
```

- [ ] **Step 5: Reuse resource paths when creating attachments from rendered src links**

Replace `createAttachmentFromSrc()` with this implementation:

```ts
public async createAttachmentFromSrc(src: string, sourceFile: TFile): Promise<Attachment | undefined>
{
	const attachedFile = this.getFilePathFromSrc(src, sourceFile.path);
	if (attachedFile.isDirectory) return;

	const file = app.vault.getFileByPath(attachedFile.pathname);
	if (file && this.cascadeContext?.isResource(file.path))
	{
		const target = this.getCascadeTargetPathForFile(file);
		return await this.createAttachmentForFile(file, target, true);
	}

	let path = file?.path ?? "";
	if (!file) path = AssetHandler.mediaPath.joinString(attachedFile.fullName).path;
	const data: Buffer | undefined = await attachedFile.readAsBuffer();

	if (!data) return;

	const target = new Path(path, this.destination.path)
						.slugify(this.exportOptions.slugifyPaths);

	const attachment = new Attachment(data, target, file, this.exportOptions);
	if (!attachment.sourcePath) attachment.sourcePath = attachedFile.pathname;
	return attachment;
}
```

- [ ] **Step 6: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/plugin/utils/downloadable.ts src/plugin/website/website.ts
git commit -m "Copy cascade resources to resources folder"
```

## Task 3: Save Resources Beside Combined HTML

**Files:**
- Modify: `src/plugin/exporter.ts`
- Modify: `src/plugin/website/website.ts`
- Modify: `src/plugin/website/index.ts`

- [ ] **Step 1: Pass only page files to the website build**

In `src/plugin/exporter.ts`, change the cascade export call from `cascadeContext.files` to `cascadeContext.pageFiles`:

```ts
const website = await HTMLExporter.exportFiles(
	cascadeContext.pageFiles,
	exportPath,
	true,
	Settings.deleteOldFiles,
	exportRoot,
	cascadeContext
);
```

- [ ] **Step 2: Expose cascade resource downloads**

In `src/plugin/website/website.ts`, add this public method before `saveAsCombinedHTML()`:

```ts
public getCascadeResourceDownloads(): Attachment[]
{
	if (!this.cascadeContext) return [];

	return this.index.allFiles.filter((file) =>
		!(file instanceof Webpage)
		&& this.cascadeContext?.isResource(file.sourcePath)
	);
}
```

- [ ] **Step 3: Download resources for combined single-file cascade exports**

In `src/plugin/exporter.ts`, update the combined branch inside `exportFiles()`:

```ts
if (Settings.exportOptions.combineAsSingleFile)
{
	await website.saveAsCombinedHTML();
	await Utils.downloadAttachments(website.getCascadeResourceDownloads());
}
else
{
	await Utils.downloadAttachments(website.index.newFiles.filter((f) => !(f instanceof Webpage)));
	await Utils.downloadAttachments(website.index.updatedFiles.filter((f) => !(f instanceof Webpage)));

	if (Settings.exportPreset != ExportPreset.RawDocuments)
	{
		await Utils.downloadAttachments([website.index.websiteDataAttachment()]);
		await Utils.downloadAttachments([website.index.indexDataAttachment()]);
	}
}
```

- [ ] **Step 4: Do not inline cascade resource bytes into combined HTML metadata**

In `src/plugin/website/index.ts`, update the `if (this.exportOptions.combineAsSingleFile)` block in `addAttachmentToWebsiteData()`:

```ts
const shouldInlineAttachmentData = this.exportOptions.combineAsSingleFile
	&& !this.website.cascadeContext?.isResource(attachment.sourcePath);

if (shouldInlineAttachmentData)
{
	if (attachment.data instanceof Buffer) fileInfo.data = attachment.data.toString("base64");
	else fileInfo.data = attachment.data.toString();
}
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/plugin/exporter.ts src/plugin/website/website.ts src/plugin/website/index.ts
git commit -m "Save cascade resources beside combined HTML"
```

## Task 4: Let Resource Links Use Browser Behavior

**Files:**
- Modify: `src/frontend/main/website.ts`
- Modify: `src/frontend/main/links.ts`

- [ ] **Step 1: Add a file existence helper**

In `src/frontend/main/website.ts`, add this method immediately after `documentExists()`:

```ts
public fileExists(url: string): boolean {
	url = LinkHandler.getPathnameFromURL(url);
	if (this.isHttp) {
		return !!this.metadata.fileInfo[url];
	} else {
		return !!this.getFileData(url)?.exportPath;
	}
}
```

- [ ] **Step 2: Only intercept generated document links**

In `src/frontend/main/links.ts`, keep the existing `target == "null"` guard first, then add these constants immediately after that guard:

```ts
const target = link.getAttribute("href") ?? "null";

if(target == "null")
{
	console.log("No target found for link");
	return;
}

const isExternal = LinkHandler.isExternalURL(target);
const isDocument = !isExternal && ObsidianSite.documentExists(target);
const isKnownFile = !isExternal && ObsidianSite.fileExists(target);
```

Then update the click handler condition:

```ts
if (ObsidianSite.supportsClientSideHistory && isDocument)
{
	event.preventDefault();
	event.stopPropagation();
	ObsidianSite.loadURL(target);
}
```

Finally update the unresolved marker condition:

```ts
if(target && !isExternal && !isKnownFile)
{
	link.classList.add("is-unresolved");
}
else if (link.classList.contains("internal-link") && isDocument)
{
	if (!ObsidianSite.metadata?.ignoreMetadata
		&& ObsidianSite.metadata?.featureOptions?.linkPreview?.enabled)
	{
		FilePreviewPopover.initializeLink(link, target);
	}
}
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/frontend/main/website.ts src/frontend/main/links.ts
git commit -m "Let cascade resources open as files"
```

## Task 5: Final Verification

**Files:**
- Read: `docs/superpowers/specs/2026-06-08-cascade-resource-export-design.md`
- Read: `git diff HEAD~4..HEAD`

- [ ] **Step 1: Run build**

Run:

```bash
npm run build
```

Expected: command exits `0`.

- [ ] **Step 2: Run diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output and exit `0`.

- [ ] **Step 3: Confirm no test script exists**

Run:

```bash
npm test
```

Expected: npm reports `Missing script: "test"` because this repository currently has no test command.

- [ ] **Step 4: Inspect final changed files**

Run:

```bash
git status --short
```

Expected: only intentional local files are listed. The local `manifest.json` development rename may remain unstaged and must not be committed.

- [ ] **Step 5: Manual export checks in Obsidian**

Use an entry note with links to these files:

```md
[[Notes/Sub/Page]]
[[Files/report.pdf]]
[[Files/archive.zip]]
[[Files/document.docx]]
[[Web/example.html]]
```

Expected export output for combined single-file mode:

```text
<export folder>/<site name>.html
<export folder>/resources/Files/report.pdf
<export folder>/resources/Files/archive.zip
<export folder>/resources/Files/document.docx
<export folder>/resources/Web/example.html
```

Expected link behavior:

```text
Notes/Sub/Page opens through client-side page navigation.
Files/report.pdf opens as a PDF file.
Files/archive.zip follows browser or OS archive behavior.
Files/document.docx follows browser or OS document behavior.
Web/example.html opens as the copied standalone HTML file.
```
