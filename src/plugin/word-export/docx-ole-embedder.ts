import JSZip from "jszip";
import { createOlePackageBin } from "./ole-package";
import {
	OLE_ICON_DISPLAY_HEIGHT_PT,
	OLE_ICON_DISPLAY_WIDTH_PT,
	renderOleIconWithLabel,
} from "./ole-icon-renderer";

/** Bare placeholder for a single HTML export (non-H1-split). */
export const HTML_ATTACHMENT_PLACEHOLDER = "{{html_attachment}}";

/** Keyed placeholder prefix: `{{html_attachment:<id>}}`. */
export const HTML_ATTACHMENT_KEYED_PREFIX = "{{html_attachment:";

/** Replaced with the export-time date as `YYYY-mm-dd`. */
export const CURRENT_DATA_PLACEHOLDER = "{{current_data}}";

export interface HtmlAttachmentSpec
{
	/** Placeholder key; empty string means bare `{{html_attachment}}`. */
	key: string;
	htmlBytes: Buffer;
	attachmentFileName: string;
}

export interface EmbedHtmlAttachmentsOptions
{
	templateBytes: Buffer;
	attachments: HtmlAttachmentSpec[];
}

/** @deprecated Prefer embedHtmlAttachmentsInDocx with an attachments list. */
export interface EmbedHtmlAttachmentOptions
{
	templateBytes: Buffer;
	htmlBytes: Buffer;
	attachmentFileName: string;
}

export class DocxEmbedError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "DocxEmbedError";
	}
}

interface TextRun
{
	fullMatch: string;
	text: string;
	index: number;
	openTag: string;
	closeTag: string;
}

interface PlaceholderHit
{
	placeholder: string;
	key: string;
	start: number;
	end: number;
}

/**
 * Copy a .docx template and replace matching HTML attachment placeholders.
 * - Bare `{{html_attachment}}` maps to attachment key `""`
 * - `{{html_attachment:id}}` maps to attachment key `id`
 * - Placeholders without a matching attachment are left unchanged
 * - Throws if none of the provided attachments find a placeholder
 */
export async function embedHtmlAttachmentsInDocx(options: EmbedHtmlAttachmentsOptions): Promise<Buffer>
{
	if (options.attachments.length === 0)
		throw new DocxEmbedError("No HTML attachments provided for Word embed");

	const byKey = new Map<string, HtmlAttachmentSpec>();
	for (const attachment of options.attachments)
		byKey.set(attachment.key, attachment);

	const zip = await JSZip.loadAsync(options.templateBytes);
	const documentPath = "word/document.xml";
	let documentXml = await zip.file(documentPath)?.async("string");
	if (!documentXml)
		throw new DocxEmbedError("Invalid Word template: missing word/document.xml");

	const currentData = formatCurrentData();
	documentXml = replaceAllPlainTextPlaceholders(documentXml, CURRENT_DATA_PLACEHOLDER, currentData);
	await replaceCurrentDataInHeadersAndFooters(zip, currentData);

	const usedIds = await collectExistingIds(zip, documentXml);
	const relsPath = "word/_rels/document.xml.rels";
	let relsXml = (await zip.file(relsPath)?.async("string")) ?? createEmptyRels();
	const newRels: { id: string; type: string; target: string }[] = [];

	let replacedCount = 0;
	let attachmentIndex = 0;

	// Replace from end to start so earlier string offsets stay valid.
	const hits = findPlaceholders(documentXml)
		.filter((hit) => byKey.has(hit.key))
		.sort((a, b) => b.start - a.start);

	for (const hit of hits)
	{
		const attachment = byKey.get(hit.key);
		if (!attachment) continue;

		attachmentIndex++;
		const oleRelId = allocateRelId(usedIds, `rIdHtmlOle${attachmentIndex}`);
		const iconRelId = allocateRelId(usedIds, `rIdHtmlIcon${attachmentIndex}`);

		const nextXml = replacePlaceholderAt(
			documentXml,
			hit,
			oleRelId,
			iconRelId,
			attachment.attachmentFileName
		);
		if (!nextXml) continue;
		documentXml = nextXml;
		replacedCount++;

		const oleBin = createOlePackageBin({
			label: attachment.attachmentFileName,
			fileName: attachment.attachmentFileName,
			data: attachment.htmlBytes,
		});

		const embeddingName = pickUnusedName(zip, "word/embeddings/oleObject", ".bin");
		zip.file(`word/embeddings/${embeddingName}`, oleBin);

		const iconPng = await renderOleIconWithLabel(attachment.attachmentFileName);
		const iconName = pickUnusedName(zip, "word/media/oleHtmlIcon", ".png");
		zip.file(`word/media/${iconName}`, iconPng);

		newRels.push(
			{
				id: oleRelId,
				type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
				target: `embeddings/${embeddingName}`,
			},
			{
				id: iconRelId,
				type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
				target: `media/${iconName}`,
			}
		);
	}

	if (replacedCount === 0)
	{
		const keys = options.attachments.map((a) => a.key || "(bare)").join(", ");
		throw new DocxEmbedError(
			`No matching Word placeholders found for attachment keys: ${keys}`
		);
	}

	zip.file(documentPath, documentXml);
	zip.file(relsPath, upsertRelationships(relsXml, newRels));

	const contentTypesPath = "[Content_Types].xml";
	const contentTypes = await zip.file(contentTypesPath)?.async("string");
	if (!contentTypes)
		throw new DocxEmbedError("Invalid Word template: missing [Content_Types].xml");
	zip.file(contentTypesPath, ensureContentTypes(contentTypes));

	const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
	return Buffer.from(out);
}

