import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

const outfile = path.join(os.tmpdir(), `css-selector-remap-${Date.now()}.mjs`);
await build({
	entryPoints: ["src/plugin/utils/css-selector-remap.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile,
});

const { remapExportCssSelectors } = await import(pathToFileURL(outfile).href);

{
	// Document panes should lose the leaf wrapper (export has no workspace leaves).
	const css = `.workspace-leaf-content[data-type="markdown"] .cm-line { color: red; }`;
	const out = remapExportCssSelectors(css);
	assert.equal(out.includes(".workspace-leaf-content"), false);
	assert.match(out, /\.cm-line/);
}

{
	// Border file-icon rules must stay scoped. The previous rewrite spanned from
	// [data-type="file-explorer"] into [data-path$=".excalidraw.md"] / ".canvas"
	// and collapsed into a global `body ::before { -webkit-mask-image }`.
	const css = `
body:not(.file-icon-remove) .workspace-leaf-content[data-type="file-explorer"] .nav-file-title[data-path$=".excalidraw.md"]::before {
	-webkit-mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M8 12.667'/%3e%3c/svg%3e");
}
body:not(.file-icon-remove) .workspace-leaf-content[data-type="file-explorer"] .nav-file-title[data-path$=".canvas"]::before {
	-webkit-mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3crect/%3e%3c/svg%3e");
}
body:not(.file-icon-remove) .workspace-leaf-content[data-type="file-explorer"] .nav-file-title::before {
	-webkit-mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M9.667'/%3e%3c/svg%3e");
}
`;
	const out = remapExportCssSelectors(css);
	assert.doesNotMatch(
		out,
		/body:not\(\.file-icon-remove\)\s*::before/,
		"must not collapse file-icon rules into a global ::before mask",
	);
	assert.match(out, /\.leaf-content\[data-type="file-explorer"\]/);
	assert.match(out, /data-path\$="\.excalidraw\.md"/);
	assert.match(out, /data-path\$="\.canvas"/);
}

{
	const css = `.horizontal-main-container .workspace-leaf-content { display: flex; }`;
	const out = remapExportCssSelectors(css);
	assert.match(out, /#main-horizontal/);
	assert.match(out, /\.leaf-content/);
	assert.doesNotMatch(out, /\.workspace-leaf-content/);
}

console.log("css-selector-remap tests passed");
