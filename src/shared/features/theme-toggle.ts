import {
	FeatureRelation,
	InsertedFeatureOptionsWithTitle,
	RelationType,
} from "./feature-options-base";

export class ThemeToggleOptions extends InsertedFeatureOptionsWithTitle {
	constructor() {
		super();
		this.featureId = "theme-toggle";
		this.displayTitle = "";
		// Frozen light export: theme toggle is disabled and unavailable.
		this.enabled = false;
		this.unavailable = true;
		this.hideSettingsButton = true;
		this.featurePlacement = new FeatureRelation(
			"#right-sidebar .topbar-content",
			RelationType.Start
		);
	}
}
