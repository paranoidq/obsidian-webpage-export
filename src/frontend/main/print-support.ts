import { restorePageZoomAfterPrint, suspendPageZoomForPrint } from "./fullscreen";

/**
 * SVGs that belong to the interface rather than to the document, and therefore
 * must not be resized for printing.
 */
const UI_SVG_SELECTOR = ".svg-icon, .clickable-icon, .collapse-indicator, "
	+ ".heading-collapse-indicator, .list-collapse-indicator, .callout-icon, "
	+ ".code-block-header, .sidebar, .image-lightbox, .graph-view-container";

let isPrepared = false;
const restoreActions: (() => void)[] = [];

function parseLength(value: string | null): number
{
	if (!value) return NaN;
	return parseFloat(value);
}

/**
 * `max-width: 100%` can only shrink an SVG without squashing it when the SVG
 * declares an aspect ratio, so diagrams that carry nothing but pixel dimensions
 * get a viewBox for the duration of the print job.
 */
function makeDiagramScalable(svg: SVGSVGElement): void
{
	if (svg.getAttribute("viewBox")) return;

	let width = parseLength(svg.getAttribute("width"));
	let height = parseLength(svg.getAttribute("height"));

	if (!(width > 0) || !(height > 0))
	{
		const bounds = svg.getBoundingClientRect();
		width = bounds.width;
		height = bounds.height;
	}

	if (!(width > 0) || !(height > 0)) return;

	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	restoreActions.push(() => svg.removeAttribute("viewBox"));
}

function prepareForPrint(): void
{
	if (isPrepared) return;
	isPrepared = true;

	suspendPageZoomForPrint();

	const svgs = Array.from(
		document.querySelectorAll(".obsidian-document svg")
	) as SVGSVGElement[];

	for (const svg of svgs)
	{
		if (svg.closest(UI_SVG_SELECTOR)) continue;
		makeDiagramScalable(svg);
	}
}

function cleanupAfterPrint(): void
{
	if (!isPrepared) return;
	isPrepared = false;

	while (restoreActions.length > 0) restoreActions.pop()?.();

	restorePageZoomAfterPrint();
}

/**
 * Prepares the page for the browser's own print / save-as-PDF flow. Printing is
 * always started by the reader from the browser, never by the export itself.
 */
export function initPrintSupport(): void
{
	window.addEventListener("beforeprint", prepareForPrint);
	window.addEventListener("afterprint", cleanupAfterPrint);

	// Safari does not fire beforeprint/afterprint.
	const printMedia = window.matchMedia?.("print");
	printMedia?.addEventListener?.("change", (event: MediaQueryListEvent) =>
	{
		if (event.matches) prepareForPrint();
		else cleanupAfterPrint();
	});
}
