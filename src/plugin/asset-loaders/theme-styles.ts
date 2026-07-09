import frozenPrismStyles from "src/assets/frozen-prism.txt.css";
import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";

export class ThemeStyles extends AssetLoader
{
    constructor()
    {
        // minify=false: Prism ships large embedded fonts; keep CSS intact.
        super("theme.css", frozenPrismStyles, null, AssetType.Style, InlinePolicy.AutoHead, false, Mutability.Static, LoadMethod.Default, 8);
    }

	static readonly obsidianStylesFilter =
	["cm-", "cm6", "CodeMirror", "pdf"];
	static readonly stylesKeep = ["@media", "tree", "scrollbar", "input[type", "table", "markdown-rendered", "inline-embed"];
}
