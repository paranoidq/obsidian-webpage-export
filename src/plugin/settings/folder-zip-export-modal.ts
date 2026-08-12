import { ButtonComponent, Modal, Notice, TFolder } from "obsidian";
import { Settings, SettingsPage } from "./settings";
import { Path } from "src/plugin/utils/path";
import { FileDialogs } from "src/plugin/utils/file-dialogs";
import { createDropdown, createFileInput, createText, createToggle } from "./settings-components";
import { i18n } from "src/plugin/translations/language";
import { Utils } from "src/plugin/utils/utils";
import {
	FolderZipCompressionLevel,
	FolderZipExporter,
} from "src/plugin/utils/folder-zip-export";

export class FolderZipExportModal extends Modal
{
	private folder: TFolder;
	private exportButton: ButtonComponent | undefined;
	private formDisabled = false;
	private progressEl: HTMLElement | undefined;
	private progressBar: HTMLProgressElement | undefined;
	private progressMessageEl: HTMLElement | undefined;
	private progressDetailEl: HTMLElement | undefined;
	private controlsEl: HTMLElement | undefined;

	constructor(folder: TFolder)
	{
		super(app);
		this.folder = folder;
	}

	onOpen()
	{
		const lang = i18n.folderZipExportModal;
		const { contentEl } = this;
		contentEl.empty();

		this.titleEl.setText(lang.exportAsTitle.format(this.folder.name));

		this.controlsEl = contentEl.createDiv({ cls: "folder-zip-export-controls" });

		createDropdown(
			this.controlsEl,
			lang.compression.title,
			() => Settings.folderZipExport.compressionLevel,
			(value) =>
			{
				Settings.folderZipExport.compressionLevel = value as FolderZipCompressionLevel;
			},
			{
				[lang.compression.low]: "low",
				[lang.compression.medium]: "medium",
				[lang.compression.high]: "high",
			},
			lang.compression.description
		);

		createText(
			this.controlsEl,
			lang.splitVolume.title,
			() => String(Settings.folderZipExport.splitVolumeMB),
			(value) =>
			{
				const parsed = Number(value);
				if (!Number.isFinite(parsed) || parsed < 0)
				{
					return;
				}
				Settings.folderZipExport.splitVolumeMB = parsed;
			},
			lang.splitVolume.description,
			(value) =>
			{
				const parsed = Number(value);
				if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0)
				{
					return lang.invalidSplitVolume;
				}
				return "";
			}
		);

		createToggle(
			this.controlsEl,
			lang.openAfterExport,
			() => Settings.folderZipExport.openAfterExport,
			(value) =>
			{
				Settings.folderZipExport.openAfterExport = value;
			}
		);

		const validatePath = (path: Path) =>
			path.validate({
				allowEmpty: false,
				allowRelative: false,
				allowAbsolute: true,
				allowDirectories: true,
				allowTildeHomeDirectory: true,
				requireExists: true,
			});

		const defaultPath =
			Settings.folderZipExport.exportPath &&
			new Path(Settings.folderZipExport.exportPath).exists
				? new Path(Settings.folderZipExport.exportPath)
				: FileDialogs.idealDefaultPath();

		if (!Settings.folderZipExport.exportPath)
		{
			Settings.folderZipExport.exportPath = defaultPath.path;
		}

		const setExportDisabled = (disabled: boolean) =>
		{
			if (!this.exportButton) return;
			this.exportButton.setDisabled(disabled || this.formDisabled);
			this.exportButton.buttonEl.style.opacity =
				disabled || this.formDisabled ? "0.5" : "1";
		};

		const pathSection = this.controlsEl.createDiv({
			cls: "folder-zip-export-path",
		});
		pathSection.createDiv({
			cls: "folder-zip-export-path-title setting-item-name",
			text: lang.exportPath.title,
		});
		pathSection.createDiv({
			cls: "folder-zip-export-path-hint setting-item-description",
			text: lang.exportPath.description,
		});

