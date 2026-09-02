/**
 * CSS that contains SVG data URLs cannot be dropped raw into an HTML
 * <style> element: a literal </style> inside the SVG closes the tag and
 * the rest of the stylesheet renders as visible page text.
 */

function encodeSvgDataUrlPayload(payload: string): string
{
	payload = payload.replace(/^\s*<\?xml[^?]*\?>\s*/i, "");
	return payload
		.replace(/</g, "%3C")
		.replace(/>/g, "%3E")
		.replace(/"/g, "%22")
		.replace(/#/g, "%23");
}

function findSvgDataUrlPayloadEnd(css: string, payloadStart: number): number
{
	const lookback = css.slice(Math.max(0, payloadStart - 64), payloadStart);
	const quoteMatch = /url\(\s*(['"])/i.exec(lookback);
	const quote = quoteMatch?.[1];
	if (quote)
	{
		const end = css.indexOf(quote, payloadStart);
		return end < 0 ? css.length : end;
	}

	const close = css.slice(payloadStart).search(/\)/);
	return close < 0 ? css.length : payloadStart + close;
}

/**
 * Make CSS safe to place inside an HTML <style>…</style> block.
 * Idempotent: running twice does not double-encode.
 */
export function escapeCssForHtmlStyleTag(css: string): string
{
	const needle = "data:image/svg+xml";
	let out = "";
	let i = 0;
	const lower = css.toLowerCase();

	while (i < css.length)
	{
		const start = lower.indexOf(needle, i);
		if (start < 0)
		{
			out += css.slice(i);
			break;
		}

		out += css.slice(i, start);
		const comma = css.indexOf(",", start);
		if (comma < 0)
		{
			out += css.slice(start);
			break;
		}

		const meta = css.slice(start, comma + 1);
		if (/base64/i.test(meta))
		{
			out += meta;
			i = comma + 1;
			continue;
		}

		const payloadStart = comma + 1;
		const payloadEnd = findSvgDataUrlPayloadEnd(css, payloadStart);
		const payload = css.slice(payloadStart, payloadEnd);
		out += meta + (payload.includes("<") || payload.includes(">") || payload.includes("<?xml")
			? encodeSvgDataUrlPayload(payload)
			: payload);
		i = payloadEnd;
	}

	// Any remaining </style sequence (comments, content strings, etc.)
	// would still terminate the HTML style element.
	return out.replace(/<\/style/gi, "\\3C/style");
}

export function wrapCssInStyleTag(css: string): string
{
	return `<style>${escapeCssForHtmlStyleTag(css)}</style>`;
}
