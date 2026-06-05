# Cascade Export Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve entry-file cascade exports with `links/` page layout, entry-aware file tree, link-hierarchy breadcrumbs, and browser back/forward support for combined single-page HTML.

**Architecture:** Convert cascade export from a plain `TFile[]` collection into a `CascadeExportContext` graph model. Thread that context through `HTMLExporter` and `Website` so backend path mapping, file tree generation, and webpage metadata can read the same cascade graph. Add a small frontend breadcrumb renderer and broaden existing history integration so combined local single-page HTML supports back/forward.

**Tech Stack:** TypeScript, Obsidian plugin API, existing `Website`/`Webpage` export pipeline, existing frontend `ObsidianWebsite` document loader.

---

### Task 1: Replace Cascade File List With Cascade Context

**Files:**
- Modify: `src/plugin/cascade-export-resolver.ts`
- Modify: `src/plugin/exporter.ts`
- Modify: `src/plugin/website/website.ts`

- [ ] **Step 1: Replace resolver result types**

In `src/plugin/cascade-export-resolver.ts`, replace the current file-list-only model with these exports:

```ts
import { TFile } from "obsidian";
import { Settings } from "src/plugin/settings/settings";

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
	public readonly nodes: Map<string, CascadeExportNode>;

	constructor(entryFile: TFile, files: TFile[], nodes: Map<string, CascadeExportNode>)
	{
		this.entryFile = entryFile;
		this.entrySourcePath = entryFile.path;
		this.files = files;
		this.nodes = nodes;
	}

	public getNode(sourcePath: string): CascadeExportNode | undefined
	{
		return this.nodes.get(sourcePath);
	}

	public isEntry(sourcePath: string): boolean
	{
		return sourcePath == this.entrySourcePath;
	}
}
```

- [ ] **Step 2: Implement BFS collection with parent pointers**

Still in `src/plugin/cascade-export-resolver.ts`, replace `collect(entryFile: TFile): TFile[]` with:

```ts
export class CascadeExportResolver
{
	public static collect(entryFile: TFile): CascadeExportContext
	{
		const files: TFile[] = [];
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
			if (!parentNode || files.some((queuedFile) => queuedFile.path == file.path)) continue;

			files.push(file);

			for (const linkedFile of this.getLinkedFiles(file))
			{
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

		return new CascadeExportContext(entryFile, files, nodes);
	}
```

Keep the existing `getLinkedFiles`, `resolveLink`, `cleanLinkPath`, and `isExternalLink` helpers below this method.

- [ ] **Step 3: Thread context through exporter**

In `src/plugin/exporter.ts`, update `exportCascadeFromEntry` so it stores the context and passes `context.files`:

```ts
const cascadeContext = CascadeExportResolver.collect(entryFile);
const exportPath = overrideExportPath ?? info?.exportPath ?? new Path(Settings.exportOptions.exportPath);
const exportRoot = new Path(entryFile.path).parent?.path ?? "";

const website = await HTMLExporter.exportFiles(
	cascadeContext.files,
	exportPath,
	true,
	Settings.deleteOldFiles,
	exportRoot,
	cascadeContext
);
```

Also update the `exportFiles` signature:

```ts
public static async exportFiles(
	files: TFile[],
	destination: Path,
	saveFiles: boolean,
	deleteOld: boolean,
	exportRoot?: string,
	cascadeContext?: CascadeExportContext
) : Promise<Website | undefined>
```

Add the import:

```ts
import { CascadeExportContext, CascadeExportResolver } from "./cascade-export-resolver";
```

- [ ] **Step 4: Thread context through website load/build**

In `src/plugin/website/website.ts`, import `CascadeExportContext`:

```ts
import { CascadeExportContext } from "src/plugin/cascade-export-resolver";
```

Add a property on `Website`:

```ts
public cascadeContext: CascadeExportContext | undefined;
```

Update signatures:

```ts
public async load(files?: TFile[], exportRoot?: string, cascadeContext?: CascadeExportContext): Promise<this>
```

