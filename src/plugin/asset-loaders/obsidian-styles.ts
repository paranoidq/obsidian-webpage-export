import frozenObsidianStyles from "src/assets/frozen-obsidian.txt.css";
import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";

export class ObsidianStyles extends AssetLoader
{
    constructor()
    {
        // minify=false: frozen CSS is large and already filtered; avoid minifyCSS edge cases.
        super("obsidian.css", frozenObsidianStyles, null, AssetType.Style, InlinePolicy.AutoHead, false, Mutability.Static, LoadMethod.Default, 10);
    }

	// Kept for freeze-export-styles.mjs / any remaining callers that filter plugin CSS.
	static readonly obsidianStyleAlwaysFilter =
	[
		"cm-", "cm6", "workspace-", ":root", "CodeMirror", "xfa", "modal", "@-webkit", "leaf", "plugins", "-split", "empty-state", "search-result-", "mobile", "tablet", "phone", "linux", "macos", "mod-windows", "is-frameless", 
	]
	static readonly obsidianStylesFilter =
	["ghost", "pdf", "annotation", "data-main-rotation", "spread",
	"load",  "setting", "filter", "decorator", "node-insert", "app-container",
	"dictionary", "status", "windows", "titlebar", "source", "#main-horizontal",
	"menu", "message", "suggestion", "prompt", 
	"tab", "HyperMD", "workspace", "publish", 
	"backlink", "sync", "vault",  
	"textLayer", "header",  "rename", "edit",
	"progress", "native", "aria", "tooltip", 
	"drop", "sidebar", 
	"is-hidden-frameless", "obsidian-app", "show-view-header",
	"is-maximized", "is-translucent", "community", "Layer"];
	static readonly stylesKeep = ["tree", "scrollbar", "input[type", "table", "markdown-rendered", "css-settings-manager", "inline-embed", "background", "token", "-plugin-"];
}
