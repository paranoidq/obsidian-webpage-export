import { ButtonComponent, Modal, Setting, TFile } from 'obsidian';
import { Utils } from 'src/plugin/utils/utils';
import HTMLExportPlugin from 'src/plugin/main';
import { Settings, SettingsPage } from './settings';
import { FilePickerTree } from 'src/plugin/features/file-picker';
import { Path } from 'src/plugin/utils/path';
import { FileDialogs } from 'src/plugin/utils/file-dialogs';
import { createFileInput, createToggle, createDropdown } from './settings-components';
import { Website } from 'src/plugin/website/website';
import { i18n } from '../translations/language';
import { ImageCompressionLevel } from 'src/plugin/utils/image-compressor';
import { DocumentFontSize, ExportOutputMode } from 'src/plugin/website/pipeline-options';

export interface ExportInfo
{
	canceled: boolean;
	pickedFiles: TFile[];
	exportPath: Path;
	validPath: boolean;
	/** Cascade-only: whether to parse the entry as a directory tree (session-only, default true). */
	parseEntryAsDirectory: boolean;
}

export class ExportModal extends Modal 
{
	private isClosed: boolean = true;
	private canceled: boolean = true;
	private filePickerModalEl: HTMLElement;
	private filePicker: FilePickerTree;
	private pickedFiles: TFile[] | undefined = undefined;
	private pickedFilesLocked: boolean = false;
	private cascadeOptionsEnabled: boolean = false;
	private parseEntryAsDirectory: boolean = true;
	private validPath: boolean = true;
	public static title: string = i18n.exportModal.title;

	public exportInfo: ExportInfo;

	constructor() {
		super(app);
	}

	overridePickedFiles(files: TFile[])
	{
		this.pickedFiles = files;
	}

	lockPickedFiles(files: TFile[])
	{
		this.pickedFiles = files;
		this.pickedFilesLocked = true;
	}

	enableCascadeOptions()
	{
		this.cascadeOptionsEnabled = true;
		this.parseEntryAsDirectory = true;
	}

