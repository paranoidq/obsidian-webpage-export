import {
	extractAnchorFromRange,
	getDocumentRoot,
	selectionIntersectsAnnotation,
	syncAnnotationMarkAppearance,
	unwrapAnnotationMark,
} from "./anchor";
import { annotationStore } from "./store";
import {
	ANNOTATION_COLORS,
	ANNOTATION_MARK_CLASS,
	AnnotationColor,
	AnnotationItem,
} from "./types";
import { focusNoteCorrespondence } from "./sidebar";

export type ToolbarCallbacks = {
	onCreateNote: (item: AnnotationItem) => void;
	onEditNote: (item: AnnotationItem) => void;
	getPagePath: () => string;
};

let toolbarEl: HTMLElement | null = null;
let markMenuEl: HTMLElement | null = null;
let callbacks: ToolbarCallbacks | null = null;
let pendingRange: Range | null = null;

function ensureToolbar(): HTMLElement
{
	if (toolbarEl) return toolbarEl;

	const el = document.createElement("div");
	el.className = "export-annotation-toolbar";
	el.setAttribute("role", "toolbar");
	el.setAttribute("aria-label", "注解工具条");

	const colors = document.createElement("div");
	colors.className = "export-annotation-colors";
	for (const color of ANNOTATION_COLORS)
	{
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `export-annotation-color-swatch color-${color}`;
		btn.title = `注解：${color}`;
		btn.setAttribute("aria-label", `注解 ${color}`);
		btn.dataset.color = color;
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", async (e) =>
		{
			e.preventDefault();
			e.stopPropagation();
			await createHighlight(color);
		});
		colors.appendChild(btn);
	}

	const noteBtn = document.createElement("button");
	noteBtn.type = "button";
	noteBtn.className = "export-annotation-note-btn";
	noteBtn.textContent = "备注";
	noteBtn.title = "添加备注";
	noteBtn.addEventListener("mousedown", (e) => e.preventDefault());
	noteBtn.addEventListener("click", async (e) =>
	{
		e.preventDefault();
		e.stopPropagation();
		await createNote();
	});

	el.append(colors, noteBtn);
	document.body.appendChild(el);
	toolbarEl = el;
	return el;
}

function ensureMarkMenu(): HTMLElement
{
	if (markMenuEl) return markMenuEl;

	const el = document.createElement("div");
	el.className = "export-annotation-mark-menu";
	el.setAttribute("role", "menu");
	document.body.appendChild(el);
	markMenuEl = el;
	return el;
}

function hideToolbar(): void
{
	if (toolbarEl) toolbarEl.classList.remove("is-visible");
	pendingRange = null;
}

function hideMarkMenu(): void
{
	if (markMenuEl) markMenuEl.classList.remove("is-visible");
}

function positionNearRect(el: HTMLElement, rect: DOMRect): void
{
	const top = Math.max(8, rect.top + window.scrollY - el.offsetHeight - 8);
	const left = Math.min(
		window.scrollX + window.innerWidth - el.offsetWidth - 8,
		Math.max(8, rect.left + window.scrollX + rect.width / 2 - el.offsetWidth / 2)
	);
	el.style.top = `${top}px`;
	el.style.left = `${left}px`;
}

function getValidSelectionRange(): Range | null
{
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0)
		return null;

	const range = selection.getRangeAt(0);
	const root = getDocumentRoot();
	if (!root) return null;
	if (!root.contains(range.commonAncestorContainer)) return null;
	if (!range.toString().trim()) return null;
	return range;
}

async function createHighlight(color: AnnotationColor): Promise<void>
{
	const range = pendingRange ?? getValidSelectionRange();
	if (!range || !callbacks) return;

	if (selectionIntersectsAnnotation(range))
	{
		hideToolbar();
		return;
	}

	const anchor = extractAnchorFromRange(range);
	if (!anchor) return;

	window.getSelection()?.removeAllRanges();
	hideToolbar();

	await annotationStore.add({
		pagePath: callbacks.getPagePath(),
		kind: "highlight",
		color,
		quote: anchor.quote,
		prefix: anchor.prefix,
		suffix: anchor.suffix,
	});
}

async function createNote(): Promise<void>
{
	const range = pendingRange ?? getValidSelectionRange();
	if (!range || !callbacks) return;

	if (selectionIntersectsAnnotation(range))
	{
		const existing = selectionIntersectsAnnotation(range);
		if (existing)
		{
			const item = annotationStore.getById(existing.dataset.id ?? "");
			if (item) callbacks.onEditNote(item);
		}
		hideToolbar();
		return;
	}

	const anchor = extractAnchorFromRange(range);
	if (!anchor) return;

	window.getSelection()?.removeAllRanges();
	hideToolbar();

	const item = await annotationStore.add({
		pagePath: callbacks.getPagePath(),
		kind: "note",
		color: "yellow",
		quote: anchor.quote,
		prefix: anchor.prefix,
		suffix: anchor.suffix,
		body: "",
	});

	callbacks.onCreateNote(item);
}

