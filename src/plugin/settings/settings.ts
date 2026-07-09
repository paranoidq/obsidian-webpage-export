import { Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, getIcon } from 'obsidian';
import { Path } from 'src/plugin/utils/path';
import { ExportLog } from 'src/plugin/render-api/render-api';
import { createDivider, createDropdown, createFeatureSetting, createFileInput, createSection, createText, createToggle, generateSettingsFromObject }  from './settings-components';
import { ExportPipelineOptions } from "src/plugin/website/pipeline-options.js";
import { i18n } from '../translations/language';
import { EmojiStyle } from 'src/shared/website-data';

// #region Settings Definition

export enum ExportPreset
{
	Online = "online",
	Local = "local",
	RawDocuments = "raw-documents",
}

export enum LogLevel
{
	All = "all",
	Warning = "warning",
	Error = "error",
	Fatal = "fatal",
	None = "none",
}

export class Settings
{
	public static settingsVersion: string = "0.0.0";

	public static exportOptions: ExportPipelineOptions = new ExportPipelineOptions();

	public static logLevel: LogLevel = LogLevel.Warning;
	public static titleProperty: string = "title";
	public static rssDateProperty: string = "date";
	public static onlyExportModified: boolean = true;
	public static deleteOldFiles: boolean = true;
	public static exportPreset: ExportPreset = ExportPreset.Online;
	public static openAfterExport: boolean = true;

	// Graph View Settings
	public static filePickerBlacklist: string[] = ["(^|\\/)node_modules\\/","(^|\\/)dist\\/","(^|\\/)dist-ssr\\/","(^|\\/)\\.vscode\\/"]; // ignore node_modules, dist, and .vscode
	public static filePickerWhitelist: string[] = ["\\.\\w+$"]; // only include files with extensions

	public static async onlinePreset()
	{
		Settings.exportOptions.inlineCSS = false;
		Settings.exportOptions.inlineFonts = false;
		Settings.exportOptions.inlineHTML = false;
		Settings.exportOptions.inlineJS = false;
		Settings.exportOptions.inlineMedia = false;
		Settings.exportOptions.inlineOther = false;

		Settings.exportOptions.slugifyPaths = true;
		Settings.exportOptions.graphViewOptions.setAvailable(true);
		Settings.exportOptions.fileNavigationOptions.setAvailable(true);
		Settings.exportOptions.searchOptions.setAvailable(true);
		Settings.exportOptions.rssOptions.setAvailable(true);
		Settings.exportOptions.combineAsSingleFile = false;

		await SettingsPage.saveSettings();
	}

	public static async localPreset()
	{
		Settings.exportOptions.inlineCSS = true;
		Settings.exportOptions.inlineFonts = true;
		Settings.exportOptions.inlineHTML = false;
		Settings.exportOptions.inlineJS = true;
		Settings.exportOptions.inlineMedia = true;
		Settings.exportOptions.inlineOther = true;
		Settings.exportOptions.slugifyPaths = true;
		Settings.exportOptions.graphViewOptions.setAvailable(true);
		Settings.exportOptions.fileNavigationOptions.setAvailable(true);
		Settings.exportOptions.searchOptions.setAvailable(false);
		Settings.exportOptions.rssOptions.setAvailable(false);
		Settings.exportOptions.combineAsSingleFile = true;

		await SettingsPage.saveSettings();
	}

	public static async rawDocumentsPreset()
	{
		Settings.exportOptions.inlineCSS = true;
		Settings.exportOptions.inlineFonts = true;
		Settings.exportOptions.inlineHTML = true;
		Settings.exportOptions.inlineJS = true;
		Settings.exportOptions.inlineMedia = true;
		Settings.exportOptions.inlineOther = true;
		Settings.exportOptions.slugifyPaths = false;
		Settings.exportOptions.graphViewOptions.setAvailable(false);
		Settings.exportOptions.fileNavigationOptions.setAvailable(false);
		Settings.exportOptions.searchOptions.setAvailable(false);
		Settings.exportOptions.rssOptions.setAvailable(false);
		Settings.exportOptions.combineAsSingleFile = false;

		await SettingsPage.saveSettings();
	}

	static getAllFilesFromPaths(paths: string[]): string[]
	{
		const files: string[] = [];

		const allFilePaths = app.vault.getFiles().map(f => f.path);
		if (!paths || paths.length == 0) return allFilePaths;

		for (const path of paths)
		{
			const file = app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) files.push(file.path);
			else if (file instanceof TFolder)
			{
				const newFiles = allFilePaths.filter((f) => f.startsWith(file?.path ?? "*"));
				files.push(...newFiles);
			}
		};

		let filteredFiles = files.filter((file) => Settings.isPathAllowedByFilePicker(file));
		return filteredFiles;
	}

	static isPathAllowedByFilePicker(path: string): boolean
	{
		const isBlacklisted = Settings.filePickerBlacklist.some((pattern) => path.match(new RegExp(pattern)));
		const isWhitelisted = Settings.filePickerWhitelist.every((pattern) => path.match(new RegExp(pattern)));
		return !isBlacklisted && isWhitelisted;
	}

	static getFilesToExport(): TFile[]
	{
		return this.getAllFilesFromPaths(Settings.exportOptions.filesToExport).map(p => app.vault.getFileByPath(p)).filter(f => f) as TFile[];
	}

	
}