/**
 * Back-compat wrapper: embed a single bare `{{html_attachment}}` placeholder.
 */
export async function embedHtmlAttachmentInDocx(options: EmbedHtmlAttachmentOptions): Promise<Buffer>
{
	return embedHtmlAttachmentsInDocx({
		templateBytes: options.templateBytes,
		attachments: [{
			key: "",
			htmlBytes: options.htmlBytes,
			attachmentFileName: options.attachmentFileName,
		}],
	});
}

export function placeholderForKey(key: string): string
{
	return key ? `{{html_attachment:${key}}}` : HTML_ATTACHMENT_PLACEHOLDER;
}

/** Format a date as `YYYY-mm-dd` for `{{current_data}}`. */
export function formatCurrentData(date: Date = new Date()): string
{
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

async function replaceCurrentDataInHeadersAndFooters(zip: JSZip, currentData: string): Promise<void>
{
	const paths = Object.keys(zip.files).filter((name) =>
		/^word\/(header|footer)\d*\.xml$/i.test(name) && !zip.files[name].dir
	);

	for (const path of paths)
	{
		const xml = await zip.file(path)?.async("string");
		if (!xml) continue;
		zip.file(path, replaceAllPlainTextPlaceholders(xml, CURRENT_DATA_PLACEHOLDER, currentData));
	}
}

/**
 * Replace every occurrence of a plain-text placeholder in Word XML,
 * including when Word splits the placeholder across multiple `w:t` runs.
 */
export function replaceAllPlainTextPlaceholders(
	documentXml: string,
	placeholder: string,
	replacement: string
): string
{
	let xml = documentXml;
	while (true)
	{
		const runs = collectTextRuns(xml);
		if (runs.length === 0) break;

		const joined = runs.map((r) => r.text).join("");
		const start = joined.indexOf(placeholder);
		if (start < 0) break;

		const next = replacePlainTextPlaceholderAt(xml, runs, start, start + placeholder.length, replacement);
		if (!next || next === xml) break;
		xml = next;
	}
	return xml;
}

function replacePlainTextPlaceholderAt(
	documentXml: string,
	runs: TextRun[],
	start: number,
	end: number,
	replacement: string
): string | undefined
{
	let cursor = 0;
	let startRun = -1;
	let endRun = -1;
	let startOffsetInRun = 0;
	let endOffsetInRun = 0;

	for (let i = 0; i < runs.length; i++)
	{
		const run = runs[i];
		const next = cursor + run.text.length;
		if (startRun < 0 && start < next)
		{
			startRun = i;
			startOffsetInRun = start - cursor;
		}
		if (end <= next)
		{
			endRun = i;
			endOffsetInRun = end - cursor;
			break;
		}
		cursor = next;
	}

	if (startRun < 0 || endRun < 0) return undefined;

	let middle = "";
	if (startRun === endRun)
	{
		const prefix = runs[startRun].text.slice(0, startOffsetInRun);
		const suffix = runs[startRun].text.slice(endOffsetInRun);
		middle = writeRun(runs[startRun], prefix + replacement + suffix);
	}
	else
	{
		const prefix = runs[startRun].text.slice(0, startOffsetInRun);
		const suffix = runs[endRun].text.slice(endOffsetInRun);
		middle = writeRun(runs[startRun], prefix + replacement);
		for (let i = startRun + 1; i < endRun; i++)
			middle += writeRun(runs[i], "");
		middle += writeRun(runs[endRun], suffix);
	}

	const before = documentXml.slice(0, runs[startRun].index);
	const after = documentXml.slice(runs[endRun].index + runs[endRun].fullMatch.length);
	return before + middle + after;
}

function findPlaceholders(documentXml: string): PlaceholderHit[]
{
	const runs = collectTextRuns(documentXml);
	if (runs.length === 0) return [];

	const joined = runs.map((r) => r.text).join("");
	const hits: PlaceholderHit[] = [];
	const keyed = /\{\{html_attachment:([A-Za-z0-9_-]+)\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = keyed.exec(joined)) !== null)
	{
		hits.push({
			placeholder: match[0],
			key: match[1],
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	let bareIndex = 0;
	while ((bareIndex = joined.indexOf(HTML_ATTACHMENT_PLACEHOLDER, bareIndex)) >= 0)
	{
		// Skip if this position is already part of a keyed placeholder start
		const alreadyKeyed = hits.some((h) => bareIndex >= h.start && bareIndex < h.end);
		if (!alreadyKeyed)
		{
			hits.push({
				placeholder: HTML_ATTACHMENT_PLACEHOLDER,
				key: "",
				start: bareIndex,
				end: bareIndex + HTML_ATTACHMENT_PLACEHOLDER.length,
			});
		}
		bareIndex += HTML_ATTACHMENT_PLACEHOLDER.length;
	}

	return hits;
}

function replacePlaceholderAt(
	documentXml: string,
	hit: PlaceholderHit,
	oleRelId: string,
	iconRelId: string,
	attachmentFileName: string
): string | undefined
{
	const runs = collectTextRuns(documentXml);
	if (runs.length === 0) return undefined;

	let cursor = 0;
	let startRun = -1;
	let endRun = -1;
	let startOffsetInRun = 0;
	let endOffsetInRun = 0;

	for (let i = 0; i < runs.length; i++)
	{
		const run = runs[i];
		const next = cursor + run.text.length;
		if (startRun < 0 && hit.start < next)
		{
			startRun = i;
			startOffsetInRun = hit.start - cursor;
		}
		if (hit.end <= next)
		{
			endRun = i;
			endOffsetInRun = hit.end - cursor;
			break;
		}
		cursor = next;
	}

	if (startRun < 0 || endRun < 0) return undefined;

	const objectXml = buildOleObjectXml(oleRelId, iconRelId, attachmentFileName);
	let middle = "";

	if (startRun === endRun)
	{
		const prefix = runs[startRun].text.slice(0, startOffsetInRun);
		const suffix = runs[startRun].text.slice(endOffsetInRun);
		middle = `${writeRun(runs[startRun], prefix)}${objectXml}${writeRun(runs[startRun], suffix)}`;
	}
	else
	{
		const prefix = runs[startRun].text.slice(0, startOffsetInRun);
		const suffix = runs[endRun].text.slice(endOffsetInRun);
		middle = `${writeRun(runs[startRun], prefix)}${objectXml}`;
		for (let i = startRun + 1; i < endRun; i++)
			middle += writeRun(runs[i], "");
		middle += writeRun(runs[endRun], suffix);
	}

	const before = documentXml.slice(0, runs[startRun].index);
	const after = documentXml.slice(runs[endRun].index + runs[endRun].fullMatch.length);
	return ensureDocumentNamespaces(before + middle + after);
}

function createEmptyRels(): string
{
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
}

function pickUnusedName(zip: JSZip, prefix: string, ext: string): string
{
	let n = 1;
	while (zip.file(`${prefix}${n}${ext}`)) n++;
	const full = `${prefix}${n}${ext}`;
	return full.slice(full.lastIndexOf("/") + 1);
}

function ensureContentTypes(xml: string): string
{
	let result = xml;
	if (!/Extension\s*=\s*"bin"/i.test(result))
	{
		result = result.replace(
			"</Types>",
			`<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>`
		);
	}
	if (!/Extension\s*=\s*"png"/i.test(result))
	{
		result = result.replace(
			"</Types>",
			`<Default Extension="png" ContentType="image/png"/></Types>`
		);
	}
	return result;
}

function upsertRelationships(
	relsXml: string,
	rels: { id: string; type: string; target: string }[]
): string
{
	let result = relsXml;
	for (const rel of rels)
	{
		const idPattern = new RegExp(`<Relationship[^>]*\\bId="${escapeRegExp(rel.id)}"[^>]*/>`, "i");
		const tag =
			`<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`;
		if (idPattern.test(result))
			result = result.replace(idPattern, tag);
		else
			result = result.replace("</Relationships>", `${tag}</Relationships>`);
	}
	return result;
}

async function collectExistingIds(zip: JSZip, documentXml: string): Promise<Set<string>>
{
	const ids = new Set<string>();
	for (const match of documentXml.matchAll(/\b(?:r:id|Id)="([^"]+)"/gi))
		ids.add(match[1]);

	const rels = await zip.file("word/_rels/document.xml.rels")?.async("string");
	if (rels)
	{
		for (const match of rels.matchAll(/\bId="([^"]+)"/gi))
			ids.add(match[1]);
	}
	return ids;
}

function allocateRelId(usedIds: Set<string>, preferred: string): string
{
	if (!usedIds.has(preferred))
	{
		usedIds.add(preferred);
		return preferred;
	}
	let n = 1000;
	while (usedIds.has(`rId${n}`)) n++;
	const id = `rId${n}`;
	usedIds.add(id);
	return id;
}

function writeRun(run: TextRun, text: string): string
{
	if (text.length === 0) return "";
	const needsPreserve = /^\s|\s$/.test(text) || text.includes("  ");
	const openTag = needsPreserve && !/\bxml:space=/.test(run.openTag)
		? run.openTag.replace(/<w:t\b/, '<w:t xml:space="preserve"')
		: run.openTag;
	return `${openTag}${escapeXml(text)}${run.closeTag}`;
}

function collectTextRuns(documentXml: string): TextRun[]
{
	const runs: TextRun[] = [];
	const re = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(documentXml)) !== null)
	{
		runs.push({
			fullMatch: match[0],
			openTag: match[1],
			text: decodeXml(match[2]),
			closeTag: match[3],
			index: match.index,
		});
	}
	return runs;
}

function buildOleObjectXml(oleRelId: string, iconRelId: string, attachmentFileName: string): string
{
	const shapeId = `_x0000_i${Math.floor(Math.random() * 9000) + 1000}`;
	const objectId = `_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
	const title = escapeXml(attachmentFileName);
	// Single OLE presentation: globe + filename baked into imagedata (fully clickable).
	const iconStyle = `width:${OLE_ICON_DISPLAY_WIDTH_PT}pt;height:${OLE_ICON_DISPLAY_HEIGHT_PT}pt`;
	const dxa = Math.round(OLE_ICON_DISPLAY_WIDTH_PT * 20);
	const dya = Math.round(OLE_ICON_DISPLAY_HEIGHT_PT * 20);

	return (
		`<w:r>` +
		`<w:object w:dxaOrig="${dxa}" w:dyaOrig="${dya}">` +
		`<v:shape id="${shapeId}" type="#_x0000_t75" style="${iconStyle}" o:ole="" o:title="${title}">` +
		`<v:imagedata r:id="${iconRelId}" o:title="${title}"/>` +
		`</v:shape>` +
		`<o:OLEObject Type="Embed" ProgID="Package" ShapeID="${shapeId}" DrawAspect="Icon" ObjectID="${objectId}" r:id="${oleRelId}"/>` +
		`</w:object>` +
		`</w:r>`
	);
}

function ensureDocumentNamespaces(documentXml: string): string
{
	const needed: { prefix: string; uri: string }[] = [
		{ prefix: "v", uri: "urn:schemas-microsoft-com:vml" },
		{ prefix: "o", uri: "urn:schemas-microsoft-com:office:office" },
		{ prefix: "r", uri: "http://schemas.openxmlformats.org/officeDocument/2006/relationships" },
	];

	const docTagMatch = documentXml.match(/<w:document\b[^>]*>/);
	if (!docTagMatch) return documentXml;

	let docTag = docTagMatch[0];
	for (const ns of needed)
	{
		if (!docTag.includes(`xmlns:${ns.prefix}=`))
			docTag = docTag.replace(/>$/, ` xmlns:${ns.prefix}="${ns.uri}">`);
	}
	return documentXml.replace(docTagMatch[0], docTag);
}

function escapeXml(text: string): string
{
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function decodeXml(text: string): string
{
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function escapeRegExp(value: string): string
{
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
