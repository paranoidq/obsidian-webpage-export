import edgeIconPng from "src/assets/edge-browser-icon.png";

/**
 * Word display size — must match the canvas aspect ratio to avoid stretching.
 * Horizontal: left icon + right label.
 */
export const OLE_ICON_DISPLAY_WIDTH_PT = 96;
export const OLE_ICON_DISPLAY_HEIGHT_PT = 18;

/** Keep canvas aspect ratio identical to display (96:18 = 16:3). */
const CANVAS_HEIGHT = 64;
const CANVAS_WIDTH = Math.round(CANVAS_HEIGHT * (OLE_ICON_DISPLAY_WIDTH_PT / OLE_ICON_DISPLAY_HEIGHT_PT));
const ICON_SIZE = 48;
const ICON_PAD_X = 4;
const TEXT_GAP = 10;
const LABEL_COLOR = "#0563C1";
/** Font size close to icon height so icon and text feel similar. */
const FONT_SIZE = 26;

/**
 * Build a single OLE presentation image: Edge icon on the left, filename on the right.
 * The whole image is one clickable OLE object.
 */
export async function renderOleIconWithLabel(fileName: string): Promise<Buffer>
{
	if (typeof document !== "undefined")
	{
		try
		{
			return await renderWithDomCanvas(fileName.trim());
		}
		catch
		{
			// Fall through to static icon if canvas/image loading fails.
		}
	}

	return Buffer.from(edgeIconPng);
}

async function renderWithDomCanvas(fileName: string): Promise<Buffer>
{
	const canvas = document.createElement("canvas");
	canvas.width = CANVAS_WIDTH;
	canvas.height = CANVAS_HEIGHT;
	const ctx = canvas.getContext("2d");
	if (!ctx) return Buffer.from(edgeIconPng);

	ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

	const icon = await loadPngImage(edgeIconPng);
	const iconY = (CANVAS_HEIGHT - ICON_SIZE) / 2;
	ctx.drawImage(icon, ICON_PAD_X, iconY, ICON_SIZE, ICON_SIZE);

	const textX = ICON_PAD_X + ICON_SIZE + TEXT_GAP;
	const maxTextWidth = CANVAS_WIDTH - textX - 8;
	const font = `${FONT_SIZE}px -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', Helvetica, Arial, sans-serif`;
	ctx.font = font;
	const label = fitLabel(ctx, fileName, maxTextWidth);

	ctx.fillStyle = LABEL_COLOR;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	const textY = CANVAS_HEIGHT / 2;
	ctx.fillText(label, textX, textY);

	const textWidth = ctx.measureText(label).width;
	const underlineY = Math.min(CANVAS_HEIGHT - 6, textY + FONT_SIZE * 0.42);
	ctx.strokeStyle = LABEL_COLOR;
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(textX, underlineY);
	ctx.lineTo(textX + textWidth, underlineY);
	ctx.stroke();

	const dataUrl = canvas.toDataURL("image/png");
	const base64 = dataUrl.split(",", 2)[1];
	if (!base64) return Buffer.from(edgeIconPng);
	return Buffer.from(base64, "base64");
}

function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string
{
	if (ctx.measureText(text).width <= maxWidth) return text;

	const ellipsis = "…";
	let low = 0;
	let high = text.length;
	while (low < high)
	{
		const mid = Math.ceil((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (ctx.measureText(candidate).width <= maxWidth) low = mid;
		else high = mid - 1;
	}
	return low > 0 ? text.slice(0, low) + ellipsis : ellipsis;
}

function loadPngImage(pngBytes: Uint8Array): Promise<HTMLImageElement>
{
	return new Promise((resolve, reject) =>
	{
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Failed to load Edge OLE icon"));
		img.src = uint8ToDataUrl(pngBytes);
	});
}

function uint8ToDataUrl(data: Uint8Array, mime: string = "image/png"): string
{
	let binary = "";
	const chunk = 0x2000;
	for (let i = 0; i < data.length; i += chunk)
	{
		const slice = data.subarray(i, i + chunk);
		binary += String.fromCharCode.apply(null, Array.from(slice) as number[]);
	}
	return `data:${mime};base64,${btoa(binary)}`;
}