// #endregion

export class SettingsPage extends PluginSettingTab
{

	display() 
	{
		const { containerEl: container } = this;

		const lang = i18n.settings;

		// #region Settings Header

		container.empty();
		container.classList.add('webpage-html-settings');

		const header = container.createEl('h2', { text: lang.title });
		header.style.display = 'block';
		header.style.marginBottom = '15px';

		const supportContainer = container.createDiv();
		supportContainer.style.marginBottom = '15px';
		const supportLink = container.createEl('a');
		const buttonColor = "3ebba4";
		const buttonTextColor = "ffffff";
		// @ts-ignore
		supportLink.href = `https://www.buymeacoffee.com/nathangeorge`;
		supportLink.style.height = "40px"
		supportLink.innerHTML = `<img style="height:40px;" src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=nathangeorge&button_colour=${buttonColor}&font_colour=${buttonTextColor}&font_family=Poppins&outline_colour=${buttonTextColor}&coffee_colour=FFDD00">`;
		const supportHeader = container.createDiv({ text: lang.support, cls: "setting-item-description" });
		supportHeader.style.display = 'block';

		supportContainer.style.display = 'grid';
		supportContainer.style.gridTemplateColumns = "0.5fr 0.5fr";
		supportContainer.style.gridTemplateRows = "40px 20px";
		supportContainer.appendChild(supportLink); 

		// debug info button
		const debugInfoButton = container.createEl('button');
		const bugIcon = getIcon('bug');
		if (bugIcon) debugInfoButton.appendChild(bugIcon);
		debugInfoButton.style.height = '100%';
		debugInfoButton.style.aspectRatio = '1/1';
		debugInfoButton.style.justifySelf = 'end';
		const debugHeader = container.createDiv({ text: lang.debug, cls: "setting-item-description" });
		debugHeader.style.display = 'block';
		debugHeader.style.justifySelf = 'end';
		debugInfoButton.addEventListener('click', () => {
			navigator.clipboard.writeText(ExportLog.getDebugInfo());
			new Notice("Debug info copied to clipboard!");
		});
		supportContainer.appendChild(debugInfoButton);
		supportContainer.appendChild(supportHeader);
		supportContainer.appendChild(debugHeader);

		// #endregion

		// #region Page Features

		createDivider(container);
		
		let section = createSection(container, lang.pageFeatures.title, lang.pageFeatures.description);
		
		createFeatureSetting(section, lang.document.title, 			Settings.exportOptions.documentOptions,			lang.document.description,
			(container) =>
			{
				createToggle(container, lang.addPageIcon.title,
					() => Settings.exportOptions.addPageIcon,
					(value) => Settings.exportOptions.addPageIcon = value,
					lang.addPageIcon.description);
			}
		);


		createFeatureSetting(section, lang.sidebars.title, 			Settings.exportOptions.sidebarOptions,			lang.sidebars.description);
		createFeatureSetting(section, lang.fileNavigation.title,	Settings.exportOptions.fileNavigationOptions,	lang.fileNavigation.description);
		createFeatureSetting(section, lang.outline.title,			Settings.exportOptions.outlineOptions,			lang.outline.description);
		createFeatureSetting(section, lang.graphView.title, 		Settings.exportOptions.graphViewOptions,		lang.graphView.description);
		createFeatureSetting(section, lang.search.title,			Settings.exportOptions.searchOptions,			lang.search.description);
		createFeatureSetting(section, lang.linkPreview.title,		Settings.exportOptions.linkPreviewOptions,		lang.linkPreview.description);
		createFeatureSetting(section, lang.customHead.title,		Settings.exportOptions.customHeadOptions,		lang.customHead.description);
		createFeatureSetting(section, lang.backlinks.title,			Settings.exportOptions.backlinkOptions,			lang.backlinks.description);
		createFeatureSetting(section, lang.tags.title,				Settings.exportOptions.tagOptions,				lang.tags.description);
		createFeatureSetting(section, lang.aliases.title,			Settings.exportOptions.aliasOptions,			lang.aliases.description);
		// createFeatureSetting(section, lang.properties.title,		Settings.exportOptions.propertiesOptions,		lang.properties.description);
		createFeatureSetting(section, lang.rss.title,				Settings.exportOptions.rssOptions,				lang.rss.description);

		// #endregion

		// #region General Site Settings

		createDivider(container);
		section = createSection(container, lang.generalSettingsSection.title, lang.generalSettingsSection.description);
		
		createFileInput(section,
			() => Settings.exportOptions.faviconPath,
			(value) => Settings.exportOptions.faviconPath = value,
			{
				name: lang.favicon.title,
				description: lang.favicon.description,
				placeholder: i18n.pathInputPlaceholder,
				makeRelativeToVault: true,
				pickFolder: false,
				validation: (path) => path.validate(
					{
						allowEmpty: true,
						allowAbsolute: true,
						allowRelative: true,
						allowFiles: true,
						requireExists: true,
						requireExtentions: ["png", "ico", "jpg", "jpeg", "svg"]
					}),
				browseButton: true,
			});

		createText(section, lang.siteName.title, 
			() => Settings.exportOptions.siteName,
			(value) => Settings.exportOptions.siteName = value,
			lang.siteName.description);

		// #endregion

		//#region Style Settings

		createDivider(container);

		section = createSection(container, lang.styleOptionsSection.title,
			lang.styleOptionsSection.description);

		createDropdown(section, lang.iconEmojiStyle.title,
			() => Settings.exportOptions.iconEmojiStyle,
			(value) => Settings.exportOptions.iconEmojiStyle = value as EmojiStyle,
			EmojiStyle, 
			lang.iconEmojiStyle.description);

		// Theme / plugin / style-id selection removed: export CSS is frozen
		// (Obsidian core + Prism + Code Styler) via Static assets.

		//#endregion
	
		//#region Export Settings

		createDivider(container);

		section = createSection(container, lang.exportSettingsSection.title,
			lang.exportSettingsSection.description);

		createToggle(section, lang.relativeHeaderLinks.title, 
			() => Settings.exportOptions.relativeHeaderLinks, 
			(value) => Settings.exportOptions.relativeHeaderLinks = value, 
			lang.relativeHeaderLinks.description);

		createToggle(section, lang.slugifyPaths.title,
			() => Settings.exportOptions.slugifyPaths,
			(value) => Settings.exportOptions.slugifyPaths = value,
			lang.slugifyPaths.description);

		createToggle(section, lang.makeOfflineCompatible.title,
			() => Settings.exportOptions.offlineResources,
			(value) => Settings.exportOptions.offlineResources = value,
			lang.makeOfflineCompatible.description);

		// #endregion

		// #region Obsidian Settings

		createDivider(container);

		section = createSection(container, lang.obsidianSettingsSection.title,
			lang.obsidianSettingsSection.description);
		
		createDropdown(section, lang.logLevel.title,
			() => Settings.logLevel,
			(value) => Settings.logLevel = value as LogLevel,
			LogLevel,
			lang.logLevel.description);

		createText(section, lang.titleProperty.title,
			() => Settings.titleProperty,
			(value) => Settings.titleProperty = value,
			lang.titleProperty.description);
		
		// #endregion
	}

