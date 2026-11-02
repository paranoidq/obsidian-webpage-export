import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { addEntryPdfOutline } from "./pdf-outline";
import { PDF_READY_SCRIPT, PdfPrintView } from "./pdf-print-view";

export type PdfPrintWindow = Pick<BrowserWindow, "loadFile" | "webContents" | "destroy" | "isDestroyed">;
export type PdfWindowFactory = () => PdfPrintWindow;

function createPrintWindow(): PdfPrintWindow
{
	// Obsidian exposes main-process Electron APIs through its remote bridge.
	const host = window as unknown as { electron?: { remote?: { BrowserWindow?: new (options: BrowserWindowConstructorOptions) => BrowserWindow } } };
	const Constructor = host.electron?.remote?.BrowserWindow;
	if (!Constructor) throw new Error("Automatic PDF export requires the desktop version of Obsidian");
	return new Constructor({
		show: false, width: 1280, height: 900,
		webPreferences: {
			nodeIntegration: false, contextIsolation: true, sandbox: true,
			backgroundThrottling: false,
			partition: `long-page-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		},
	});
}

function within<T>(promise: Promise<T>, milliseconds: number, operation: string): Promise<T>
{
	return new Promise((resolve, reject) =>
	{
		const timer = setTimeout(() => reject(new Error(`PDF ${operation} timed out`)), milliseconds);
		promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
	});
}

/** Native Chromium prints selectable text/links; postprocessing adds the entry bookmarks. */
export async function exportLongPagePdf(view: PdfPrintView, outputPath: string, factory: PdfWindowFactory = createPrintWindow): Promise<void>
{
	const temporary = await fs.mkdtemp(join(tmpdir(), "obsidian-long-page-pdf-"));
	let printWindow: PdfPrintWindow | undefined;
	let pending: string | undefined;
	try
	{
		const htmlPath = join(temporary, "print.html");
		await fs.writeFile(htmlPath, view.html, "utf8");
		printWindow = factory();
		await within(printWindow.loadFile(htmlPath), 60000, "page loading");
		// Await fonts in print media, including fonts only referenced by @media print.
		printWindow.webContents.debugger.attach("1.3");
		await printWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { media: "print" });
		await within(printWindow.webContents.executeJavaScript(PDF_READY_SCRIPT), 60000, "resource loading");
		const bytes = await within(printWindow.webContents.printToPDF({
			pageSize: "A4", printBackground: true, preferCSSPageSize: true,
			displayHeaderFooter: true, headerTemplate: "<span></span>",
			footerTemplate: '<div style="font-size:8px;color:#777;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
		}), 120000, "printing");
		const result = await addEntryPdfOutline(bytes, view.outline);
		await fs.mkdir(dirname(outputPath), { recursive: true });
		pending = `${outputPath}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
		await fs.writeFile(pending, result);
		await fs.rename(pending, outputPath);
	}
	finally
	{
		if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
		if (pending) await fs.rm(pending, { force: true });
		await fs.rm(temporary, { force: true, recursive: true });
	}
}
