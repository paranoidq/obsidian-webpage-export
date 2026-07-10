import { TFile, TFolder } from "obsidian";

const FOLDER_NOTES_PLUGIN_ID = "folder-notes";

export function isFolderNotesPluginEnabled(): boolean
{
	// @ts-ignore - plugins is available at runtime but not in public App typings
	return app.plugins?.enabledPlugins?.has(FOLDER_NOTES_PLUGIN_ID) ?? false;
}

/**
 * Returns the folder note for a folder when Folder Notes is enabled
 * and a same-named file exists inside the folder.
 */
export function getFolderNote(folder: TFolder): TFile | undefined
{
	if (!isFolderNotesPluginEnabled()) return undefined;

	for (const child of folder.children)
	{
		if (child instanceof TFile && child.basename === folder.name)
		{
			return child;
		}
	}

	return undefined;
}
