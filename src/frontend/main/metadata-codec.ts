/** Prefix for gzip+base64 UTF-8 JSON payloads (must match plugin metadata-codec). */
export const PAYLOAD_PREFIX_GZIP = "gz1.";
/** Prefix for raw base64 UTF-8 JSON. */
export const PAYLOAD_PREFIX_UTF8 = "u8.";

function base64ToUint8Array(b64: string): Uint8Array
{
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function uint8ArrayToString(bytes: Uint8Array): string
{
	return new TextDecoder("utf-8").decode(bytes);
}

async function gunzipBase64(b64: string): Promise<string>
{
	const bytes = base64ToUint8Array(b64);
	const DecompStream = (globalThis as any).DecompressionStream;
	if (!DecompStream)
	{
		throw new Error("DecompressionStream unavailable; cannot decode gz1. metadata");
	}
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompStream("gzip"));
	const buf = await new Response(stream).arrayBuffer();
	return uint8ArrayToString(new Uint8Array(buf));
}

/**
 * Decode metadata / media-registry payloads.
 * Supports gz1. (gzip), u8. (utf8 base64), and legacy encodeURI+btoa.
 */
export async function decodeMetadataPayload(encoded: string): Promise<unknown>
{
	if (!encoded) return undefined;

	if (encoded.startsWith(PAYLOAD_PREFIX_GZIP))
	{
		const json = await gunzipBase64(encoded.slice(PAYLOAD_PREFIX_GZIP.length));
		return JSON.parse(json);
	}

	if (encoded.startsWith(PAYLOAD_PREFIX_UTF8))
	{
		const json = uint8ArrayToString(base64ToUint8Array(encoded.slice(PAYLOAD_PREFIX_UTF8.length)));
		return JSON.parse(json);
	}

	return JSON.parse(decodeURI(atob(encoded)));
}

/** Sync decode for u8. / legacy only. Prefer {@link decodeMetadataPayload} for gz1. */
export function decodeMetadataPayloadSync(encoded: string): unknown
{
	if (!encoded) return undefined;

	if (encoded.startsWith(PAYLOAD_PREFIX_GZIP))
	{
		throw new Error("gz1. payload requires async decodeMetadataPayload");
	}

	if (encoded.startsWith(PAYLOAD_PREFIX_UTF8))
	{
		const json = uint8ArrayToString(base64ToUint8Array(encoded.slice(PAYLOAD_PREFIX_UTF8.length)));
		return JSON.parse(json);
	}

	return JSON.parse(decodeURI(atob(encoded)));
}

export const INLINE_MEDIA_REGISTRY_ID = "inline-media-registry";
export const DATA_MEDIA_ID_ATTR = "data-media-id";

/**
 * Hydrate [data-media-id] elements from the inline media registry.
 * Must run before ImageViewer can open (requires non-empty src).
 */
export function hydrateInlineMedia(
	root: ParentNode = document,
	registry?: Record<string, string>,
): number
{
	let map = registry;
	if (!map)
	{
		const el = document.getElementById(INLINE_MEDIA_REGISTRY_ID);
		const raw = el?.getAttribute("value");
		if (!raw) return 0;
		// Registry may still be gz1.; caller should pass decoded map when possible.
		try
		{
			map = decodeMetadataPayloadSync(raw) as Record<string, string>;
		}
		catch
		{
			return 0;
		}
	}

	let count = 0;
	const nodes = root.querySelectorAll(`[${DATA_MEDIA_ID_ATTR}]`);
	for (const node of Array.from(nodes))
	{
		const key = node.getAttribute(DATA_MEDIA_ID_ATTR);
		if (!key || !map[key]) continue;
		const uri = map[key];
		if (node instanceof HTMLImageElement
			|| node instanceof HTMLSourceElement
			|| node instanceof HTMLVideoElement
			|| node instanceof HTMLAudioElement
			|| node instanceof HTMLIFrameElement)
		{
			node.setAttribute("src", uri);
			count++;
		}
		else if (node instanceof HTMLElement)
		{
			node.setAttribute("src", uri);
			count++;
		}
	}
	return count;
}
