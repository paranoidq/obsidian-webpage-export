import {
	flashAnnotationMark,
	getNoteIdsInDocumentOrder,
	unwrapAnnotationMark,
} from "./anchor";
import { canUseFileSystemAccess } from "./persist";
import { annotationStore } from "./store";
import { AnnotationItem } from "./types";

let panelEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let editingId: string | null = null;
let openMenuId: string | null = null;
let activeNoteId: string | null = null;
let getPagePath: (() => string) | null = null;
let missingIdsCache = new Set<string>();

function ensurePanel(): HTMLElement
{
	if (panelEl) return panelEl;

	const host = document.querySelector("#right-sidebar-content") as HTMLElement | null;
	const panel = document.createElement("div");
	panel.id = "export-notes-panel";
	panel.className = "export-notes-panel tree-container";

	const header = document.createElement("div");
	header.className = "feature-header export-notes-header";

	const title = document.createElement("div");
	title.className = "feature-title";
	title.textContent = "备注";

	const actions = document.createElement("div");
	actions.className = "export-notes-actions";

	const importBtn = document.createElement("button");
	importBtn.type = "button";
	importBtn.className = "clickable-icon export-notes-action-btn";
	importBtn.title = "导入注解文件";
	importBtn.textContent = "导入";
	importBtn.addEventListener("click", async () =>
	{
		const ok = await annotationStore.importExplicit();
		if (ok) refreshNotesSidebar();
	});

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "clickable-icon export-notes-action-btn";
	saveBtn.title = canUseFileSystemAccess()
		? "保存到 annotations.json（可选择关联文件）"
		: "下载 annotations.json";
	saveBtn.textContent = "保存";
	saveBtn.addEventListener("click", async () =>
	{
		await annotationStore.saveExplicit();
		refreshNotesSidebar();
	});

	actions.append(importBtn, saveBtn);
	header.append(title, actions);

	statusEl = document.createElement("div");
	statusEl.className = "export-notes-status";

	listEl = document.createElement("div");
	listEl.className = "export-notes-list";

	panel.append(header, statusEl, listEl);

	if (host)
		host.appendChild(panel);
	else
	{
		panel.classList.add("is-floating-fallback");
		document.body.appendChild(panel);
	}

	document.addEventListener("click", (event) =>
	{
		const target = event.target as Element | null;
		if (target?.closest(".export-notes-more")) return;
		if (openMenuId)
		{
			openMenuId = null;
			refreshNotesSidebar();
		}
	});

	panelEl = panel;
	return panel;
}

function truncate(text: string, max = 80): string
{
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (cleaned.length <= max) return cleaned;
	return cleaned.slice(0, max - 1) + "…";
}

function sortNotesByDocumentOrder(notes: AnnotationItem[]): AnnotationItem[]
{
	const order = getNoteIdsInDocumentOrder();
	const rank = new Map(order.map((id, index) => [id, index]));
	return [...notes].sort((a, b) =>
	{
		const ai = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
		const bi = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
		if (ai !== bi) return ai - bi;
		return a.createdAt - b.createdAt;
	});
}

function renderEditor(container: HTMLElement, item: AnnotationItem): void
{
	const editor = document.createElement("div");
	editor.className = "export-notes-editor";

	const textarea = document.createElement("textarea");
	textarea.className = "export-notes-textarea";
	textarea.rows = 4;
	textarea.placeholder = "填写备注…";
	textarea.value = item.body ?? "";

	const row = document.createElement("div");
	row.className = "export-notes-editor-actions";

	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "export-notes-btn primary";
	saveBtn.textContent = "保存";
	saveBtn.addEventListener("click", async (event) =>
	{
		event.stopPropagation();
		await annotationStore.update(item.id, { body: textarea.value });
		editingId = null;
		refreshNotesSidebar();
	});

	const cancelBtn = document.createElement("button");
	cancelBtn.type = "button";
	cancelBtn.className = "export-notes-btn";
	cancelBtn.textContent = "取消";
	cancelBtn.addEventListener("click", (event) =>
	{
		event.stopPropagation();
		editingId = null;
		refreshNotesSidebar();
	});

	row.append(saveBtn, cancelBtn);
	editor.append(textarea, row);
	container.appendChild(editor);
	textarea.focus();
}

