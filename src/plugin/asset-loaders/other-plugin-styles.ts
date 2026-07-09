import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";

export class OtherPluginStyles extends AssetLoader
{
    constructor()
    {
        super("other-plugins.css", "", null, AssetType.Style, InlinePolicy.AutoHead, true, Mutability.Dynamic, LoadMethod.Async, 9);
    }

	public static async getStyleForPlugin(_pluginName: string): Promise<string>
	{
		return "";
	}

    override async load()
    {
		// Export styles are frozen; per-plugin styles.css selection is disabled.
        this.data = "";
        await super.load();
    }
}
