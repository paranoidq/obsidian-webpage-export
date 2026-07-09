import { AssetLoader } from "./base-asset.js";
import { AssetType, InlinePolicy, LoadMethod, Mutability } from "./asset-types.js";

export class SupportedPluginStyles extends AssetLoader {
	constructor() {
		super("supported-plugins.css", "", null, AssetType.Style, InlinePolicy.AutoHead, true, Mutability.Dynamic, LoadMethod.Async, 5);
	}

	override async load() {
		// Export styles are frozen; runtime stylesheet scanning is disabled.
		this.data = "";
		await super.load();
	}
}
