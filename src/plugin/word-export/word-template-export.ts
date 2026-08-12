import { Notice, TFile } from "obsidian";
import { Path } from "src/plugin/utils/path";
import { Website } from "src/plugin/website/website";
import {
	DocxEmbedError,
	embedHtmlAttachmentsInDocx,
	HtmlAttachmentSpec,
} from "./docx-ole-embedder";
import { ExportLog } from "src/plugin/render-api/render-api";

const WORD_TEMPLATE_PROPERTY = "word-template";

export interface WordHtmlAttachmentInput
{
	/** Empty string = bare `{{html_attachment}}`; otherwise `{{html_attachment:id}}`. */
	key: string;
	htmlPath: Path;
}

export interface WordTemplateExportContext
{
	destination: Path;
	/** Attachments to embed (keyed and/or bare). */
	attachments: WordHtmlAttachmentInput[];
	/** Markdown files whose frontmatter may specify word-template. */
	entryFiles: TFile[];
}

/**
 * Resolve the combined HTML file name the same way Website.saveAsCombinedHTML does.
 */
export function resolveCombinedHtmlFileName(website: Website): string
{
	if (website.cascadeContext)
	{
		const entry = website.index.getWebpage(website.cascadeContext.entrySourcePath);
		return entry?.targetPath.fullName
			?? website.cascadeContext.entryOutputFileName
			?? new Path(website.cascadeContext.entryFile.basename).setExtension("html").fullName;
	}

	return website.exportOptions.siteName + ".html";
}

export function resolveCombinedHtmlPath(website: Website, destination: Path): Path
{
	return destination.joinString(resolveCombinedHtmlFileName(website));
}

/**
 * After a successful HTML export, for each entry file with `word-template` frontmatter,
 * copy the template and embed matching HTML attachments.
 * Failures are reported via Notice and never modify the original template.
 */
export async function exportWordTemplatesAfterHtml(context: WordTemplateExportContext): Promise<void>
{
	if (context.attachments.length === 0)
	{
		ExportLog.warning("Word export skipped: no HTML attachments to embed");
		return;
	}

	const attachmentSpecs: HtmlAttachmentSpec[] = [];
	for (const input of context.attachments)
	{
		const htmlPath = input.htmlPath.absoluted();
		if (!htmlPath.exists || !htmlPath.isFile)
		{
			const msg = `Word export: HTML not found for key "${input.key || "(bare)"}": ${htmlPath.path}`;
			ExportLog.warning(msg);
			new Notice(msg, 8000);
			continue;
		}

		const htmlBytes = await htmlPath.readAsBuffer();
		if (!htmlBytes)
		{
			new Notice(`Word export skipped: could not read ${htmlPath.fullName}`, 8000);
			continue;
		}

		attachmentSpecs.push({
			key: input.key,
			htmlBytes,
			attachmentFileName: htmlPath.fullName,
		});
	}

	if (attachmentSpecs.length === 0)
	{
		new Notice("Word export skipped: no readable HTML attachments", 8000);
		return;
	}

	const seenTemplates = new Set<string>();
	let attempted = 0;

	for (const file of context.entryFiles)
	{
		if (file.extension !== "md") continue;

		const templateRel = readWordTemplatePath(file);
		if (!templateRel) continue;
		attempted++;

		const key = `${file.path}::${templateRel}`;
		if (seenTemplates.has(key)) continue;
		seenTemplates.add(key);

		try
		{
			await exportOneWordTemplate({
				entryFile: file,
				templateRel,
				destination: context.destination,
				attachments: attachmentSpecs,
			});
		}
		catch (e)
		{
			const message = e instanceof Error ? e.message : String(e);
			ExportLog.error(e, "Word template export failed for " + file.path);
			new Notice(`Word export failed (${file.basename}): ${message}`, 10000);
		}
	}

	if (attempted === 0 && context.entryFiles.some((f) => f.extension === "md"))
	{
		ExportLog.warning(
			"Word export skipped: no `word-template` frontmatter on entry file(s): "
			+ context.entryFiles.map((f) => f.path).join(", ")
		);
	}
}

function readWordTemplatePath(file: TFile): string | undefined
{
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const raw = frontmatter?.[WORD_TEMPLATE_PROPERTY] ?? frontmatter?.["word_template"];
	const value = normalizeTemplatePathValue(raw);
	if (!value) return undefined;
	return value;
}

function normalizeTemplatePathValue(raw: unknown): string | undefined
{
	if (Array.isArray(raw) && raw.length > 0)
		return normalizeTemplatePathValue(raw[0]);
	if (typeof raw !== "string") return undefined;

	let value = raw.trim();
	if (!value) return undefined;

	// Support Obsidian wikilink form: [[path/to/file.docx]] or [[path|alias]]
	const wiki = value.match(/^\[\[(.+?)\]\]$/);
	if (wiki) value = wiki[1].split("|")[0].trim();

	return value.replace(/\\/g, "/").replace(/^\//, "");
}

async function exportOneWordTemplate(options: {
	entryFile: TFile;
	templateRel: string;
	destination: Path;
	attachments: HtmlAttachmentSpec[];
}): Promise<void>
{
	const templatePath = resolveVaultFilePath(options.templateRel);
	if (!templatePath || !templatePath.exists || !templatePath.isFile)
	{
		throw new Error(
			`Word template not found: "${options.templateRel}" (check vault-relative path / filename)`
		);
	}

	if (templatePath.extensionName.toLowerCase() !== "docx")
		throw new Error(`Word template must be a .docx file: ${options.templateRel}`);

	const templateBytes = await templatePath.readAsBuffer();
	if (!templateBytes)
		throw new Error(`Could not read Word template: ${options.templateRel}`);

	// Snapshot for safety check — never write back to this path.
	const templateAbsolute = templatePath.absoluted().pathname;

	let docxBytes: Buffer;
	try
	{
		docxBytes = await embedHtmlAttachmentsInDocx({
			templateBytes,
			attachments: options.attachments,
		});
	}
	catch (e)
	{
		if (e instanceof DocxEmbedError) throw e;
		throw new Error(e instanceof Error ? e.message : String(e));
	}

	const outName = templatePath.fullName;
	const outPath = options.destination.joinString(outName).absoluted();

	if (outPath.pathname === templateAbsolute)
		throw new Error("Refusing to overwrite the Word template file");

	const written = await outPath.write(docxBytes);
	if (!written)
		throw new Error(`Could not write ${outName}`);

	new Notice(`Word export ready:\n${outPath.path}`, 8000);
}

function resolveVaultFilePath(vaultRelativePath: string): Path | undefined
{
	const normalized = normalizeTemplatePathValue(vaultRelativePath) ?? vaultRelativePath;

	const byPath = app.vault.getAbstractFileByPath(normalized);
	if (byPath instanceof TFile) return new Path(byPath.path);

	// Resolve via Obsidian link path (supports paths relative to vault root).
	const byLink = app.metadataCache.getFirstLinkpathDest(normalized, "");
	if (byLink instanceof TFile) return new Path(byLink.path);

	// Fall back to filesystem path under vault (supports paths metadata cache may miss).
	const fsPath = new Path(normalized, Path.vaultPath.path).absoluted();
	if (fsPath.exists && fsPath.isFile) return fsPath;
	return undefined;
}
