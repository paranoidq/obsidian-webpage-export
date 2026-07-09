import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";

export class SnippetStyles extends AssetLoader
{
    constructor()
    {
        super("snippets.css", "", null, AssetType.Style, InlinePolicy.AutoHead, true, Mutability.Dynamic, LoadMethod.Async, 20);
    }

    override async load()
    {
		// Export styles are frozen; vault CSS snippets are no longer included.
        this.data = "";
        await super.load();
    }
}