Inside `load`, immediately after `this.sourceFiles = files?.filter((file) => file) ?? [];`, set:

```ts
this.cascadeContext = cascadeContext;
```

Update `build`:

```ts
public async build(files?: TFile[], exportRoot?: string, cascadeContext?: CascadeExportContext): Promise<Website | undefined>
{
	if (files) await this.load(files, exportRoot, cascadeContext);
```

In `src/plugin/exporter.ts`, update the `Website.load` call:

```ts
website = await (await new Website(destination).load(files, exportRoot, cascadeContext)).build();
```

- [ ] **Step 5: Build**

Run: `npm run build`

Expected: `tsc -noEmit -skipLibCheck` completes and esbuild reports `Done`.

- [ ] **Step 6: Commit**

```bash
git add src/plugin/cascade-export-resolver.ts src/plugin/exporter.ts src/plugin/website/website.ts
git commit -m "Refactor cascade export into context graph"
```

### Task 2: Apply Cascade `links/` Paths and Entry-Aware File Tree

**Files:**
- Modify: `src/plugin/website/website.ts`
- Modify: `src/plugin/website/webpage.ts`
- Modify: `src/plugin/utils/downloadable.ts`
- Modify: `src/plugin/features/file-tree.ts`

- [ ] **Step 1: Add cascade target path helper**

In `src/plugin/website/website.ts`, add:

```ts
public getCascadeTargetPathForFile(file: TFile, filename?: string): Path
{
	const targetPath = new Path(file.path);
	if (filename) targetPath.fullName = filename;
	targetPath.setWorkingDirectory((this.destination ?? Path.vaultPath.joinString("Web Export")).path);

	if (this.cascadeContext && !this.cascadeContext.isEntry(file.path))
	{
		targetPath.reparse(Path.joinStrings("links", file.path).path);
		if (filename) targetPath.fullName = filename;
	}

	targetPath.slugify(this.exportOptions.slugifyPaths);
	return targetPath;
}
```

Then update `getTargetPathForFile` to delegate when cascade context exists:

```ts
public getTargetPathForFile(file: TFile, filename?: string): Path
{
	if (this.cascadeContext) return this.getCascadeTargetPathForFile(file, filename);

	const targetPath = new Path(file.path);
	if (filename) targetPath.fullName = filename;
	targetPath.setWorkingDirectory((this.destination ?? Path.vaultPath.joinString("Web Export")).path);
	targetPath.slugify(this.exportOptions.slugifyPaths);
	return targetPath;
}
```

- [ ] **Step 2: Prevent cascade page paths from losing `links/` prefix**

In `src/plugin/utils/downloadable.ts`, add an optional constructor parameter and property:

```ts
public preserveExportRoot: boolean = false;

constructor(data: string | Buffer, target: Path, source: TFile | undefined | null, options: ExportPipelineOptions, preserveExportRoot: boolean = false)
{
	// existing validation remains first
	this.preserveExportRoot = preserveExportRoot;
```

Update `removeRootFromPath`:

```ts
private removeRootFromPath(path: Path, allowSlugify: boolean = true)
{
	if (this.preserveExportRoot) return path;

	const root = new Path(this.exportOptions.exportRoot ?? "").slugify(allowSlugify && this.exportOptions.slugifyPaths).path + "/";
	if (path.path.startsWith(root))
	{
		path.reparse(path.path.substring(root.length));
	}
	return path;
}
```

In `src/plugin/website/webpage.ts`, update the `super` call:

```ts
super("", targetPath, file, options, website.cascadeContext != undefined);
```

In `src/plugin/website/website.ts`, when creating non-convertible/viewable attachment `Attachment`s in `load`, keep the current constructor call unchanged so attachments do not move into `links/`.

- [ ] **Step 3: Feed file tree with target paths for cascade exports**

In `src/plugin/website/website.ts`, replace the file tree `paths` line:

```ts
const paths = this.index.attachmentsShownInTree.map((file) => new Path(file.sourcePathRootRelative ?? ""));
```

with:

