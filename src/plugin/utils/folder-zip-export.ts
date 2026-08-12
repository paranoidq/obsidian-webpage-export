import JSZip from "jszip";
import { TFile, TFolder } from "obsidian";
import { Path } from "src/plugin/utils/path";
import { i18n } from "src/plugin/translations/language";

export type FolderZipCompressionLevel = "low" | "medium" | "high";

export type FolderZipProgressCallback = (
	fraction: number,
	message: string,
	detail?: string
) => void;

export interface FolderZipExportOptions
{
	folder: TFolder;
	exportDir: Path;
	compressionLevel: FolderZipCompressionLevel;
	/** Max volume size in MB. <= 0 disables splitting. */
	splitVolumeMB: number;
	onProgress?: FolderZipProgressCallback;
}

export interface FolderZipExportResult
{
	outputDir: string;
	baseName: string;
	volumeCount: number;
	writtenPaths: string[];
}

const DEFLATE_LEVEL: Record<FolderZipCompressionLevel, number> = {
	low: 1,
	medium: 6,
	high: 9,
};

function report(
	onProgress: FolderZipProgressCallback | undefined,
	fraction: number,
	message: string,
	detail?: string
)
{
	onProgress?.(Math.min(1, Math.max(0, fraction)), message, detail);
}

function collectFilesInFolder(folder: TFolder): TFile[]
{
	const prefix = folder.path === "/" ? "" : folder.path + "/";
	return app.vault.getFiles().filter((file) =>
	{
		if (folder.path === "/" || folder.path === "")
		{
			return true;
		}
		return file.path.startsWith(prefix);
	});
}

function archiveEntryPath(folder: TFolder, file: TFile): string
{
	const prefix = folder.path === "/" || folder.path === "" ? "" : folder.path + "/";
	const relative = prefix ? file.path.slice(prefix.length) : file.path;
	return `${folder.name}/${relative}`.replace(/\\/g, "/");
}

function volumeFileName(baseName: string, index: number, volumeCount: number): string
{
	// Single archive: plain .zip
	if (volumeCount <= 1) return `${baseName}.zip`;
	// 7-Zip / Keka / Bandizip style: open .zip.001 to extract the whole set.
	// Volumes are raw sequential chunks of one complete zip (not independent archives).
	return `${baseName}.zip.${String(index + 1).padStart(3, "0")}`;
}

function splitBuffer(buffer: Uint8Array, chunkSize: number): Uint8Array[]
{
	if (chunkSize <= 0 || buffer.length <= chunkSize)
	{
		return [buffer];
	}

	const parts: Uint8Array[] = [];
	for (let offset = 0; offset < buffer.length; offset += chunkSize)
	{
		parts.push(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
	}
	return parts;
}

export class FolderZipExporter
{
	public static async export(options: FolderZipExportOptions): Promise<FolderZipExportResult>
	{
		const lang = i18n.folderZipExportModal;
		const { folder, exportDir, compressionLevel, splitVolumeMB, onProgress } = options;
		const baseName = folder.name;
		const level = DEFLATE_LEVEL[compressionLevel] ?? DEFLATE_LEVEL.medium;

		report(onProgress, 0, lang.progress.collecting);
		const files = collectFilesInFolder(folder);
		if (files.length === 0)
		{
			throw new Error(lang.emptyFolder);
		}

		const zip = new JSZip();
		const total = files.length;
		for (let i = 0; i < total; i++)
		{
			const file = files[i];
			const entryPath = archiveEntryPath(folder, file);
			const data = await app.vault.readBinary(file);
			zip.file(entryPath, data, {
				compression: "DEFLATE",
				compressionOptions: { level },
			});

			const fraction = ((i + 1) / total) * 0.7;
			report(
				onProgress,
				fraction,
				lang.progress.addingFile.format(String(i + 1), String(total), entryPath)
			);
		}

		report(onProgress, 0.7, lang.progress.compressing);
		const buffer = await zip.generateAsync(
			{
				type: "uint8array",
				compression: "DEFLATE",
				compressionOptions: { level },
			},
			(metadata) =>
			{
				const percent = typeof metadata.percent === "number" ? metadata.percent : 0;
				report(onProgress, 0.7 + (percent / 100) * 0.2, lang.progress.compressing);
			}
		);

		// Use decimal MB (1_000_000 bytes) so a "10 MB" limit matches Finder / WeChat-style size displays.
		const chunkSize =
			splitVolumeMB > 0 ? Math.floor(splitVolumeMB * 1000 * 1000) : 0;
		const parts = splitBuffer(buffer, chunkSize);
		const writtenPaths: string[] = [];

		for (let i = 0; i < parts.length; i++)
		{
			const name = volumeFileName(baseName, i, parts.length);
			const outPath = exportDir.joinString(name);
			const message =
				parts.length === 1
					? lang.progress.writing.format(name)
					: lang.progress.writingVolume.format(
							String(i + 1),
							String(parts.length),
							name
					  );
			report(onProgress, 0.9 + ((i + 1) / parts.length) * 0.1, message);

			const ok = await outPath.write(parts[i]);
			if (!ok)
			{
				throw new Error(`Failed to write ${outPath.path}`);
			}
			writtenPaths.push(outPath.path);
		}

		report(onProgress, 1, lang.progress.done);

		return {
			outputDir: exportDir.path,
			baseName,
			volumeCount: parts.length,
			writtenPaths,
		};
	}
}