	// #region Class Functions and Variables
	static plugin: Plugin;
	static loaded = false;

	constructor(plugin: Plugin) {
		super(app, plugin);
		SettingsPage.plugin = plugin;
	}

	static deepAssign(truth: any, source: any)
	{
		if (!source) return;
		let objects = Object.values(truth);
		let keys = Object.keys(truth);
		for (let i = 0; i < objects.length; i++)
		{
			let key = keys[i];
			let type = typeof objects[i];
			if (type == "object" && source[key] != undefined)
			{
				if (Array.isArray(objects[i]))
				{
					truth[key] = source[key];
				}
				else
				{
					SettingsPage.deepAssign(objects[i], source[key]);
				}
			}
			else if (source[key] != undefined)
			{
				truth[key] = source[key];
			}
		}

		return truth;
	}

	static deepCopy(truth: any): any
	{
		return JSON.parse(JSON.stringify(truth));
	}

	static deepRemoveStartingWith(truth: any, prefix: string): any
	{
		const keys = Object.keys(truth);
		for (let i = 0; i < keys.length; i++)
		{
			if (keys[i].startsWith(prefix))
			{
				delete truth[keys[i]];
			}

			let type = typeof truth[keys[i]];
			if (type == "object")
			{
				SettingsPage.deepRemoveStartingWith(truth[keys[i]], prefix);
			}
		}
		return truth;
	}

	static async loadSettings() 
	{
		const loadedSettings = await SettingsPage.plugin.loadData();
		// do a deep object assign so any non exisant values anywhere in the default settings are preserved
		SettingsPage.deepAssign(Settings, loadedSettings);
		// Reconstruct feature option instances to preserve constructor-set properties
		Settings.exportOptions.reconstructFeatureOptions();
		SettingsPage.saveSettings();
		SettingsPage.loaded = true;
	}

	static async saveSettings() 
	{
		let copy = SettingsPage.deepCopy({...Settings});
		copy = SettingsPage.deepRemoveStartingWith(copy, "info_");
		await SettingsPage.plugin.saveData(copy);
	}

	static renameFile(file: TFile, oldPath: string)
	{
		const oldPathParsed = new Path(oldPath).path;
		let fileList = Settings.exportOptions.filesToExport;
		const index = fileList.indexOf(oldPathParsed);
		if (index >= 0)
		{
			fileList[index] = file.path;
		}

		SettingsPage.saveSettings();
	}

	// #endregion
}
