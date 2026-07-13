import { applyAnnotationsToRoot, getDocumentRoot } from "./anchor";
import { hideAnnotationOverlays, initAnnotationToolbar } from "./toolbar";
import { initNotesSidebar, openNoteEditor, refreshNotesSidebar } from "./sidebar";
import { annotationStore } from "./store";

let missingIds = new Set<string>();

function currentPagePath(): string
{
	return ObsidianSite.document?.pathname
		?? document.querySelector("meta[name='pathname']")?.getAttribute("content")
		?? "";
}

function reapplyCurrentPage(): void
{
	hideAnnotationOverlays();
	const root = getDocumentRoot();
	if (!root) return;

	const pagePath = currentPagePath();
	const items = annotationStore.getForPage(pagePath);
	const result = applyAnnotationsToRoot(root, items);
	missingIds = new Set(result.missing);
	refreshNotesSidebar(missingIds);
}

export async function initAnnotations(): Promise<void>
{
	await annotationStore.bootstrap();

	initNotesSidebar(currentPagePath);

	initAnnotationToolbar({
		getPagePath: currentPagePath,
		onCreateNote: (item) => openNoteEditor(item),
		onEditNote: (item) => openNoteEditor(item),
	});

	ObsidianSite.onDocumentLoad(() =>
	{
		reapplyCurrentPage();
	});

	annotationStore.subscribe(() =>
	{
		const root = getDocumentRoot();
		if (!root) return;
		const pagePath = currentPagePath();
		const items = annotationStore.getForPage(pagePath);
		const result = applyAnnotationsToRoot(root, items);
		missingIds = new Set(result.missing);
		refreshNotesSidebar(missingIds);
	});

	reapplyCurrentPage();
}
