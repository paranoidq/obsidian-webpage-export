/**
 * Freeze Obsidian core + Prism theme + Code Styler styles into Static CSS assets.
 *
 * Usage:
 *   npm run freeze-styles
 *
 * Env overrides:
 *   VAULT_PATH          default: /Users/paranoidq/my-new-wiki
 *   OBSIDIAN_ASAR       default: /Applications/Obsidian.app/Contents/Resources/obsidian.asar
 *   PRISM_THEME_CSS     default: $VAULT_PATH/.obsidian/themes/Prism/theme.css
 *   CODE_STYLER_DIR     default: $VAULT_PATH/.obsidian/plugins/code-styler
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const postcss = require("postcss");
const safeParser = require("postcss-safe-parser");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(repoRoot, "src", "assets");

const VAULT_PATH = process.env.VAULT_PATH || "/Users/paranoidq/my-new-wiki";
const OBSIDIAN_ASAR =
	process.env.OBSIDIAN_ASAR ||
	"/Applications/Obsidian.app/Contents/Resources/obsidian.asar";
const PRISM_THEME_CSS =
	process.env.PRISM_THEME_CSS ||
	path.join(VAULT_PATH, ".obsidian/themes/Prism/theme.css");
const CODE_STYLER_DIR =
	process.env.CODE_STYLER_DIR ||
	path.join(VAULT_PATH, ".obsidian/plugins/code-styler");
const STYLE_SETTINGS_DATA =
	process.env.STYLE_SETTINGS_DATA ||
	path.join(VAULT_PATH, ".obsidian/plugins/obsidian-style-settings/data.json");

/** Prism Style Settings defaults (class-select) when no override is saved. */
const PRISM_DEFAULT_BODY_CLASSES = [
	"pt-color-scheme-swan-lt",
	"pt-color-scheme-style-two-tone-and-border-lt",
	"pt-accent-style-borderandfilled-lt",
	"pt-accent-color-purple-lt",
];

/** Format metadata for Prism Style Settings variable keys we freeze. */
const PRISM_STYLE_SETTING_FORMATS = {
	"h1-size": "em",
	"h2-size": "em",
	"h3-size": "em",
	"h4-size": "em",
	"h5-size": "em",
	"h6-size": "em",
};

// Mirrors ObsidianStyles filters
const OBSIDIAN_ALWAYS_DISCARD = [
	"cm-", "cm6", "workspace-", ":root", "CodeMirror", "xfa", "modal", "@-webkit",
	"leaf", "plugins", "-split", "empty-state", "search-result-", "mobile", "tablet",
	"phone", "linux", "macos", "mod-windows", "is-frameless",
];
const OBSIDIAN_DISCARD = [
	"ghost", "pdf", "annotation", "data-main-rotation", "spread",
	"load", "setting", "filter", "decorator", "node-insert", "app-container",
	"dictionary", "status", "windows", "titlebar", "source", "#main-horizontal",
	"menu", "message", "suggestion", "prompt",
	"tab", "HyperMD", "workspace", "publish",
	"backlink", "sync", "vault",
	"textLayer", "header", "rename", "edit",
	"progress", "native", "aria", "tooltip",
	"drop", "sidebar",
	"is-hidden-frameless", "obsidian-app", "show-view-header",
	"is-maximized", "is-translucent", "community", "Layer",
];
const OBSIDIAN_KEEP = [
	"tree", "scrollbar", "input[type", "table", "markdown-rendered",
	"css-settings-manager", "inline-embed", "background", "token", "-plugin-",
];

// Mirrors ThemeStyles filters
const THEME_ALWAYS_DISCARD = ["cm-", "cm6", "CodeMirror", "pdf"];
const THEME_KEEP = [
	"@media", "tree", "scrollbar", "input[type", "table",
	"markdown-rendered", "inline-embed",
];

function readFile(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`Missing file: ${filePath}`);
	}
	return fs.readFileSync(filePath, "utf8");
}