		const pathInput = createFileInput(
			pathSection,
			() => Settings.folderZipExport.exportPath,
			(value) =>
			{
				Settings.folderZipExport.exportPath = value;
			},
			{
				name: "",
				description: "",
				placeholder: i18n.pathInputPlaceholder,
				defaultPath,
				pickFolder: true,
				validation: validatePath,
				onChanged: (path) => setExportDisabled(!validatePath(path).valid),
			}
		);

		pathInput.fileInput.settingEl.addClass("folder-zip-export-path-row");
		pathInput.textInput.inputEl.addClass("folder-zip-export-path-input");

		pathInput.fileInput.addButton((button) =>
		{
			this.exportButton = button;
			button.setCta();
			button.setButtonText(lang.exportButton).onClick(async () =>
			{
				await this.runExport();
			});
		});

		const initialValid = validatePath(new Path(Settings.folderZipExport.exportPath));
		setExportDisabled(!initialValid.valid);

		this.progressEl = contentEl.createDiv({ cls: "folder-zip-export-progress" });
		this.progressEl.style.display = "none";
		this.progressEl.style.marginTop = "1em";

		this.progressMessageEl = this.progressEl.createDiv({
			cls: "setting-item-name",
		});
		this.progressDetailEl = this.progressEl.createDiv({
			cls: "setting-item-description",
		});
		this.progressDetailEl.style.marginBottom = "0.5em";

		this.progressBar = this.progressEl.createEl("progress", {
			cls: "folder-zip-export-progress-bar",
		});
		this.progressBar.value = 0;
		this.progressBar.max = 1;
		this.progressBar.style.width = "100%";
	}

	private setFormEnabled(enabled: boolean)
	{
		this.formDisabled = !enabled;
		if (this.controlsEl)
		{
			this.controlsEl.style.pointerEvents = enabled ? "" : "none";
			this.controlsEl.style.opacity = enabled ? "1" : "0.6";
		}
		if (this.exportButton)
		{
			this.exportButton.setDisabled(!enabled);
			this.exportButton.buttonEl.style.opacity = enabled ? "1" : "0.5";
		}
	}

	private showProgress(fraction: number, message: string, detail?: string)
	{
		if (!this.progressEl || !this.progressBar || !this.progressMessageEl || !this.progressDetailEl)
		{
			return;
		}
		this.progressEl.style.display = "";
		this.progressBar.value = fraction;
		this.progressMessageEl.setText(message);
		this.progressDetailEl.setText(detail ?? "");
	}

	private async runExport()
	{
		const lang = i18n.folderZipExportModal;
		const exportPath = new Path(Settings.folderZipExport.exportPath);
		const validation = exportPath.validate({
			allowEmpty: false,
			allowRelative: false,
			allowAbsolute: true,
			allowDirectories: true,
			allowTildeHomeDirectory: true,
			requireExists: true,
		});
		if (!validation.valid)
		{
			new Notice(validation.error || i18n.pathValidations.mustExist, 5000);
			return;
		}

		await SettingsPage.saveSettings();
		this.setFormEnabled(false);
		this.showProgress(0, lang.progress.collecting);

		try
		{
			const result = await FolderZipExporter.export({
				folder: this.folder,
				exportDir: exportPath,
				compressionLevel: Settings.folderZipExport.compressionLevel,
				splitVolumeMB: Settings.folderZipExport.splitVolumeMB,
				onProgress: (fraction, message, detail) =>
				{
					this.showProgress(fraction, message, detail);
				},
			});

			this.showProgress(1, lang.progress.done);
			const noticeText =
				result.volumeCount > 1
					? lang.successSplit.format(result.outputDir, String(result.volumeCount))
					: lang.success.format(result.outputDir);
			new Notice(noticeText, 8000);

			if (Settings.folderZipExport.openAfterExport)
			{
				await Utils.openPath(exportPath);
			}

			this.close();
		}
		catch (error)
		{
			const message = error instanceof Error ? error.message : String(error);
			new Notice(lang.failed.format(message), 8000);
			this.setFormEnabled(true);
		}
	}

	onClose()
	{
		this.contentEl.empty();
	}
}
