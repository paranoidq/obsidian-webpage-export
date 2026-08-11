import { gzipSync, gunzipSync } from "zlib";

/** Prefix for gzip+base64 UTF-8 JSON payloads. */
export const PAYLOAD_PREFIX_GZIP = "gz1.";
/** Prefix for raw base64 UTF-8 JSON (no encodeURI). */
export const PAYLOAD_PREFIX_UTF8 = "u8.";

/**
 * Encode a JSON-serializable value for embedding in HTML data attributes.
 * Uses gzip+base64 (gz1.) for compact size.
 */
export function encodeMetadataPayload(value: unknown): string
{
	const json = JSON.stringify(value);
	const compressed = gzipSync(Buffer.from(json, "utf8"));
	return PAYLOAD_PREFIX_GZIP + compressed.toString("base64");
}

/**
 * Decode a payload produced by {@link encodeMetadataPayload}, or legacy
 * `btoa(encodeURI(JSON))` / `u8.` base64 UTF-8 formats.
 */
export function decodeMetadataPayloadSync(encoded: string): unknown
{
	if (!encoded) return undefined;

	if (encoded.startsWith(PAYLOAD_PREFIX_GZIP))
	{
		const raw = Buffer.from(encoded.slice(PAYLOAD_PREFIX_GZIP.length), "base64");
		const json = gunzipSync(raw).toString("utf8");
		return JSON.parse(json);
	}

	if (encoded.startsWith(PAYLOAD_PREFIX_UTF8))
	{
		const json = Buffer.from(encoded.slice(PAYLOAD_PREFIX_UTF8.length), "base64").toString("utf8");
		return JSON.parse(json);
	}

	// Legacy: btoa(encodeURI(JSON.stringify(...)))
	return JSON.parse(decodeURI(atob(encoded)));
}
