import { ExportLog } from "src/plugin/render-api/render-api";

export const DEFAULT_MAX_COMBINED_HTML_BYTES = 10 * 1024 * 1024;

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

/**
 * Measure combined HTML size and warn when it exceeds maxBytes.
 * Does not further compress images — mild compression already ran at inline time.
 */
export async function enforceHtmlSizeBudget(
	html: string,
	maxBytes: number = DEFAULT_MAX_COMBINED_HTML_BYTES,
): Promise<HtmlSizeBudgetResult>
{
	const bytes = htmlByteLength(html);
	const stillOver = bytes > maxBytes;

	if (stillOver)
	{
		ExportLog.warning(
			`Combined HTML is ${formatMb(bytes)}, which exceeds the ${formatMb(maxBytes)} guideline. Export continues anyway.`,
		);
	}
	else
	{
		ExportLog.log(`Combined HTML size: ${formatMb(bytes)}.`);
	}

	return {
		html,
		originalBytes: bytes,
		finalBytes: bytes,
		compressedCount: 0,
		stillOver,
	};
}
