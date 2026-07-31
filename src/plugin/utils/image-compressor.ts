export interface CompressOptions
{
	maxEdge: number;
	quality: number;
}

/** Progressive compression ladder: milder first, more aggressive later. */
export const COMPRESS_LADDER: readonly CompressOptions[] = [
	{ maxEdge: 1920, quality: 0.82 },
	{ maxEdge: 1280, quality: 0.7 },
	{ maxEdge: 960, quality: 0.55 },
	{ maxEdge: 640, quality: 0.4 },
];

/** Default single-step options (mild). Prefer {@link compressDataUriMaximally} for export. */
export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = COMPRESS_LADDER[0];

/** Most aggressive ladder step — used when maximizing savings. */
export const MAX_COMPRESS_OPTIONS: CompressOptions = COMPRESS_LADDER[COMPRESS_LADDER.length - 1];

/** Skip compression for images already under this size (raw bytes). */
export const SMALL_IMAGE_BYTES = 50 * 1024;

const BITMAP_MIME_RE = /^image\/(png|jpeg|jpg|webp|gif|bmp|avif)$/i;
const SKIP_MIME_RE = /^image\/svg\+xml$/i;

export function isCompressibleImageMime(mime: string): boolean
{
	return BITMAP_MIME_RE.test(mime) && !SKIP_MIME_RE.test(mime);
}

export function parseDataUri(dataUri: string): { mime: string; buffer: Buffer } | undefined
{
	const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUri);
	if (!match) return undefined;
	try
	{
		return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
	}
	catch
	{
		return undefined;
	}
}

export function toDataUri(mime: string, buffer: Buffer): string
{
	return `data:${mime};base64,${buffer.toString("base64")}`;
}

function loadImage(src: string): Promise<HTMLImageElement>
{
	return new Promise((resolve, reject) =>
	{
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Failed to decode image for compression"));
		img.src = src;
	});
}

function canvasHasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean
{
	try
	{
		const { data } = ctx.getImageData(0, 0, width, height);
		for (let i = 3; i < data.length; i += 4)
		{
			if (data[i] < 255) return true;
		}
	}
	catch
	{
		// Cross-origin or security errors: assume opaque
	}
	return false;
}

function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null>
{
	return new Promise((resolve) =>
	{
		try
		{
			canvas.toBlob((blob) => resolve(blob), mime, quality);
		}
		catch
		{
			resolve(null);
		}
	});
}

async function pickOutputMime(canvas: HTMLCanvasElement, hasAlpha: boolean, quality: number): Promise<{ mime: string; blob: Blob } | undefined>
{
	const candidates = hasAlpha
		? ["image/webp", "image/png"]
		: ["image/webp", "image/jpeg"];

	for (const mime of candidates)
	{
		const blob = await encodeCanvas(canvas, mime, quality);
		if (blob && blob.size > 0)
		{
			return { mime, blob };
		}
	}
	return undefined;
}

/**
 * Compress a bitmap image. Returns a data URI only when the result is smaller
 * than the input; otherwise returns undefined (caller keeps original).
 */
export async function compressImageToDataUri(
	input: Buffer | ArrayBuffer | string,
	mimeHint?: string,
	options: CompressOptions = DEFAULT_COMPRESS_OPTIONS,
): Promise<string | undefined>
{
	let mime = mimeHint ?? "image/png";
	let buffer: Buffer;
	let originalDataUri: string | undefined;

	if (typeof input === "string")
	{
		const parsed = parseDataUri(input);
		if (!parsed) return undefined;
		mime = parsed.mime;
		buffer = parsed.buffer;
		originalDataUri = input;
	}
	else if (input instanceof ArrayBuffer)
	{
		buffer = Buffer.from(input);
	}
	else
	{
		buffer = input;
	}

	if (SKIP_MIME_RE.test(mime) || mime.toLowerCase().includes("svg"))
	{
		return undefined;
	}
	if (!isCompressibleImageMime(mime) && !mime.startsWith("image/"))
	{
		return undefined;
	}
	if (buffer.byteLength > 0 && buffer.byteLength < SMALL_IMAGE_BYTES)
	{
		return undefined;
	}

	const sourceUri = originalDataUri ?? toDataUri(mime, buffer);
	let img: HTMLImageElement;
	try
	{
		img = await loadImage(sourceUri);
	}
	catch
	{
		return undefined;
	}

	const srcW = img.naturalWidth || img.width;
	const srcH = img.naturalHeight || img.height;
	if (!srcW || !srcH) return undefined;

	const scale = Math.min(1, options.maxEdge / Math.max(srcW, srcH));
	const dstW = Math.max(1, Math.round(srcW * scale));
	const dstH = Math.max(1, Math.round(srcH * scale));

	const canvas = document.createElement("canvas");
	canvas.width = dstW;
	canvas.height = dstH;
	const ctx = canvas.getContext("2d", { alpha: true });
	if (!ctx) return undefined;

	ctx.clearRect(0, 0, dstW, dstH);
	ctx.drawImage(img, 0, 0, dstW, dstH);

	const hasAlpha = canvasHasTransparency(ctx, dstW, dstH);
	const encoded = await pickOutputMime(canvas, hasAlpha, options.quality);
	if (!encoded) return undefined;

	const outBuffer = Buffer.from(await encoded.blob.arrayBuffer());
	if (outBuffer.byteLength >= buffer.byteLength)
	{
		return undefined;
	}

	return toDataUri(encoded.mime, outBuffer);
}

/**
 * Try each ladder step (from `startIndex`) until one produces a smaller data URI.
 * Returns the compressed URI and the ladder index used, or undefined if nothing helped.
 */
export async function compressDataUriAlongLadder(
	dataUri: string,
	startIndex: number = 0,
): Promise<{ dataUri: string; ladderIndex: number } | undefined>
{
	for (let i = startIndex; i < COMPRESS_LADDER.length; i++)
	{
		const compressed = await compressImageToDataUri(dataUri, undefined, COMPRESS_LADDER[i]);
		if (compressed && compressed.length < dataUri.length)
		{
			return { dataUri: compressed, ladderIndex: i };
		}
	}
	return undefined;
}

/**
 * Try every ladder step against the original image and keep the smallest result.
 * Returns undefined when nothing beats the input.
 */
export async function compressDataUriMaximally(dataUri: string): Promise<string | undefined>
{
	let best: string | undefined;
	for (const options of COMPRESS_LADDER)
	{
		const compressed = await compressImageToDataUri(dataUri, undefined, options);
		if (!compressed) continue;
		if (!best || compressed.length < best.length)
		{
			best = compressed;
		}
	}
	if (!best || best.length >= dataUri.length) return undefined;
	return best;
}