function renderNoteCard(item: AnnotationItem, missing: boolean): HTMLElement
{
	const card = document.createElement("div");
	card.className = `export-notes-card${missing ? " is-missing" : ""}${activeNoteId === item.id ? " is-active" : ""}`;
	card.dataset.id = item.id;
	card.addEventListener("click", (event) =>
	{
		const target = event.target as Element | null;
		if (target?.closest(".export-notes-more, .export-notes-editor, textarea, .export-notes-btn"))
			return;
		focusNoteCorrespondence(item.id, { flashBody: true, openSidebar: false });
	});

	const topRow = document.createElement("div");
	topRow.className = "export-notes-card-top";

	const quote = document.createElement("button");
	quote.type = "button";
	quote.className = "export-notes-quote";
	quote.textContent = truncate(item.quote);
	quote.title = item.quote;
	quote.addEventListener("click", (event) =>
	{
		event.stopPropagation();
		focusNoteCorrespondence(item.id, { flashBody: true, openSidebar: false });
	});

	const moreWrap = document.createElement("div");
	moreWrap.className = "export-notes-more";

	const moreBtn = document.createElement("button");
	moreBtn.type = "button";
	moreBtn.className = "export-notes-more-btn";
	moreBtn.title = "更多";
	moreBtn.setAttribute("aria-label", "更多");
	moreBtn.textContent = "⋯";
	moreBtn.addEventListener("click", (event) =>
	{
		event.preventDefault();
		event.stopPropagation();
		openMenuId = openMenuId === item.id ? null : item.id;
		refreshNotesSidebar();
	});

	moreWrap.appendChild(moreBtn);

	if (openMenuId === item.id && editingId !== item.id)
	{
		const menu = document.createElement("div");
		menu.className = "export-notes-more-menu";

		const editBtn = document.createElement("button");
		editBtn.type = "button";
		editBtn.className = "export-notes-menu-item";
		editBtn.textContent = "修改";
		editBtn.addEventListener("click", (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			openMenuId = null;
			editingId = item.id;
			refreshNotesSidebar();
		});

		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "export-notes-menu-item is-danger";
		deleteBtn.textContent = "删除";
		deleteBtn.addEventListener("click", async (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			openMenuId = null;
			await annotationStore.remove(item.id);
			document.querySelectorAll(`mark.export-annotation[data-id="${item.id}"]`).forEach((el) =>
				unwrapAnnotationMark(el as HTMLElement)
			);
			if (activeNoteId === item.id) activeNoteId = null;
			refreshNotesSidebar();
		});

		menu.append(editBtn, deleteBtn);
		moreWrap.appendChild(menu);
	}

	topRow.append(quote, moreWrap);
	card.appendChild(topRow);

	if (missing)
	{
		const warn = document.createElement("div");
		warn.className = "export-notes-missing";
		warn.textContent = "无法在当前页定位原文";
		card.appendChild(warn);
	}

	if (editingId === item.id)
	{
		renderEditor(card, item);
		return card;
	}

	const body = document.createElement("div");
	body.className = "export-notes-body";
	body.textContent = (item.body ?? "").trim() || "（空备注）";
	card.appendChild(body);

	return card;
}

export function refreshNotesSidebar(missingIds: Set<string> = missingIdsCache): void
{
	ensurePanel();
	if (!listEl || !statusEl || !getPagePath) return;

	missingIdsCache = missingIds;
	const pagePath = getPagePath();
	const notes = sortNotesByDocumentOrder(
		annotationStore.getForPage(pagePath).filter((item) => item.kind === "note")
	);

	statusEl.textContent = annotationStore.isLinked()
		? "已关联 annotations.json（自动保存）"
		: "未关联文件：可用「保存」下载或关联";

	listEl.innerHTML = "";
	if (notes.length === 0)
	{
		const empty = document.createElement("div");
		empty.className = "export-notes-empty";
		empty.textContent = "本页暂无备注。选中文字后点「备注」添加。";
		listEl.appendChild(empty);
		return;
	}

	for (const note of notes)
		listEl.appendChild(renderNoteCard(note, missingIds.has(note.id)));
}

export function highlightNotesSidebarCard(id: string): void
{
	activeNoteId = id;
	ensureRightSidebarOpen();
	refreshNotesSidebar();

	requestAnimationFrame(() =>
	{
		const card = listEl?.querySelector(`.export-notes-card[data-id="${CSS.escape?.(id) ?? id}"]`) as HTMLElement | null;
		card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	});
}

export function focusNoteCorrespondence(
	id: string,
	options: { flashBody?: boolean; openSidebar?: boolean } = {}
): void
{
	const { flashBody = true, openSidebar = true } = options;
	if (openSidebar) ensureRightSidebarOpen();
	highlightNotesSidebarCard(id);
	if (flashBody) flashAnnotationMark(id, 3);
}

export function openNoteEditor(item: AnnotationItem): void
{
	editingId = item.id;
	openMenuId = null;
	activeNoteId = item.id;
	ensureRightSidebarOpen();
	refreshNotesSidebar();
}

function ensureRightSidebarOpen(): void
{
	if (ObsidianSite.rightSidebar?.collapsed)
		ObsidianSite.rightSidebar.collapsed = false;
}

export function initNotesSidebar(getPath: () => string): void
{
	getPagePath = getPath;
	ensurePanel();
	refreshNotesSidebar();
	annotationStore.subscribe(() => refreshNotesSidebar());
}
