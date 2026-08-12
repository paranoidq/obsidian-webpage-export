import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";
import { Settings } from "src/plugin/settings/settings";
import { getDocumentFontScale } from "src/plugin/website/pipeline-options";

/**
 * Fonts a browser is allowed to embed into a PDF, ordered so that macOS, Windows
 * and Linux each find one they ship with. No generic family is listed: a generic
 * resolves to the platform default, and those defaults (PingFang, Hiragino,
 * Apple SD Gothic Neo) are the very fonts that cannot be embedded.
 */
const PRINT_LATIN_FONTS = "Helvetica, Arial, \"Liberation Sans\", \"DejaVu Sans\"";

const PRINT_MONOSPACE_FONTS = "Menlo, Monaco, Consolas, \"Courier New\", "
	+ "\"DejaVu Sans Mono\", \"Liberation Mono\"";

/**
 * CJK faces are appended behind the Latin ones so they only supply the glyphs the
 * Latin faces lack. Which set is right depends on the language: a Chinese font
 * covers Japanese kanji, but draws them with Chinese shapes, so the document
 * language picks the list rather than one list serving everybody.
 */
const PRINT_CJK_FONTS: { selector: string, fonts: string }[] =
[
	{
		selector: "html body",
		fonts: "\"Heiti SC\", \"Microsoft YaHei\", SimSun, \"Noto Sans CJK SC\", \"Source Han Sans SC\"",
	},
	{
		selector: "html body:is(:lang(zh-Hant), :lang(zh-TW), :lang(zh-HK), :lang(zh-MO))",
		fonts: "\"Heiti TC\", \"Microsoft JhengHei\", PMingLiU, \"Noto Sans CJK TC\", \"Source Han Sans TC\"",
	},
	{
		selector: "html body:lang(ja)",
		fonts: "Osaka, \"Yu Gothic\", Meiryo, \"MS Gothic\", \"Noto Sans CJK JP\"",
	},
	{
		selector: "html body:lang(ko)",
		fonts: "AppleGothic, \"Malgun Gothic\", \"Nanum Gothic\", \"Noto Sans CJK KR\"",
	},
];

function printFontRules(): string
{
	return PRINT_CJK_FONTS.map(({ selector, fonts }) =>
	`
			${selector}
			{
				--font-print: ${PRINT_LATIN_FONTS}, ${fonts} !important;
				--font-text: ${PRINT_LATIN_FONTS}, ${fonts} !important;
				--font-interface: ${PRINT_LATIN_FONTS}, ${fonts} !important;
				--font-monospace: ${PRINT_MONOSPACE_FONTS}, ${fonts} !important;
			}`).join("\n");
}

export class GlobalVariableStyles extends AssetLoader
{
    constructor()
    {
        super("global-variable-styles.css", "", null, AssetType.Style, InlinePolicy.AutoHead, true, Mutability.Dynamic, LoadMethod.Async, 6);
    }
    
    override async load()
    {
        const bodyStyle = (document.body.getAttribute("style") ?? "").replaceAll("\"", "'").replaceAll("; ", " !important;\n\t");
		let lineWidth = this.exportOptions.documentOptions.documentWidth || "40em";
		let sidebarWidthRight = this.exportOptions.sidebarOptions.rightDefaultWidth;
		let sidebarWidthLeft = this.exportOptions.sidebarOptions.leftDefaultWidth;
		if (!isNaN(Number(lineWidth))) lineWidth += "px";
		if (!isNaN(Number(sidebarWidthRight))) sidebarWidthRight += "px";
		if (!isNaN(Number(sidebarWidthLeft))) sidebarWidthLeft += "px";

		const lineWidthCss = `min(${lineWidth}, calc(100vw - 2em))`;

		// The theme owns the base text size, so the export option only scales it and
		// medium leaves it untouched. The screen size is kept out of print media,
		// where the stylesheet sizes text in points from the same scale instead.
		const fontScale = getDocumentFontScale(this.exportOptions.documentFontSize);
		let fontSizeCss = "";
		if (fontScale !== 1)
		{
			const baseFontSize = parseFloat(getComputedStyle(document.body).getPropertyValue("--font-text-size")) || 16;
			fontSizeCss =
			`
		@media screen
		{
			:root body { --font-text-size: ${(baseFontSize * fontScale).toFixed(1)}px !important; }
		}
			`;
		}

		// Obsidian prints with --font-print, which ends in fonts the theme brought
		// along, so the swap has to happen on the composed variables to reach every
		// element. html body outranks the app's own body rule.
		let printFontCss = "";
		if (this.exportOptions.printSelectableText)
		{
			printFontCss =
			`
		@media print
		{${printFontRules()}
		}
			`;
		}

		this.data = 
        `
        :root body
        {
			--line-width: ${lineWidthCss};
			--line-width-adaptive: ${lineWidthCss};
			--file-line-width: ${lineWidthCss};
			--sidebar-width-right: min(${sidebarWidthRight}, 80vw);
			--sidebar-width-left: min(${sidebarWidthLeft}, 80vw);
			--export-font-scale: ${fontScale};
        }
		${fontSizeCss}
		${printFontCss}
		body
        {
            ${bodyStyle}
        }
        `

        await super.load();
    }
}