function extractFromAsar(asarPath, entryName) {
	const fd = fs.openSync(asarPath, "r");
	try {
		const headerBuf = Buffer.alloc(16);
		fs.readSync(fd, headerBuf, 0, 16, 0);
		const headerSize = headerBuf.readUInt32LE(4);
		const stringSize = headerBuf.readUInt32LE(12);
		const jsonBuf = Buffer.alloc(stringSize);
		fs.readSync(fd, jsonBuf, 0, stringSize, 16);
		const header = JSON.parse(jsonBuf.toString("utf8"));
		const info = header?.files?.[entryName];
		if (!info) {
			throw new Error(`Entry not found in asar: ${entryName}`);
		}
		const dataOffset = 8 + headerSize;
		const offset = Number(info.offset);
		const size = Number(info.size);
		const content = Buffer.alloc(size);
		fs.readSync(fd, content, 0, size, dataOffset + offset);
		return content.toString("utf8");
	} finally {
		fs.closeSync(fd);
	}
}

async function filterStyleRules(cssContent, alwaysDiscard, discard, keep) {
	const result = await postcss([
		(root) => {
			root.walkRules((rule) => {
				const filteredSelectors = rule.selectors.filter((selector) => {
					const selectorParts = selector
						.split(/[\s.#:>+~]+/)
						.filter(Boolean);

					if (
						selectorParts.some((part) =>
							alwaysDiscard.some((d) => part.includes(d))
						)
					) {
						return false;
					}

					if (
						selectorParts.some((part) =>
							keep.some((k) => part.includes(k))
						)
					) {
						return true;
					}

					return !selectorParts.some((part) =>
						discard.some((d) => part.includes(d))
					);
				});

				if (filteredSelectors.length === 0) {
					rule.remove();
				} else if (filteredSelectors.length !== rule.selectors.length) {
					rule.selectors = filteredSelectors;
				}
			});
		},
	]).process(cssContent, {
		from: undefined,
		parser: safeParser,
	});

	return result.css;
}

function isCssVarRef(colour) {
	return typeof colour === "string" && colour.startsWith("--");
}

function styleColourValue(colour) {
	return isCssVarRef(colour) ? `var(${colour})` : colour;
}

function getThemeColours(themeModeColours) {
	const entries = {
		"codeblock-background-colour": themeModeColours.codeblock.backgroundColour,
		"codeblock-text-colour": themeModeColours.codeblock.textColour,
		"gutter-background-colour": themeModeColours.gutter.backgroundColour,
		"gutter-text-colour": themeModeColours.gutter.textColour,
		"gutter-active-text-colour": themeModeColours.gutter.activeTextColour,
		"header-background-colour": themeModeColours.header.backgroundColour,
		"header-title-text-colour": themeModeColours.header.title.textColour,
		"header-language-tag-background-colour":
			themeModeColours.header.languageTag.backgroundColour,
		"header-language-tag-text-colour":
			themeModeColours.header.languageTag.textColour,
		"header-separator-colour": themeModeColours.header.lineColour,
		"header-external-reference-repository":
			themeModeColours.header.externalReference.displayRepositoryColour,
		"header-external-reference-version":
			themeModeColours.header.externalReference.displayVersionColour,
		"header-external-reference-timestamp":
			themeModeColours.header.externalReference.displayTimestampColour,
		"active-codeblock-line-colour":
			themeModeColours.highlights.activeCodeblockLineColour,
		"active-editor-line-colour":
			themeModeColours.highlights.activeEditorLineColour,
		"default-highlight-colour": themeModeColours.highlights.defaultColour,
		"button-colour": themeModeColours.advanced.buttonColour,
		"button-active-colour": themeModeColours.advanced.buttonActiveColour,
		"inline-colour": themeModeColours.inline.textColour,
		"inline-colour-active": themeModeColours.inline.activeTextColour,
		"inline-background-colour": themeModeColours.inline.backgroundColour,
		"inline-title-colour": themeModeColours.inline.titleTextColour,
	};

	for (const [name, colour] of Object.entries(
		themeModeColours.highlights.alternativeHighlights || {}
	)) {
		entries[`${name.replace(/\s+/g, "-").toLowerCase()}-highlight-colour`] =
			colour;
	}

	return Object.entries(entries)
		.map(
			([cssVariable, colour]) =>
				`--code-styler-${cssVariable}: ${styleColourValue(colour)};`
		)
		.join("\n\t\t");
}

function styleThemeSettings(themeSettings) {
	return `
body.code-styler .code-styler-header-language-tag {
	--code-styler-header-language-tag-text-bold: ${
		themeSettings.header.languageTag.textBold ? "bold" : "normal"
	};
	--code-styler-header-language-tag-text-italic: ${
		themeSettings.header.languageTag.textItalic ? "italic" : "normal"
	};
	font-family: ${
		themeSettings.header.languageTag.textFont !== ""
			? themeSettings.header.languageTag.textFont
			: "var(--font-text)"
	};
}
body.code-styler .code-styler-header-text {
	--code-styler-header-title-text-bold: ${
		themeSettings.header.title.textBold ? "bold" : "normal"
	};
	--code-styler-header-title-text-italic: ${
		themeSettings.header.title.textItalic ? "italic" : "normal"
	};
	font-family: ${
		themeSettings.header.title.textFont !== ""
			? themeSettings.header.title.textFont
			: "var(--font-text)"
	};
}
body.code-styler {
	--border-radius: ${themeSettings.codeblock.curvature}px;
	--language-icon-size: ${themeSettings.advanced.iconSize}px;
	--gradient-highlights-colour-stop: ${
		themeSettings.advanced.gradientHighlights
			? themeSettings.advanced.gradientHighlightsColourStop
			: "100%"
	};
	--header-font-size: ${themeSettings.header.fontSize}px;
	--line-wrapping: ${themeSettings.codeblock.unwrapLines ? "pre" : "pre-wrap"};
	--code-styler-inline-font-weight: ${themeSettings.inline.fontWeight}00;
	--code-styler-inline-border-radius: ${themeSettings.inline.curvature}px;
	--code-styler-inline-padding-vertical: ${themeSettings.inline.paddingVertical}px;
	--code-styler-inline-padding-horizontal: ${
		themeSettings.inline.paddingHorizontal
	}px;
	--code-styler-inline-margin-horizontal: ${
		themeSettings.inline.marginHorizontal
	}px;
	--code-styler-inline-title-font-weight: ${
		themeSettings.inline.titleFontWeight
	}00;
	${
		themeSettings.codeblock.wrapLinesActive
			? "--line-active-wrapping: pre-wrap;"
			: ""
	}
	${themeSettings.header.languageIcon.displayColour ? "" : "--icon-filter: grayscale(1);"}
}
/* Prism theme border tweak used by Code Styler when cssTheme is Prism */
.markdown-source-view :not(pre.code-styler-pre) > .code-styler-header-container {
	--code-styler-header-border: 1px solid var(--window-border-color);
	--header-separator-width-padding: calc(var(--header-separator-width) - 1px);
	--folded-bottom-border: var(--code-styler-header-border);
}
`.trim();
}

function buildCodeStylerRuntimeCss(currentTheme) {
	const lightVars = getThemeColours(currentTheme.colours.light);
	const settingsCss = styleThemeSettings(currentTheme.settings);
	return `
/* Generated from Code Styler data.json currentTheme (light only) */
body.code-styler.theme-light {
	${lightVars}
}
${settingsCss}
`.trim();
}

function stripRemoteFontFace(css) {
	// Remove @font-face blocks that load remote URLs (e.g. GitHub raw Nerd Font).
	return css.replace(
		/@font-face\s*\{[^}]*url\(\s*https?:\/\/[^)]+\)[^}]*\}/gi,
		"/* removed remote @font-face */"
	);
}

