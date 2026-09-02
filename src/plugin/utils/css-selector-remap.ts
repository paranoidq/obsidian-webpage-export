/**
 * Remap Obsidian app-shell selectors to the export page DOM.
 * Kept as a pure function so the rewrite rules can be unit-tested.
 */
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\[href/g, "[data-href"],
	[/\.search-input-/g, "#search-"],
	// Only strip leaf wrappers for document panes. The old pattern used
	// `.+?(markdown|…).*?]` and could span into a later attribute such as
	// `[data-path$=".excalidraw.md"]`, collapsing Border's file-icon rules
	// into a global `body ::before { -webkit-mask-image: … }` that shreds
	// blockquote accent bars.
	[
		/\.workspace-leaf-content\[data-type\s*=\s*["']?(?:markdown|pdf|canvas|kanban|excalidraw)["']?\]/g,
		"",
	],
	[/\.nav-files-container/g, "#file-explorer"],
	[/\.workspace-leaf-content/g, ".leaf-content"],
	[/\.leaf>\.leaf-content/g, ".leaf .leaf-content"],
	[/\.markdown-reading-view/g, "#center-content"],
	[/\.markdown-preview-sizer|\.markdown-preview-section/g, ".markdown-preview-sizer"],
	[/\.horizontal-main-container|\.workspace/g, "#main-horizontal"],
];

export function remapExportCssSelectors(css: string): string
{
	let out = css;
	for (const [pattern, replacement] of REPLACEMENTS)
	{
		out = out.replace(pattern, replacement);
	}
	return out;
}
