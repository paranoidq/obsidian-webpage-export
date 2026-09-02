import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { minify } from "html-minifier-terser";

const outfile = path.join(os.tmpdir(), `css-html-safe-${Date.now()}.mjs`);
await build({
	entryPoints: ["src/plugin/utils/css-html-safe.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile,
});

const { escapeCssForHtmlStyleTag, wrapCssInStyleTag } = await import(
	pathToFileURL(outfile).href
);

const svgWithStyle =
	`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:red}</style><path d="M0 0h24v24H0z"/></svg>`;
const svgPlain =
	`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;

const leakingCss = `
body:not(.new-tab-text-btn-restore) .leaf-content[data-type="empty"] .empty-state-action:nth-child(1):before {
    content: " ";
    display: block;
    height: 20px;
    width: 20px;
    background-color: var(--icon-color);
    -webkit-mask-image: url('${svgWithStyle}');
}
body:not(.new-tab-text-btn-restore) .leaf-content[data-type="empty"] .empty-state-action:nth-child(2):before {
    content: " ";
    display: block;
    height: 20px;
    width: 20px;
    background-color: var(--icon-color);
    -webkit-mask-image: url('${svgPlain}');
}
`;

function styleClosedEarly(html) {
	const lower = html.toLowerCase();
	const firstClose = lower.indexOf("</style");
	const after = html.slice(firstClose);
	return after.includes("nth-child(2)") || after.includes("empty-state-action");
}

{
	const raw = `<style>${leakingCss}</style>`;
	assert.equal(styleClosedEarly(raw), true, "unescaped CSS must leak (sanity)");
}

{
	const wrapped = wrapCssInStyleTag(leakingCss);
	assert.equal(
		styleClosedEarly(wrapped),
		false,
		"escaped CSS must keep nth-child(2) inside the style element",
	);
	assert.match(wrapped, /nth-child\(2\)/);
	const inner = wrapped.replace(/^<style>/, "").replace(/<\/style>$/, "");
	assert.doesNotMatch(inner, /<\/style/i);
	assert.match(wrapped, /%3Csvg/i);
	assert.match(wrapped, /%3C\/style/i);
}

{
	const once = escapeCssForHtmlStyleTag(leakingCss);
	const twice = escapeCssForHtmlStyleTag(once);
	assert.equal(once, twice, "encoding must be idempotent");
}

{
	const childCss = `.note > p { color: red; } .a[href*="<"] { color: blue; }`;
	assert.equal(escapeCssForHtmlStyleTag(childCss), childCss);
}

{
	const minified = await minify(wrapCssInStyleTag(leakingCss), {
		minifyCSS: true,
		removeComments: true,
		collapseWhitespace: true,
	});
	assert.equal(styleClosedEarly(minified), false, "minified escaped CSS must not leak");
	assert.match(minified, /nth-child\(2\)|empty-state-action/);

	const unwrapped = minified.replace("<style>", "").replace("</style>", "");
	const rewrapped = wrapCssInStyleTag(unwrapped);
	assert.equal(styleClosedEarly(rewrapped), false, "unwrap+rewrap must not leak");
}

{
	const borderHeadingCss = `.icon{ -webkit-mask-image: url('data:image/svg+xml;utf8,<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><style>.cls-1{fill:none;}</style></defs><path d="M0,1H1.18v3.43H3.53V1Z"/></svg>'); }`;
	const escaped = escapeCssForHtmlStyleTag(borderHeadingCss);
	assert.doesNotMatch(escaped, /<\?xml/);
	assert.match(escaped, /%3Csvg/i);
	assert.match(escaped, /%3C\/style/i);
	assert.match(escaped, /M0,1H1\.18v3\.43H3\.53V1Z/);
	const wrapped = wrapCssInStyleTag(borderHeadingCss);
	assert.equal(styleClosedEarly(wrapped), false);
}

console.log("css-html-safe tests passed");

const deferredCss = await (await import("node:fs/promises")).readFile(
	new URL("../src/assets/deferred.txt.css", import.meta.url),
	"utf8",
);
assert.match(deferredCss, /@media not print/);
assert.match(deferredCss, /contain:\s*none\s*!important/);
assert.match(deferredCss, /#center-content>\.obsidian-document[\s\S]*flex:\s*1 1 0\s*!important/);
assert.match(deferredCss, /#center-content>\.obsidian-document[\s\S]*min-height:\s*0\s*!important/);
assert.match(deferredCss, /#main-horizontal::before/);
assert.match(deferredCss, /#main-horizontal::before[\s\S]*display:\s*none\s*!important/);
assert.match(deferredCss, /#center-content>\.obsidian-document[\s\S]*border-radius:\s*0\s*!important/);
assert.match(deferredCss, /#center-content>\.obsidian-document[\s\S]*background-color:\s*var\(--background-primary\)/);
assert.match(deferredCss, /h2\.heading::before/);
assert.match(deferredCss, /heading-collapse-indicator svg\.svg-icon path/);
assert.match(deferredCss, /\.obsidian-document blockquote::before/);
assert.match(deferredCss, /blockquote::before[\s\S]*mask-image:\s*none\s*!important/);
console.log("export-shell css tests passed");
