import { ExportLog } from "src/plugin/render-api/render-api";
import { compressDataUriMaximally, isCompressibleImageMime, parseDataUri } from "./image-compressor";

export const DEFAULT_MAX_COMBINED_HTML_BYTES = 10 * 1024 * 1024;

const DATA_IMAGE_URI_RE = /data:image\/(?:png|jpeg|jpg|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=\s]+/gi;

export interface HtmlSizeBudgetResult
{
	html: string;
	originalBytes: number;
	finalBytes: number;
	compressedCount: number;
	stillOver: boolean;
}

function htmlByteLength(html: string): number
{
	return Buffer.byteLength(html, "utf8");
}

function formatMb(bytes: number): string
{
	return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function normalizeDataUri(uri: string): string
{
	return uri.replace(/\s+/g, "");
}

function collectUniqueDataUris(text: string): string[]
{
	const seen = new Set<string>();
	const uris: string[] = [];
	DATA_IMAGE_URI_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = DATA_IMAGE_URI_RE.exec(text)) !== null)
	{
		const uri = normalizeDataUri(match[0]);
		if (seen.has(uri)) continue;
		const parsed = parseDataUri(uri);
		if (!parsed || !isCompressibleImageMime(parsed.mime)) continue;
		seen.add(uri);
		uris.push(uri);
	}
	return uris;
}

function tryDecodeMetadataValue(encoded: string): { decoded: any; kind: "json" } | undefined
{
	try
	{
		const json = decodeURI(atob(encoded));
		return { decoded: JSON.parse(json), kind: "json" };
	}
	catch
	{
		return undefined;
	}
}

function encodeMetadataValue(value: any): string
{
	return btoa(encodeURI(JSON.stringify(value)));
}

/**
 * Walk a JSON-compatible structure and collect string fields that contain image data URIs.
 */
function collectStringsWithImages(value: any, path: Array<string | number> = []): { path: Array<string | number>; text: string }[]
{
	const results: { path: Array<string | number>; text: string }[] = [];
	if (typeof value === "string")
	{
		if (collectUniqueDataUris(value).length > 0)
		{
			results.push({ path, text: value });
		}
		return results;
	}
	if (Array.isArray(value))
	{
		value.forEach((item, index) =>
		{
			results.push(...collectStringsWithImages(item, path.concat(index)));
		});
		return results;
	}
	if (value && typeof value === "object")
	{
		for (const [key, child] of Object.entries(value))
		{
			results.push(...collectStringsWithImages(child, path.concat(key)));
		}
	}
	return results;
}

function setAtPath(root: any, path: Array<string | number>, text: string): void
{
	let cursor = root;
	for (let i = 0; i < path.length - 1; i++)
	{
		cursor = cursor[path[i]];
	}
	cursor[path[path.length - 1]] = text;
}

interface ImageTarget
{
	uri: string;
	size: number;
}

function gatherImageTargets(html: string, metadataRoots: any[]): ImageTarget[]
{
	const seen = new Set<string>();
	const targets: ImageTarget[] = [];

	const consider = (text: string) =>
	{
		for (const uri of collectUniqueDataUris(text))
		{
			if (seen.has(uri)) continue;
			seen.add(uri);
			targets.push({ uri, size: uri.length });
		}
	};

	consider(html);
	for (const root of metadataRoots)
	{
		for (const entry of collectStringsWithImages(root))
		{
			consider(entry.text);
		}
	}

	return targets.sort((a, b) => b.size - a.size);
}

function replaceUriEverywhere(
	html: string,
	metadataRoots: any[],
	fromUri: string,
	toUri: string,
): string
{
	let nextHtml = html.includes(fromUri) ? html.split(fromUri).join(toUri) : html;

	for (const root of metadataRoots)
	{
		for (const entry of collectStringsWithImages(root))
		{
			if (!entry.text.includes(fromUri)) continue;
			setAtPath(root, entry.path, entry.text.split(fromUri).join(toUri));
		}
	}

	return nextHtml;
}

function rebuildHtmlWithMetadata(html: string, metadataById: Map<string, any>): string
{
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const [id, value] of metadataById)
	{
		const el = doc.getElementById(id);
		if (!el) continue;
		el.setAttribute("value", encodeMetadataValue(value));
	}
	const doctype = html.startsWith("<!DOCTYPE") || html.startsWith("<!doctype")
		? "<!DOCTYPE html>\n"
		: "";
	return `${doctype}${doc.documentElement.outerHTML}`;
}

/**
 * Compress every inlined bitmap data URI as much as possible (including those
 * packed into website-metadata). Then warn if the result still exceeds maxBytes.
 * Compression is not stopped early just because size is already under the limit.
 */
export async function enforceHtmlSizeBudget(
	html: string,
	maxBytes: number = DEFAULT_MAX_COMBINED_HTML_BYTES,
): Promise<HtmlSizeBudgetResult>
{
	const originalBytes = htmlByteLength(html);

	const doc = new DOMParser().parseFromString(html, "text/html");
	const metadataById = new Map<string, any>();
	const metadataRoots: any[] = [];

	for (const el of Array.from(doc.querySelectorAll("data[id][value]")))
	{
		const id = el.id;
		const encoded = el.getAttribute("value");
		if (!id || !encoded) continue;
		const decoded = tryDecodeMetadataValue(encoded);
		if (!decoded) continue;
		metadataById.set(id, decoded.decoded);
		metadataRoots.push(decoded.decoded);
	}

	let current = html;
	let compressedCount = 0;
	const targets = gatherImageTargets(current, metadataRoots);

	for (const target of targets)
	{
		const compressed = await compressDataUriMaximally(target.uri);
		if (!compressed) continue;

		current = replaceUriEverywhere(current, metadataRoots, target.uri, compressed);
		current = rebuildHtmlWithMetadata(current, metadataById);
		compressedCount++;
	}

	const finalBytes = htmlByteLength(current);
	const stillOver = finalBytes > maxBytes;

	if (compressedCount > 0)
	{
		ExportLog.log(
			`Maximally compressed ${compressedCount} image(s) in combined HTML (${formatMb(originalBytes)} → ${formatMb(finalBytes)}).`,
		);
	}

	if (stillOver)
	{
		ExportLog.warning(
			`Combined HTML is ${formatMb(finalBytes)}, which exceeds the ${formatMb(maxBytes)} guideline. Export continues anyway.`,
		);
	}

	return {
		html: current,
		originalBytes,
		finalBytes,
		compressedCount,
		stillOver,
	};
}