```ts
const paths = this.index.attachmentsShownInTree.map((file) =>
{
	if (this.cascadeContext && file.source instanceof TFile)
		return file.targetPath.copy;

	return new Path(file.sourcePathRootRelative ?? "");
});
```

Update the tree order lookup block:

```ts
const lookupPath = this.cascadeContext && file.source instanceof TFile
	? file.targetPath.path
	: file.sourcePathRootRelative;
if (!lookupPath) return;
const fileTreeItem = this.fileTree?.getItemBySourcePath(lookupPath);
```

- [ ] **Step 4: Mark entry file and collapse links folder in backend tree**

In `src/plugin/features/file-tree.ts`, add properties to `FileTree`:

```ts
public entryPath: string | undefined;
public collapsedFolderPaths: Set<string> = new Set();
```

In `FileTree.populateTree`, after `child.dataRef = section.path;`, set:

```ts
child.forceCollapsed = this.collapsedFolderPaths.has(section.path);
```

In the final-node block, after `currentParentNode.href = targetPath.path;`, add:

```ts
currentParentNode.isEntry = this.entryPath == file.path;
```

In `FileTreeItem`, add:

```ts
public isEntry = false;
public forceCollapsed = false;
```

In `insertSelf`, after the extension tag block, add:

```ts
if (this.isEntry)
{
	self.classList.add("is-cascade-entry");
	const marker = self.createDiv({ cls: "nav-file-entry-marker" });
	marker.textContent = "★";
}
```

In `insertItem`, after class toggles, add:

```ts
item.classList.toggle("is-collapsed", this.forceCollapsed);
```

- [ ] **Step 5: Set cascade tree controls in website generation**

In `src/plugin/website/website.ts`, after creating `this.fileTree`, add:

```ts
if (this.cascadeContext)
{
	const entry = this.index.attachmentsShownInTree.find((file) => file.sourcePath == this.cascadeContext?.entrySourcePath);
	this.fileTree.entryPath = entry?.targetPath.path;
	this.fileTree.collapsedFolderPaths.add("links");
}
```

Keep `this.fileTree.generateWithItemsClosed = true;` unchanged.

- [ ] **Step 6: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/plugin/website/website.ts src/plugin/website/webpage.ts src/plugin/utils/downloadable.ts src/plugin/features/file-tree.ts
git commit -m "Place cascade pages under links folder"
```

### Task 3: Add Cascade Breadcrumb Metadata and Renderer

**Files:**
- Modify: `src/shared/website-data.ts`
- Modify: `src/plugin/website/index.ts`
- Modify: `src/plugin/website/webpage.ts`
- Create: `src/frontend/main/breadcrumbs.ts`
- Modify: `src/frontend/main/document.ts`

- [ ] **Step 1: Extend shared webpage data**

In `src/shared/website-data.ts`, add:

```ts
export interface CascadeBreadcrumbItem
{
	title: string;
	path: string;
	isEntry: boolean;
}
```

Add to `WebpageData`:

```ts
cascadeBreadcrumbs?: CascadeBreadcrumbItem[];
isCascadeEntry?: boolean;
```

- [ ] **Step 2: Add backend output fields**

In `src/plugin/website/webpage.ts`, import:

```ts
import { CascadeBreadcrumbItem } from "src/shared/website-data";
```

Add to `WebpageOutputData`:

```ts
public cascadeBreadcrumbs: CascadeBreadcrumbItem[] | undefined = undefined;
public isCascadeEntry: boolean = false;
```

In `generateOutput`, before `this.data = output.html;`, set:

```ts
output.cascadeBreadcrumbs = await this.getCascadeBreadcrumbs();
output.isCascadeEntry = this.website.cascadeContext?.isEntry(this.source.path) ?? false;
```

Add method:

```ts
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
```

- [ ] **Step 3: Copy metadata into website data**

In `src/plugin/website/index.ts`, inside `addWebpageToWebsiteData`, after aliases/tags are assigned, add:

```ts
webpageInfo.cascadeBreadcrumbs = webpage.outputData.cascadeBreadcrumbs;
webpageInfo.isCascadeEntry = webpage.outputData.isCascadeEntry;
```

- [ ] **Step 4: Render breadcrumbs in frontend**

Create `src/frontend/main/breadcrumbs.ts`:

```ts
import { CascadeBreadcrumbItem } from "src/shared/website-data";