	/**
	 * @brief Opens the modal and async blocks until the modal is closed.
	 * @returns True if the EXPORT button was pressed, false is the export was canceled.
	 * @override
	*/
	async open(): Promise<ExportInfo> 
	{
		this.isClosed = false;
		this.canceled = true;
		const lang = i18n.exportModal;

		super.open();

		if(!this.pickedFilesLocked && !this.filePickerModalEl)
		{
			this.filePickerModalEl = this.containerEl.createDiv({ cls: 'modal' });
			this.containerEl.insertBefore(this.filePickerModalEl, this.modalEl);
			this.filePickerModalEl.style.position = 'relative';
			this.filePickerModalEl.style.zIndex = "1";
			this.filePickerModalEl.style.width = "25em";
			this.filePickerModalEl.style.padding = "0";
			this.filePickerModalEl.style.margin = "10px";
			this.filePickerModalEl.style.maxHeight = "80%";
			this.filePickerModalEl.style.boxShadow = "0 0 7px 1px inset #00000060";
			
			const scrollArea = this.filePickerModalEl.createDiv({ cls: 'tree-scroll-area' });
			scrollArea.style.height = "100%";
			scrollArea.style.width = "100%";
			scrollArea.style.overflowY = "auto";
			scrollArea.style.overflowX = "hidden";
			scrollArea.style.padding = "1em";
			scrollArea.style.boxShadow = "0 0 7px 1px inset #00000060";

			const paths = app.vault.getFiles().map(file => new Path(file.path));
			this.filePicker = new FilePickerTree(paths, true, true);
			this.filePicker.regexBlacklist.push(...Settings.filePickerBlacklist);
			this.filePicker.regexBlacklist.push(...[Settings.exportOptions.customHeadOptions.sourcePath, Settings.exportOptions.faviconPath]);
			this.filePicker.regexWhitelist.push(...Settings.filePickerWhitelist);
			
			this.filePicker.generateWithItemsClosed = true;
			this.filePicker.showFileExtentionTags = true;
			this.filePicker.hideFileExtentionTags = ["md"];
			this.filePicker.title = lang.filePicker.title;
			this.filePicker.class = "file-picker";
			await this.filePicker.generate(scrollArea);
			
			if((this.pickedFiles?.length ?? 0 > 0) || Settings.exportOptions.filesToExport.length > 0) 
			{
				const filesToPick = this.pickedFiles?.map(file => file.path) ?? Settings.exportOptions.filesToExport;
				this.filePicker.setSelectedFiles(filesToPick);
			}

			const saveFiles = new Setting(this.filePickerModalEl).addButton((button) => 
			{
				button.setButtonText(lang.filePicker.save).onClick(async () =>
				{
					Settings.exportOptions.filesToExport = this.filePicker.getSelectedFilesSavePaths();
					await SettingsPage.saveSettings();
				});
			});

			saveFiles.settingEl.style.border = "none";
			saveFiles.settingEl.style.marginRight = "1em";
		}


		const { contentEl } = this;

		contentEl.empty();

		this.titleEl.setText(ExportModal.title);

		if (HTMLExportPlugin.updateInfo.updateAvailable) 
		{
			// create red notice showing the update is available
			const updateNotice = contentEl.createEl('strong', { text: `${i18n.updateAvailable}: ${HTMLExportPlugin.updateInfo.currentVersion} ⟶ ${HTMLExportPlugin.updateInfo.latestVersion}` });
			updateNotice.setAttribute("style",
				`margin-block-start: calc(var(--h3-size)/2);
			background-color: var(--interactive-normal);
			padding: 4px;
			padding-left: 1em;
			padding-right: 1em;
			color: var(--color-red);
			border-radius: 5px;
			display: block;
			width: fit-content;`)

			// create normal block with update notes
			const updateNotes = contentEl.createEl('div', { text: HTMLExportPlugin.updateInfo.updateNote });
			updateNotes.setAttribute("style",
				`margin-block-start: calc(var(--h3-size)/2);
			background-color: var(--background-secondary-alt);
			padding: 4px;
			padding-left: 1em;
			padding-right: 1em;
			color: var(--text-normal);
			font-size: var(--font-ui-smaller);
			border-radius: 5px;
			display: block;
			width: fit-content;
			white-space: pre-wrap;`)
		}

		// add purge export button
		new Setting(contentEl)
			
			.addButton((button) => button
			.setButtonText(lang.purgeExport.clearCache)
			.onClick(async () =>
			{
				// create a modal to confirm the deletion
				const confirmModal = new Modal(app);
				confirmModal.titleEl.setText(lang.purgeExport.confirmation);
				let warning = confirmModal.contentEl.createEl('p', { text: lang.purgeExport.clearWarning });
				warning.style.whiteSpace = "pre-wrap";
				confirmModal.open();

				new Setting(confirmModal.contentEl)
				.addButton((button) => button
				.setButtonText(i18n.cancel)
				.onClick(() => confirmModal.close()))
				.addButton((button) => button
				.setButtonText(lang.purgeExport.clearCache)
				.onClick(async () =>
				{
					const path = new Path(exportPathInput.textInput.getValue());
					const website = await new Website(path).load();
					await website.index.clearCache();
					onChanged(path);
					confirmModal.close();
				}));
			})).setDesc(lang.purgeExport.description);

		

		createToggle(contentEl, lang.openAfterExport, () => Settings.openAfterExport, (value) => Settings.openAfterExport = value);

		if (this.cascadeOptionsEnabled)
		{
			createToggle(
				contentEl,
				lang.parseEntryAsDirectory.title,
				() => this.parseEntryAsDirectory,
				(value) => { this.parseEntryAsDirectory = value; },
				lang.parseEntryAsDirectory.description,
			);
		}

		const longPageLabels = lang.longPage;
		createDropdown(
			contentEl,
			longPageLabels.outputMode.title,
			() => Settings.exportOptions.outputMode,
			(value) => { Settings.exportOptions.outputMode = value as ExportOutputMode; updatePdfVisibility(); },
			{
				[longPageLabels.outputMode.longPage]: ExportOutputMode.LongPage,
				[longPageLabels.outputMode.site]: ExportOutputMode.Site,
			},
			longPageLabels.outputMode.description,
		);

		const pdfSetting = createToggle(contentEl, longPageLabels.pdf.title,
			() => Settings.exportOptions.exportPdf,
			(value) => Settings.exportOptions.exportPdf = value,
			longPageLabels.pdf.description);
		const updatePdfVisibility = () => pdfSetting.settingEl.style.display =
			Settings.exportOptions.outputMode === ExportOutputMode.LongPage ? "" : "none";
		updatePdfVisibility();

		const compressionLabels = lang.imageCompression;
		createDropdown(
			contentEl,
			compressionLabels.title,
			() => Settings.exportOptions.imageCompressionLevel,
			(value) => Settings.exportOptions.imageCompressionLevel = value as ImageCompressionLevel,
			{
				[compressionLabels.none]: ImageCompressionLevel.None,
				[compressionLabels.low]: ImageCompressionLevel.Low,
				[compressionLabels.medium]: ImageCompressionLevel.Medium,
				[compressionLabels.high]: ImageCompressionLevel.High,
			},
			compressionLabels.description,
		);

		const fontSizeLabels = lang.documentFontSize;
		createDropdown(
			contentEl,
			fontSizeLabels.title,
			() => Settings.exportOptions.documentFontSize,
			(value) => Settings.exportOptions.documentFontSize = value as DocumentFontSize,
			{
				[fontSizeLabels.small]: DocumentFontSize.Small,
				[fontSizeLabels.medium]: DocumentFontSize.Medium,
				[fontSizeLabels.large]: DocumentFontSize.Large,
			},
			fontSizeLabels.description,
		);

		createToggle(
			contentEl,
			lang.printSelectableText.title,
			() => Settings.exportOptions.printSelectableText,
			(value) => Settings.exportOptions.printSelectableText = value,
			lang.printSelectableText.description,
		);

		let exportButton : ButtonComponent | undefined = undefined;

		function setExportDisabled(disabled: boolean)
		{
			if(exportButton) 
			{
				exportButton.setDisabled(disabled);
				if (exportButton.disabled) exportButton.buttonEl.style.opacity = "0.5";
				else exportButton.buttonEl.style.opacity = "1";
			}
		}

		const validatePath = (path: Path) => path.validate(
		{
			allowEmpty: false,
			allowRelative: false,
			allowAbsolute: true,
			allowDirectories: true,
			allowTildeHomeDirectory: true,
			requireExists: true
		});

		const onChangedValidate = (path: Path) => (!validatePath(path).valid) ? setExportDisabled(true) : setExportDisabled(false);

		const onChanged = (path: Path) =>
		{
			onChangedValidate(path);
			this.validPath = validatePath(path).valid;
			exportDescription.setText(this.validPath ? lang.timestampFolderDescription : "");
		}

		const exportPathInput = createFileInput(contentEl, () => Settings.exportOptions.exportPath, (value) => Settings.exportOptions.exportPath = value,
		{
			name: '',
			description: '',
			placeholder: i18n.pathInputPlaceholder,
			defaultPath: FileDialogs.idealDefaultPath(),
			pickFolder: true,
			validation: validatePath,
			onChanged: onChanged
		});

		const { fileInput } = exportPathInput;
		
		fileInput.addButton((button) => {
			exportButton = button;
			setExportDisabled(!this.validPath);
			button.setButtonText(lang.exportButton).onClick(async () => 
			{
				this.canceled = false;
				this.close();
			});
		});

		// The selected path is a parent; each export reserves its own folder.
		const exportDescription = contentEl.createEl('div', { text: lang.timestampFolderDescription, cls: 'setting-item-description'});
		exportDescription.style.marginBottom = "1em";
		onChanged(new Path(exportPathInput.textInput.getValue()));

		if (this.filePickerModalEl) this.filePickerModalEl.style.height = this.modalEl.clientHeight * 2 + "px";

		new Setting(contentEl)
		.setDesc(lang.moreOptions)
		.addExtraButton((button) => button.setTooltip('Open plugin settings').onClick(() => {
			//@ts-ignore
			app.setting.open();
			//@ts-ignore
			app.setting.openTabById('webpage-html-export');
		}));

		await Utils.waitUntil(() => this.isClosed, 60 * 60 * 1000, 10);
		
		if (!this.pickedFilesLocked) this.pickedFiles = this.filePicker.getSelectedFiles();
		this.filePickerModalEl?.remove();
		this.exportInfo = {
			canceled: this.canceled,
			pickedFiles: this.pickedFiles ?? [],
			exportPath: new Path(Settings.exportOptions.exportPath),
			validPath: this.validPath,
			parseEntryAsDirectory: this.cascadeOptionsEnabled ? this.parseEntryAsDirectory : true,
		};

		return this.exportInfo;
	}

	onClose() 
	{
		const { contentEl } = this;
		contentEl.empty();
		this.isClosed = true;
		ExportModal.title = i18n.exportModal.title;
	}
}
