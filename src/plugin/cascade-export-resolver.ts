import { TFile } from "obsidian";
import { Settings } from "src/plugin/settings/settings";

type MetadataLink = {
	link?: string;
};

export class CascadeExportResolver
{
	public static collect(entryFile: TFile): TFile[]
	{
		const files: TFile[] = [];
		const visited = new Set<string>();
		const pending: TFile[] = [entryFile];

		while (pending.length > 0)
		{
			const file = pending.shift();
			if (!file || visited.has(file.path)) continue;

			visited.add(file.path);
			files.push(file);

			for (const linkedFile of this.getLinkedFiles(file))
			{
				if (!visited.has(linkedFile.path)) pending.push(linkedFile);
			}
		}

		return files;
	}

	private static getLinkedFiles(file: TFile): TFile[]
	{
		const cache = app.metadataCache.getFileCache(file);
		const metadataLinks: MetadataLink[] = [
			...(cache?.links ?? []),
			...(cache?.embeds ?? []),
		];
		const linkedFiles: TFile[] = [];
		const seen = new Set<string>();

		for (const metadataLink of metadataLinks)
		{
			const target = this.resolveLink(metadataLink.link, file);
			if (!target || seen.has(target.path)) continue;

			seen.add(target.path);
			linkedFiles.push(target);
		}

		return linkedFiles;
	}

	private static resolveLink(link: string | undefined, sourceFile: TFile): TFile | undefined
	{
		const linkPath = this.cleanLinkPath(link);
		if (!linkPath || this.isExternalLink(linkPath)) return;

		const target = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
		if (!(target instanceof TFile)) return;
		if (!Settings.isPathAllowedByFilePicker(target.path)) return;

		return target;
	}

	private static cleanLinkPath(link: string | undefined): string
	{
		return (link ?? "")
			.split("#")[0]
			.split("?")[0]
			.trim();
	}

	private static isExternalLink(link: string): boolean
	{
		return link.startsWith("http://")
			|| link.startsWith("https://")
			|| link.startsWith("mailto:")
			|| link.startsWith("data:")
			|| (!link.startsWith("app://") && /\w+:(\/\/|\\\\)/.test(link));
	}
}