export class CascadeBreadcrumbs
{
	public static render(container: HTMLElement, breadcrumbs: CascadeBreadcrumbItem[] | undefined): void
	{
		container.querySelector(".cascade-breadcrumbs")?.remove();
		if (!breadcrumbs || breadcrumbs.length <= 1) return;

		const title = container.querySelector(".page-title");
		if (!title) return;

		const nav = document.createElement("nav");
		nav.classList.add("cascade-breadcrumbs");

		breadcrumbs.forEach((breadcrumb, index) =>
		{
			if (index > 0)
			{
				const separator = document.createElement("span");
				separator.classList.add("cascade-breadcrumb-separator");
				separator.textContent = "/";
				nav.appendChild(separator);
			}

			const isLast = index == breadcrumbs.length - 1;
			const item = document.createElement(isLast ? "span" : "a");
			item.classList.add("cascade-breadcrumb-item");
			if (breadcrumb.isEntry) item.classList.add("is-cascade-entry");
			item.textContent = breadcrumb.isEntry ? `★ ${breadcrumb.title}` : breadcrumb.title;
			if (!isLast) item.setAttribute("href", breadcrumb.path);
			nav.appendChild(item);
		});

		title.insertAdjacentElement("afterend", nav);
	}
}
```

- [ ] **Step 5: Hook breadcrumbs into document post-load**

In `src/frontend/main/document.ts`, import:

```ts
import { CascadeBreadcrumbs } from "./breadcrumbs";
```

In `postLoadInit`, after `this.findElements();`, add:

```ts
if (this.isMainDocument || this.isPreview)
	CascadeBreadcrumbs.render(this.documentEl, this.info?.cascadeBreadcrumbs);