/**
 * Convert Style Settings data.json Prism overrides into CSS variables.
 * Export body must NOT have `.css-settings-manager` so Prism's
 * `:not(.css-settings-manager)` default palette still applies; these
 * overrides layer on top for heading sizes / text colors the user customized.
 */
function buildPrismStyleSettingsCss(styleSettingsPath) {
	if (!fs.existsSync(styleSettingsPath)) {
		console.warn(`  Style Settings data not found: ${styleSettingsPath}`);
		return "";
	}

	const settings = JSON.parse(readFile(styleSettingsPath));
	const decls = [];
	for (const [key, value] of Object.entries(settings)) {
		if (!key.startsWith("obsidian-prism-theme@@")) continue;
		const id = key.slice("obsidian-prism-theme@@".length);
		if (id.includes("@@")) continue; // themed color light/dark split — skip for light-only freeze
		const format = PRISM_STYLE_SETTING_FORMATS[id] || "";
		const cssValue =
			typeof value === "number" ||
			(typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))
				? `${value}${format}`
				: String(value);
		decls.push(`\t--${id}: ${cssValue};`);
	}

	if (decls.length === 0) return "";

	return `
/* Style Settings overrides for Prism (light) */
body.theme-light {
${decls.join("\n")}
}
`.trim();
}

