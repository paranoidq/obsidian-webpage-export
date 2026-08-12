import { Notice, TFile } from "obsidian";
import { Path } from "src/plugin/utils/path";
import { Settings } from "src/plugin/settings/settings";
import { Utils } from "src/plugin/utils/utils";
import { Website } from "src/plugin/website/website";
import { ExportLog, MarkdownRendererAPI } from "src/plugin/render-api/render-api";
import { ExportInfo, ExportModal } from "src/plugin/settings/export-modal";
import { CascadeExportContext, CascadeExportResolver } from "./cascade-export-resolver";
import { H1Section, splitMarkdownByH1 } from "./utils/h1-split";
import { Attachment } from "./utils/downloadable";
import {
	exportWordTemplatesAfterHtml,
	resolveCombinedHtmlPath,
	WordHtmlAttachmentInput,
} from "./word-export/word-template-export";

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
		await HTMLExporter.maybeExportWordTemplates(exportPath, website, files);
		if (Settings.openAfterExport) Utils.openPath(exportPath);
		new Notice("✅ Finished HTML Export:\n\n" + exportPath, 5000);
	}

	public static async exportCascadeFromEntry(entryFile: TFile, usePreviousSettings: boolean = false, overrideExportPath: Path | undefined = undefined)
	{
		const info = await this.updateSettings(usePreviousSettings, [entryFile], overrideExportPath, true);
		if ((!info && !usePreviousSettings) || (info && info.canceled)) return;

		const exportPath = overrideExportPath ?? info?.exportPath ?? new Path(Settings.exportOptions.exportPath);
		const exportRoot = new Path(entryFile.path).parent?.path ?? "";

		if (entryFile.extension === "md")
		{
			const markdown = await app.vault.read(entryFile);
			const sections = splitMarkdownByH1(markdown);
			if (sections.length > 0)
			{
				const h1Result = await HTMLExporter.exportCascadeH1Sections(entryFile, sections, exportPath, exportRoot);
				if (!h1Result) return;
				await HTMLExporter.maybeExportWordTemplates(
					exportPath,
					undefined,
					[entryFile],
					undefined,
					h1Result.attachments
				);
				if (Settings.openAfterExport) Utils.openPath(exportPath);
				new Notice("✅ Finished HTML Export:\n\n" + exportPath, 5000);
				return;
			}
		}

		const cascadeContext = CascadeExportResolver.collect(entryFile);
		const website = await HTMLExporter.exportFiles(
			cascadeContext.pageFiles,
			exportPath,
			true,
			Settings.deleteOldFiles,
			exportRoot,
			cascadeContext
		);

		if (!website) return;
		await HTMLExporter.maybeExportWordTemplates(exportPath, website, [entryFile]);
		if (Settings.openAfterExport) Utils.openPath(exportPath);
		new Notice("✅ Finished HTML Export:\n\n" + exportPath, 5000);
	}

	/**
	 * Export each H1 section as its own HTML. Returns Word attachment inputs for
	 * sections tagged with `#word-<id>` (duplicate ids: last wins + warning).
	 */
	private static async exportCascadeH1Sections(
		entryFile: TFile,
		sections: H1Section[],
		destination: Path,
		exportRoot: string
	): Promise<{ attachments: WordHtmlAttachmentInput[] } | undefined>
	{
		MarkdownRendererAPI.beginBatch();
		const previousFilesToExport = [...Settings.exportOptions.filesToExport];
		const resourceByPath = new Map<string, Attachment>();
		let deleteOld = Settings.deleteOldFiles;
		const attachmentById = new Map<string, WordHtmlAttachmentInput>();

		try
		{
			for (let i = 0; i < sections.length; i++)
			{
				const section = sections[i];
				ExportLog.progress(0, `Exporting section ${i + 1}/${sections.length}`, section.title, "var(--color-cyan)");

				const cascadeContext = CascadeExportResolver.collectFromSection(entryFile, {
					entryMarkdownOverride: section.markdown,
					entryOutputFileName: section.outputFileName,
					entryDisplayTitle: section.title,
					entrySectionIndex: section.sourceH1Index,
				});

				Settings.exportOptions.filesToExport = cascadeContext.pageFiles.map((file) => file.path);

				const website = await (await new Website(destination).load(
					cascadeContext.pageFiles,
					exportRoot,
					cascadeContext
				)).build();

				if (!website)
				{
					new Notice("❌ Export Cancelled", 5000);
					return undefined;
				}

				if (deleteOld)
				{
					ExportLog.addToProgressCap(website.index.deletedFiles.length / 2);
					for (const dFile of website.index.deletedFiles)
					{
						const path = new Path(dFile, destination.path);

						if (path.extension == "woff" || path.extension == "woff2" || path.extension == "ttf" || path.extension == "otf")
						{
							ExportLog.progress(0.5, "Deleting Old Files", "Skipping: " + path.path, "var(--color-yellow)");
							continue;
						}

						await path.delete();
						ExportLog.progress(0.5, "Deleting Old Files", "Deleting: " + path.path, "var(--color-red)");
					}

					await Path.removeEmptyDirectories(destination.path);
					deleteOld = false;
				}

				const htmlPath = await website.saveAsCombinedHTML();

				if (section.wordAttachmentId)
				{
					if (attachmentById.has(section.wordAttachmentId))
					{
						ExportLog.warning(
							`Duplicate #word-${section.wordAttachmentId} on H1 "${section.title}"; using the later section`
						);
					}
					attachmentById.set(section.wordAttachmentId, {
						key: section.wordAttachmentId,
						htmlPath,
					});
				}

				for (const resource of website.getCascadeResourceDownloads())
					resourceByPath.set(resource.targetPath.path, resource);
			}

			const resources = [...resourceByPath.values()];
			if (resources.length) await Utils.downloadAttachments(resources);
			return { attachments: [...attachmentById.values()] };
		}
		catch (e)
		{
			new Notice("❌ Export Failed: " + e, 5000);
			ExportLog.error(e, "Export Failed", true);
			return undefined;
		}
		finally
		{
			Settings.exportOptions.filesToExport = previousFilesToExport;
			MarkdownRendererAPI.endBatch();
		}
	}

	public static async exportFiles(files: TFile[], destination: Path, saveFiles: boolean, deleteOld: boolean, exportRoot?: string, cascadeContext?: CascadeExportContext) : Promise<Website | undefined>
	{
		MarkdownRendererAPI.beginBatch();
		let website = undefined;
		const previousFilesToExport = [...Settings.exportOptions.filesToExport];
		// Align canvas/embed inlining with the actual pages in this export batch
		Settings.exportOptions.filesToExport = files.map((file) => file.path);
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
		finally
		{
			Settings.exportOptions.filesToExport = previousFilesToExport;
		}

		MarkdownRendererAPI.endBatch();

		return website;
	}

	public static async exportVault(rootExportPath: Path, saveFiles: boolean, clearDirectory: boolean) : Promise<Website | undefined>
	{
		const files = app.vault.getFiles();
		return await this.exportFiles(files, rootExportPath, saveFiles, clearDirectory);
	}

	private static async maybeExportWordTemplates(
		destination: Path,
		website: Website | undefined,
		entryFiles: TFile[],
		htmlPathOverride?: Path,
		attachmentsOverride?: WordHtmlAttachmentInput[]
	): Promise<void>
	{
		try
		{
			let attachments = attachmentsOverride;
			if (!attachments)
			{
				const htmlPath = htmlPathOverride
					?? (website ? resolveCombinedHtmlPath(website, destination) : undefined);
				if (!htmlPath) return;
				attachments = [{ key: "", htmlPath }];
			}

			if (attachments.length === 0)
			{
				ExportLog.warning(
					"Word export skipped: H1 sections exported but none were tagged with #word-<id>"
				);
				return;
			}

			await exportWordTemplatesAfterHtml({
				destination,
				attachments,
				entryFiles,
			});
		}
		catch (e)
		{
			ExportLog.error(e, "Word template export failed");
			new Notice("Word export failed: " + (e instanceof Error ? e.message : String(e)), 7000);
		}
	}

}