```

No direct change is needed in `src/frontend/main/index.txt.ts`; `document.ts` is already imported by the existing frontend bundle path, and its `CascadeBreadcrumbs` import pulls the new module into the bundle.

- [ ] **Step 6: Build**

Run: `npm run build`

Expected: build succeeds and frontend bundle is regenerated.

- [ ] **Step 7: Commit**

```bash
git add src/shared/website-data.ts src/plugin/website/index.ts src/plugin/website/webpage.ts src/frontend/main/breadcrumbs.ts src/frontend/main/document.ts
git commit -m "Add cascade breadcrumb navigation"
```

### Task 4: Enable Browser History for Combined Single-Page HTML

**Files:**
- Modify: `src/frontend/main/website.ts`
- Modify: `src/frontend/main/links.ts`
- Modify: `src/frontend/main/backlinks.ts`
- Modify: `src/frontend/main/graph-view.ts`
- Modify: `src/frontend/main/link-preview.ts`

- [ ] **Step 1: Add frontend mode helper**

In `src/frontend/main/website.ts`, add:

```ts
public get supportsClientSideHistory(): boolean
{
	return !this.metadata?.ignoreMetadata && !this.isHttp;
}
```

This intentionally targets local combined HTML because HTTP multi-file exports should keep native browser navigation.

- [ ] **Step 2: Initialize history state for combined HTML**

Replace:

```ts
if (this.isHttp) {
```

near the initial `history.replaceState` with:

```ts
if (this.supportsClientSideHistory) {
```

- [ ] **Step 3: Make popstate robust**

Replace the existing popstate body in `initEvents` with:

```ts
window.addEventListener("popstate", async (e) => {
	console.log("popstate", e);
	const pathname = e.state?.pathname ?? LinkHandler.getPathnameFromURL(window.location.pathname + window.location.hash + window.location.search);
	await ObsidianSite.loadURL(pathname, false);
});
```

- [ ] **Step 4: Push history only in combined HTML**

In `loadURL`, replace:

```ts
if (this.document && this.isHttp && pushState) {
```

with:

```ts
if (this.document && this.supportsClientSideHistory && pushState) {
```

Keep the existing `history.pushState` call body that stores `{ pathname: currentPath }`, uses `this.document.title`, and writes `currentPath`.

- [ ] **Step 5: Prevent link clicks from hijacking multi-file HTTP navigation**

In `src/frontend/main/links.ts`, inside the click listener, wrap dynamic navigation:

```ts
if (ObsidianSite.supportsClientSideHistory)
{
	event.preventDefault();
	event.stopPropagation();
	ObsidianSite.loadURL(target);
}
```

Move the mobile sidebar-closing block after this conditional so it still runs for client-side navigation. For HTTP multi-file exports, let the browser follow the link normally.

- [ ] **Step 6: Guard other dynamic navigation callers**

For `src/frontend/main/backlinks.ts`, `src/frontend/main/graph-view.ts`, and `src/frontend/main/link-preview.ts`, update calls that do `ObsidianSite.loadURL(url)` after a user click:

```ts
if (ObsidianSite.supportsClientSideHistory)
	await ObsidianSite.loadURL(url);
else
	window.location.href = url;
```

Keep non-click internal preview loading paths unchanged.

- [ ] **Step 7: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/main/website.ts src/frontend/main/links.ts src/frontend/main/backlinks.ts src/frontend/main/graph-view.ts src/frontend/main/link-preview.ts
git commit -m "Support history navigation in combined HTML"
```

### Task 5: Final Verification and Manual Acceptance

**Files:**
- Read: `package.json`
- Read: `docs/superpowers/specs/2026-06-05-cascade-export-navigation-design.md`

- [ ] **Step 1: Run whitespace check**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: `tsc` and esbuild complete with exit code 0.

- [ ] **Step 3: Confirm automated test availability**

Run: `npm test`

Expected for this repository today: `Missing script: "test"`. Record this as unavailable, not as a feature failure.

- [ ] **Step 4: Manual cascade export verification in Obsidian**

Use a test vault with:

```text
Entry.md -> [[A/Page]] and [[B/Sub/Note]]
A/Page.md -> [[B/Sub/Note]]
B/Sub/Note.md -> [[Entry]]
Assets/logo.png embedded from Entry.md
```

Run the command `Export current file with linked files` from `Entry.md`.

Expected multi-file output:

```text
Entry.html
links/A/Page.html
links/B/Sub/Note.html
```

Expected attachment behavior: `Assets/logo.png` follows the existing attachment/resource path, not `links/Assets/logo.png`.

- [ ] **Step 5: Manual file tree verification**

Open the exported page.

Expected:

```text
★ Entry
▸ links
```

`links` starts collapsed. Expanding it reveals `A/Page` and `B/Sub/Note`.

- [ ] **Step 6: Manual breadcrumb verification**

Open each exported page.

Expected breadcrumbs:

```text
Entry.html: no breadcrumb or only suppressed single-item breadcrumb
links/A/Page.html: ★ Entry / Page
links/B/Sub/Note.html: ★ Entry / Page / Note
```

The cycle from `Note` back to `Entry` does not create `Entry / Page / Note / Entry`.

- [ ] **Step 7: Manual combined HTML history verification**

Switch export mode to Local Website so `combineAsSingleFile` is true.

Click from Entry to Page to Note.

Expected:

- Browser Back returns from Note to Page.
- Browser Back again returns from Page to Entry.
- Browser Forward returns to Page, then Note.
- The document body, title, active file tree item, and breadcrumb update after each navigation.

- [ ] **Step 8: Manual non-cascade regression verification**

Run a normal folder export.

Expected:

- Existing output paths are unchanged.
- No `links/` restructuring is applied.
- No cascade breadcrumb appears.
- Multi-file HTTP exports use normal browser navigation.

- [ ] **Step 9: Final commit if manual verification caused changes**

If verification required fixes, commit them:

```bash
git add src docs
git commit -m "Polish cascade export navigation"
```

If no fixes were needed, do not create an empty commit.
