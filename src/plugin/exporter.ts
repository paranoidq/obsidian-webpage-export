import { Notice, TFile, TFolder } from "obsidian";
import { Path } from "src/plugin/utils/path";
import { Settings } from "src/plugin/settings/settings";
import { Utils } from "src/plugin/utils/utils";
import { Website } from "src/plugin/website/website";
import { ExportLog, MarkdownRendererAPI } from "src/plugin/render-api/render-api";
import { ExportInfo, ExportModal } from "src/plugin/settings/export-modal";
import { CascadeExportContext, CascadeExportResolver } from "./cascade-export-resolver";

export class HTMLExporter
{
	static async updateSettings(usePreviousSettings: boolean = false, overrideFiles: TFile[] | undefined = undefined, overrideExportPath: Path | undefined = undefined, lockPickedFiles: boolean = false): Promise<ExportInfo | undefined>
	{
		if (!usePreviousSettings) 
		{
			const modal = new ExportModal();
			if(overrideFiles) modal.overridePickedFiles(overrideFiles);
			if(lockPickedFiles && overrideFiles) modal.lockPickedFiles(overrideFiles);
			return await modal.open();
		}
		
		const files = Settings.exportOptions.filesToExport[0];
		const path = overrideExportPath ?? new Path(Settings.exportOptions.exportPath);

		if ((files.length == 0 && overrideFiles == undefined) || !path.exists || !path.isAbsolute || !path.isDirectory)
		{
			new Notice("Please set the export path and files to export in the settings first.", 5000);
			const modal = new ExportModal();
			if(overrideFiles) modal.overridePickedFiles(overrideFiles);
			if(lockPickedFiles && overrideFiles) modal.lockPickedFiles(overrideFiles);
			return await modal.open();
		}

		return undefined;
	}

	public static async export(usePreviousSettings: boolean = true, overrideFiles: TFile[] | undefined = undefined, overrideExportPath: Path | undefined = undefined)
	{
		const info = await this.updateSettings(usePreviousSettings, overrideFiles, overrideExportPath);
		if ((!info && !usePreviousSettings) || (info && info.canceled)) return;

		const files = info?.pickedFiles ?? overrideFiles ?? Settings.getFilesToExport();
		const exportPath = overrideExportPath ?? info?.exportPath ?? new Path(Settings.exportOptions.exportPath);

		const website = await HTMLExporter.exportFiles(files, exportPath, true, Settings.deleteOldFiles);

		if (!website) return;
		if (Settings.openAfterExport) Utils.openPath(exportPath);
		new Notice("✅ Finished HTML Export:\n\n" + exportPath, 5000);
	}

	public static async exportCascadeFromEntry(entryFile: TFile, usePreviousSettings: boolean = false, overrideExportPath: Path | undefined = undefined)
	{
		const info = await this.updateSettings(usePreviousSettings, [entryFile], overrideExportPath, true);
		if ((!info && !usePreviousSettings) || (info && info.canceled)) return;

		const cascadeContext = CascadeExportResolver.collect(entryFile);
		const exportPath = overrideExportPath ?? info?.exportPath ?? new Path(Settings.exportOptions.exportPath);
		const exportRoot = new Path(entryFile.path).parent?.path ?? "";

		const website = await HTMLExporter.exportFiles(
			cascadeContext.pageFiles,
			exportPath,
			true,
			Settings.deleteOldFiles,
			exportRoot,
			cascadeContext
		);

		if (!website) return;
		if (Settings.openAfterExport) Utils.openPath(exportPath);
		new Notice("✅ Finished HTML Export:\n\n" + exportPath, 5000);
	}

	public static async exportFiles(files: TFile[], destination: Path, saveFiles: boolean, deleteOld: boolean, exportRoot?: string, cascadeContext?: CascadeExportContext) : Promise<Website | undefined>
	{
		MarkdownRendererAPI.beginBatch();
		let website = undefined;
		try
		{
			website = await (await new Website(destination).load(files, exportRoot, cascadeContext)).build();

			if (!website)
			{
				new Notice("❌ Export Cancelled", 5000);
				return;
			}

			if (deleteOld)
			{
				let i = 0;
				ExportLog.addToProgressCap(website.index.deletedFiles.length / 2);
				for (const dFile of website.index.deletedFiles)
				{
					const path = new Path(dFile, destination.path);
					
					// don't delete font files
					// this is a hacky way to prevent it from deleting the matjax and other font files used in only certain files
					if (path.extension == "woff" || path.extension == "woff2" || path.extension == "ttf" || path.extension == "otf")
					{
						ExportLog.progress(0.5, "Deleting Old Files", "Skipping: " + path.path, "var(--color-yellow)");
						continue;
					}

					await path.delete();
					ExportLog.progress(0.5, "Deleting Old Files", "Deleting: " + path.path, "var(--color-red)");
					i++;
				};

				await Path.removeEmptyDirectories(destination.path);
			}
			
			if (saveFiles) 
			{
				await website.saveAsCombinedHTML();
				const resources = website.getCascadeResourceDownloads();
				if (resources.length) await Utils.downloadAttachments(resources);
			}
		}
		catch (e)
		{
			new Notice("❌ Export Failed: " + e, 5000);
			ExportLog.error(e, "Export Failed", true);
		}

		MarkdownRendererAPI.endBatch();

		return website;
	}

	public static async exportFolder(folder: TFolder, rootExportPath: Path, saveFiles: boolean, clearDirectory: boolean) : Promise<Website | undefined>
	{
		const folderPath = new Path(folder.path);
		const allFiles = app.vault.getFiles();
		const files = allFiles.filter((file) => new Path(file.path).directory.path.startsWith(folderPath.path));

		return await this.exportFiles(files, rootExportPath, saveFiles, clearDirectory);
	}

	public static async exportVault(rootExportPath: Path, saveFiles: boolean, clearDirectory: boolean) : Promise<Website | undefined>
	{
		const files = app.vault.getFiles();
		return await this.exportFiles(files, rootExportPath, saveFiles, clearDirectory);
	}

}
