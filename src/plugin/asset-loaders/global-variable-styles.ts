import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";

export class GlobalVariableStyles extends AssetLoader
{
    constructor()
    {
        super("global-variable-styles.css", "", null, AssetType.Style, InlinePolicy.AutoHead, true, Mutability.Dynamic, LoadMethod.Async, 6);
    }
    
    override async load()
    {
		// Only layout sizing variables — do not copy Obsidian body inline styles
		// (those can inject dark-mode runtime values into a frozen light export).
		let lineWidth = this.exportOptions.documentOptions.documentWidth || "40em";
		let sidebarWidthRight = this.exportOptions.sidebarOptions.rightDefaultWidth;
		let sidebarWidthLeft = this.exportOptions.sidebarOptions.leftDefaultWidth;
		if (!isNaN(Number(lineWidth))) lineWidth += "px";
		if (!isNaN(Number(sidebarWidthRight))) sidebarWidthRight += "px";
		if (!isNaN(Number(sidebarWidthLeft))) sidebarWidthLeft += "px";

		const lineWidthCss = `min(${lineWidth}, calc(100vw - 2em))`;
		this.data = 
        `
        :root body
        {
			--line-width: ${lineWidthCss};
			--line-width-adaptive: ${lineWidthCss};
			--file-line-width: ${lineWidthCss};
			--sidebar-width-right: min(${sidebarWidthRight}, 80vw);
			--sidebar-width-left: min(${sidebarWidthLeft}, 80vw);
        }
        `

        await super.load();
    }
}