function showToolbarForSelection(): void
{
	const range = getValidSelectionRange();
	if (!range)
	{
		hideToolbar();
		return;
	}

	if (selectionIntersectsAnnotation(range))
	{
		hideToolbar();
		return;
	}

	pendingRange = range.cloneRange();
	const el = ensureToolbar();
	el.classList.add("is-visible");
	// Measure after visible
	requestAnimationFrame(() =>
	{
		positionNearRect(el, range.getBoundingClientRect());
	});
}

function showMarkMenu(mark: HTMLElement): void
{
	const id = mark.dataset.id;
	if (!id || !callbacks) return;
	const item = annotationStore.getById(id);
	if (!item) return;

	hideToolbar();
	const menu = ensureMarkMenu();
	menu.innerHTML = "";

	if (item.kind === "highlight")
	{
		const colors = document.createElement("div");
		colors.className = "export-annotation-colors";
		for (const color of ANNOTATION_COLORS)
		{
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `export-annotation-color-swatch color-${color}${item.color === color ? " is-active" : ""}`;
			btn.title = `颜色：${color}`;
			btn.addEventListener("click", async (e) =>
			{
				e.preventDefault();
				e.stopPropagation();
				const updated = await annotationStore.update(id, { color });
				document.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}[data-id="${id}"]`).forEach((el) =>
				{
					if (updated) syncAnnotationMarkAppearance(el as HTMLElement, updated);
				});
				hideMarkMenu();
			});
			colors.appendChild(btn);
		}
		menu.appendChild(colors);
	}

	if (item.kind === "note")
	{
		const editBtn = document.createElement("button");
		editBtn.type = "button";
		editBtn.className = "export-annotation-menu-btn";
		editBtn.textContent = "编辑备注";
		editBtn.addEventListener("click", (e) =>
		{
			e.preventDefault();
			e.stopPropagation();
			hideMarkMenu();
			callbacks?.onEditNote(item);
		});
		menu.appendChild(editBtn);
	}

	const deleteBtn = document.createElement("button");
	deleteBtn.type = "button";
	deleteBtn.className = "export-annotation-menu-btn is-danger";
	deleteBtn.textContent = "删除";
	deleteBtn.addEventListener("click", async (e) =>
	{
		e.preventDefault();
		e.stopPropagation();
		await annotationStore.remove(id);
		document.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}[data-id="${id}"]`).forEach((el) =>
			unwrapAnnotationMark(el as HTMLElement)
		);
		hideMarkMenu();
	});
	menu.appendChild(deleteBtn);

	menu.classList.add("is-visible");
	requestAnimationFrame(() =>
	{
		positionNearRect(menu, mark.getBoundingClientRect());
	});
}

export function initAnnotationToolbar(cbs: ToolbarCallbacks): void
{
	callbacks = cbs;
	ensureToolbar();
	ensureMarkMenu();

	document.addEventListener("mouseup", (event) =>
	{
		const target = event.target as Element | null;
		if (target?.closest(".export-annotation-toolbar, .export-annotation-mark-menu"))
			return;

		window.setTimeout(() => showToolbarForSelection(), 10);
	});

	document.addEventListener("mousedown", (event) =>
	{
		const target = event.target as Element | null;
		if (target?.closest(".export-annotation-toolbar, .export-annotation-mark-menu"))
			return;
		if (target?.closest(`mark.${ANNOTATION_MARK_CLASS}`))
			return;
		hideToolbar();
		hideMarkMenu();
	});

	document.addEventListener("click", (event) =>
	{
		const target = event.target as Element | null;
		const mark = target?.closest(`mark.${ANNOTATION_MARK_CLASS}`) as HTMLElement | null;
		if (!mark) return;
		event.preventDefault();
		event.stopPropagation();

		const id = mark.dataset.id;
		const item = id ? annotationStore.getById(id) : undefined;
		if (item?.kind === "note")
			focusNoteCorrespondence(item.id, { flashBody: false, openSidebar: true });

		showMarkMenu(mark);
	});

	document.addEventListener("keydown", (event) =>
	{
		if (event.key === "Escape")
		{
			hideToolbar();
			hideMarkMenu();
		}
	});
}

export function hideAnnotationOverlays(): void
{
	hideToolbar();
	hideMarkMenu();
}