/**
 * Comment listing Prism body classes that should be forced on export pages.
 * Actual class injection happens in webpage-template.ts; this documents the freeze.
 */
function prismBodyClassComment() {
	return `/* Prism default Style Settings body classes (applied at export):\n * ${PRISM_DEFAULT_BODY_CLASSES.join(", ")}\n */\n`;
}

function banner(label) {
	return `/* Frozen export style: ${label}\n * Generated by scripts/freeze-export-styles.mjs — do not edit by hand.\n * Re-run: npm run freeze-styles\n */\n\n`;
}

async function main() {
	console.log("Vault:", VAULT_PATH);
	console.log("Obsidian asar:", OBSIDIAN_ASAR);
	console.log("Prism theme:", PRISM_THEME_CSS);
	console.log("Code Styler:", CODE_STYLER_DIR);

	const overridesPath = path.join(assetsDir, "obsidian-styles.txt.css");
	const overrides = readFile(overridesPath);

	console.log("Extracting app.css from asar...");
	const appCss = extractFromAsar(OBSIDIAN_ASAR, "app.css");
	console.log(`  app.css bytes: ${Buffer.byteLength(appCss)}`);

	console.log("Filtering Obsidian core styles...");
	const filteredObsidian = await filterStyleRules(
		appCss,
		OBSIDIAN_ALWAYS_DISCARD,
		OBSIDIAN_DISCARD,
		OBSIDIAN_KEEP
	);
	const frozenObsidian =
		banner("Obsidian core (filtered app.css) + plugin overrides") +
		filteredObsidian +
		"\n\n/* ---- plugin overrides (obsidian-styles.txt.css) ---- */\n" +
		overrides;
	fs.writeFileSync(
		path.join(assetsDir, "frozen-obsidian.txt.css"),
		frozenObsidian,
		"utf8"
	);
	console.log(
		`  wrote frozen-obsidian.txt.css (${Buffer.byteLength(frozenObsidian)} bytes)`
	);

	console.log("Filtering Prism theme...");
	const prismCss = readFile(PRISM_THEME_CSS);
	const filteredPrism = await filterStyleRules(
		prismCss,
		THEME_ALWAYS_DISCARD,
		[],
		THEME_KEEP
	);
	const styleSettingsCss = buildPrismStyleSettingsCss(STYLE_SETTINGS_DATA);
	const frozenPrism =
		banner("Prism theme") +
		prismBodyClassComment() +
		filteredPrism +
		(styleSettingsCss
			? "\n\n/* ---- Style Settings Prism overrides ---- */\n" +
				styleSettingsCss +
				"\n"
			: "");
	fs.writeFileSync(
		path.join(assetsDir, "frozen-prism.txt.css"),
		frozenPrism,
		"utf8"
	);
	console.log(
		`  wrote frozen-prism.txt.css (${Buffer.byteLength(frozenPrism)} bytes)`
	);
	if (styleSettingsCss) {
		console.log("  included Style Settings Prism overrides");
	}

	console.log("Building Code Styler freeze...");
	const codeStylerStyles = stripRemoteFontFace(
		readFile(path.join(CODE_STYLER_DIR, "styles.css"))
	);
	const dataJson = JSON.parse(
		readFile(path.join(CODE_STYLER_DIR, "data.json"))
	);
	if (!dataJson.currentTheme) {
		throw new Error("code-styler data.json missing currentTheme");
	}
	const runtimeCss = buildCodeStylerRuntimeCss(dataJson.currentTheme);
	const frozenCodeStyler =
		banner("Code Styler styles.css + currentTheme light variables") +
		codeStylerStyles +
		"\n\n/* ---- runtime variables from data.json ---- */\n" +
		runtimeCss +
		"\n";
	fs.writeFileSync(
		path.join(assetsDir, "frozen-code-styler.txt.css"),
		frozenCodeStyler,
		"utf8"
	);
	console.log(
		`  wrote frozen-code-styler.txt.css (${Buffer.byteLength(frozenCodeStyler)} bytes)`
	);

	console.log("Done.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
