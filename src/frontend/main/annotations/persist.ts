import { Notice } from "../notifications";
import {
	ANNOTATIONS_FILENAME,
	AnnotationsFile,
	createEmptyAnnotationsFile,
} from "./types";

type FileSystemFileHandleLike = {
	getFile: () => Promise<File>;
	createWritable: () => Promise<{
		write: (data: string) => Promise<void>;
		close: () => Promise<void>;
	}>;
};

let fileHandle: FileSystemFileHandleLike | null = null;

export function hasLinkedAnnotationsFile(): boolean
{
	return fileHandle != null;
}

export function canUseFileSystemAccess(): boolean
{
	return typeof window !== "undefined"
		&& "showOpenFilePicker" in window
		&& "showSaveFilePicker" in window;
}

export async function tryFetchAnnotations(): Promise<AnnotationsFile | null>
{
	try
	{
		const response = await fetch(`./${ANNOTATIONS_FILENAME}`, { cache: "no-store" });
		if (!response.ok) return null;
		const data = await response.json();
		return normalizeAnnotationsFile(data);
	}
	catch
	{
		return null;
	}
}

export async function linkExistingAnnotationsFile(): Promise<AnnotationsFile | null>
{
	if (!canUseFileSystemAccess()) return null;

	try
	{
		// @ts-expect-error File System Access API
		const handles = await window.showOpenFilePicker({
			multiple: false,
			types: [{
				description: "Annotations",
				accept: { "application/json": [".json"] },
			}],
		});
		fileHandle = handles[0] as FileSystemFileHandleLike;
		const file = await fileHandle.getFile();
		const text = await file.text();
		return normalizeAnnotationsFile(JSON.parse(text));
	}
	catch (error: any)
	{
		if (error?.name === "AbortError") return null;
		console.warn("Failed to open annotations file", error);
		new Notice("无法打开注解文件");
		return null;
	}
}

export async function createLinkedAnnotationsFile(data: AnnotationsFile): Promise<boolean>
{
	if (!canUseFileSystemAccess()) return false;

	try
	{
		// @ts-expect-error File System Access API
		fileHandle = await window.showSaveFilePicker({
			suggestedName: ANNOTATIONS_FILENAME,
			types: [{
				description: "Annotations",
				accept: { "application/json": [".json"] },
			}],
		}) as FileSystemFileHandleLike;
		await writeLinkedAnnotationsFile(data);
		return true;
	}
	catch (error: any)
	{
		if (error?.name === "AbortError") return false;
		console.warn("Failed to create annotations file", error);
		new Notice("无法创建注解文件");
		return false;
	}
}

export async function writeLinkedAnnotationsFile(data: AnnotationsFile): Promise<boolean>
{
	if (!fileHandle) return false;

	try
	{
		const writable = await fileHandle.createWritable();
		await writable.write(JSON.stringify(data, null, 2));
		await writable.close();
		return true;
	}
	catch (error)
	{
		console.warn("Failed to write annotations file", error);
		new Notice("自动保存失败，请手动保存注解文件");
		return false;
	}
}

export function downloadAnnotationsFile(data: AnnotationsFile): void
{
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = ANNOTATIONS_FILENAME;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function importAnnotationsFromFileInput(): Promise<AnnotationsFile | null>
{
	return new Promise((resolve) =>
	{
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/json,.json";
		input.addEventListener("change", async () =>
		{
			const file = input.files?.[0];
			if (!file)
			{
				resolve(null);
				return;
			}

			try
			{
				const text = await file.text();
				resolve(normalizeAnnotationsFile(JSON.parse(text)));
			}
			catch (error)
			{
				console.warn("Failed to import annotations", error);
				new Notice("导入注解文件失败");
				resolve(null);
			}
		}, { once: true });
		input.click();
	});
}

export function normalizeAnnotationsFile(raw: any): AnnotationsFile
{
	if (!raw || typeof raw !== "object")
		return createEmptyAnnotationsFile();

	const items = Array.isArray(raw.items)
		? raw.items.filter((item: any) => item && typeof item.id === "string" && typeof item.pagePath === "string")
		: [];

	return {
		version: 1,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
		items,
	};
}
