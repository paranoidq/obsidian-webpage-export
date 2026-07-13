import { AnnotationItem, ANNOTATION_MARK_CLASS } from "./types";

const CONTEXT_LEN = 32;

export interface TextQuoteAnchor
{
	quote: string;
	prefix: string;
	suffix: string;
}

function isSkippable(node: Node): boolean
{
	if (node.nodeType !== Node.ELEMENT_NODE) return false;
	const el = node as Element;
	return el.closest("script, style, .export-annotation-toolbar, .fullscreen-zoom-controls") != null;
}

export function getDocumentRoot(container?: ParentNode | null): HTMLElement | null
{
	const scope = (container as Element | null) ?? document;
	return (scope.querySelector?.("#center-content .markdown-preview-sizer")
		?? scope.querySelector?.("#center-content .obsidian-document")
		?? document.querySelector("#center-content .markdown-preview-sizer")
		?? document.querySelector("#center-content .obsidian-document")) as HTMLElement | null;
}

export function extractAnchorFromRange(range: Range): TextQuoteAnchor | null
{
	const quote = range.toString().replace(/\s+/g, " ").trim();
	if (!quote) return null;

	const root = getDocumentRoot(range.commonAncestorContainer.parentElement);
	if (!root) return null;

	const preRange = range.cloneRange();
	preRange.selectNodeContents(root);
	preRange.setEnd(range.startContainer, range.startOffset);
	const before = preRange.toString().replace(/\s+/g, " ");
	const postRange = range.cloneRange();
	postRange.selectNodeContents(root);
	postRange.setStart(range.endContainer, range.endOffset);
	const after = postRange.toString().replace(/\s+/g, " ");

	return {
		quote,
		prefix: before.slice(-CONTEXT_LEN),
		suffix: after.slice(0, CONTEXT_LEN),
	};
}

function buildTextIndex(root: HTMLElement): { text: string; nodes: { node: Text; start: number; end: number }[] }
{
	const nodes: { node: Text; start: number; end: number }[] = [];
	let text = "";
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node)
		{
			if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
			if (isSkippable(node)) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	let current: Node | null;
	while ((current = walker.nextNode()))
	{
		const value = current.nodeValue ?? "";
		const start = text.length;
		text += value;
		nodes.push({ node: current as Text, start, end: text.length });
	}

	return { text, nodes };
}

function findQuoteOffset(fullText: string, anchor: TextQuoteAnchor): number
{
	const needle = anchor.quote;
	if (!needle) return -1;

	const candidates: number[] = [];
	let from = 0;
	while (from <= fullText.length)
	{
		const idx = fullText.indexOf(needle, from);
		if (idx < 0) break;
		candidates.push(idx);
		from = idx + 1;
	}

	if (candidates.length === 0)
	{
		const collapsedFull = fullText.replace(/\s+/g, " ");
		const collapsedQuote = needle.replace(/\s+/g, " ");
		const collapsedIdx = collapsedFull.indexOf(collapsedQuote);
		if (collapsedIdx < 0) return -1;

		// Map collapsed index back to raw text index.
		let rawIndex = 0;
		let collapsedPos = 0;
		while (rawIndex < fullText.length && collapsedPos < collapsedIdx)
		{
			const ch = fullText[rawIndex];
			if (/\s/.test(ch))
			{
				while (rawIndex < fullText.length && /\s/.test(fullText[rawIndex]))
					rawIndex++;
				collapsedPos++;
			}
			else
			{
				rawIndex++;
				collapsedPos++;
			}
		}
		return rawIndex;
	}

	if (candidates.length === 1) return candidates[0];

	let best = candidates[0];
	let bestScore = -Infinity;
	for (const idx of candidates)
	{
		const prefix = fullText.slice(Math.max(0, idx - CONTEXT_LEN), idx);
		const suffix = fullText.slice(idx + needle.length, idx + needle.length + CONTEXT_LEN);
		let score = 0;
		if (anchor.prefix && prefix.endsWith(anchor.prefix)) score += 2;
		else if (anchor.prefix && prefix.includes(anchor.prefix.slice(-Math.min(12, anchor.prefix.length)))) score += 1;
		if (anchor.suffix && suffix.startsWith(anchor.suffix)) score += 2;
		else if (anchor.suffix && suffix.includes(anchor.suffix.slice(0, Math.min(12, anchor.suffix.length)))) score += 1;
		if (score > bestScore)
		{
			bestScore = score;
			best = idx;
		}
	}
	return best;
}

function rangeFromOffsets(index: { text: string; nodes: { node: Text; start: number; end: number }[] }, start: number, end: number): Range | null
{
	if (end <= start) return null;

	const range = document.createRange();
	let startSet = false;
	let endSet = false;

	for (const entry of index.nodes)
	{
		if (!startSet && start >= entry.start && start < entry.end)
		{
			range.setStart(entry.node, start - entry.start);
			startSet = true;
		}
		if (!endSet && end > entry.start && end <= entry.end)
		{
			range.setEnd(entry.node, end - entry.start);
			endSet = true;
			break;
		}
	}

	if (!startSet || !endSet) return null;
	return range;
}

export function findRangeForAnchor(root: HTMLElement, anchor: TextQuoteAnchor): Range | null
{
	const index = buildTextIndex(root);
	const start = findQuoteOffset(index.text, anchor);
	if (start < 0) return null;
	return rangeFromOffsets(index, start, start + anchor.quote.length);
}

export function unwrapAnnotationMark(mark: HTMLElement): void
{
	const parent = mark.parentNode;
	if (!parent) return;
	while (mark.firstChild)
		parent.insertBefore(mark.firstChild, mark);
	parent.removeChild(mark);
	parent.normalize();
}

function escapeSelectorValue(value: string): string
{
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
		return CSS.escape(value);
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function removeAnnotationMarksById(root: ParentNode, id: string): void
{
	root.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}[data-id="${escapeSelectorValue(id)}"]`)
		.forEach((el) => unwrapAnnotationMark(el as HTMLElement));
}

export function clearAllAnnotationMarks(root: ParentNode): void
{
	root.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}`)
		.forEach((el) => unwrapAnnotationMark(el as HTMLElement));
}

function createMarkElement(item: AnnotationItem): HTMLElement
{
	const mark = document.createElement("mark");
	mark.className = `${ANNOTATION_MARK_CLASS} export-annotation-${item.kind} export-annotation-color-${item.color}`;
	mark.dataset.id = item.id;
	mark.dataset.kind = item.kind;
	mark.dataset.color = item.color;
	mark.setAttribute("data-color", item.color);
	mark.setAttribute("data-kind", item.kind);
	return mark;
}

function getTextPartsInRange(range: Range): { node: Text; start: number; end: number }[]
{
	const parts: { node: Text; start: number; end: number }[] = [];
	const root = range.commonAncestorContainer;
	const walkerRoot = root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode;
	if (!walkerRoot) return parts;

	const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, {
		acceptNode(node)
		{
			if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
			if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	let current: Node | null;
	while ((current = walker.nextNode()))
	{
		const text = current as Text;
		let start = 0;
		let end = text.length;

		if (text === range.startContainer) start = range.startOffset;
		if (text === range.endContainer) end = range.endOffset;

		if (end > start)
			parts.push({ node: text, start, end });
	}

	return parts;
}

/**
 * Wrap only non-empty text slices. Avoids empty <mark> boxes from surroundContents/extractContents.
 */
export function wrapRangeWithAnnotation(range: Range, item: AnnotationItem): HTMLElement | null
{
	const startEl = range.startContainer instanceof Element
		? range.startContainer
		: range.startContainer.parentElement;
	if (startEl?.closest(`mark.${ANNOTATION_MARK_CLASS}`))
		return null;

	const parts = getTextPartsInRange(range);
	if (parts.length === 0) return null;

	let firstMark: HTMLElement | null = null;

	// Wrap from the end so earlier offsets stay valid.
	for (let i = parts.length - 1; i >= 0; i--)
	{
		const part = parts[i];
		if (part.end <= part.start) continue;
		if (!(part.node.textContent ?? "").slice(part.start, part.end).trim())
			continue;

		const nodeRange = document.createRange();
		nodeRange.setStart(part.node, part.start);
		nodeRange.setEnd(part.node, part.end);

		const mark = createMarkElement(item);
		try
		{
			nodeRange.surroundContents(mark);
			firstMark = mark;
		}
		catch
		{
			try
			{
				mark.appendChild(nodeRange.extractContents());
				if (!mark.textContent?.trim())
					continue;
				nodeRange.insertNode(mark);
				firstMark = mark;
			}
			catch (error)
			{
				console.warn("Failed to wrap annotation text node", error);
			}
		}
	}

	cleanupEmptyAnnotationMarks(document.getElementById("center-content") ?? document.body);
	return firstMark;
}

export function cleanupEmptyAnnotationMarks(root: ParentNode): void
{
	root.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}`).forEach((el) =>
	{
		if (!(el.textContent ?? "").trim())
			el.remove();
	});
}

export function applyAnnotationsToRoot(root: HTMLElement, items: AnnotationItem[]): { applied: string[]; missing: string[] }
{
	clearAllAnnotationMarks(root);
	const applied: string[] = [];
	const missing: string[] = [];

	for (const item of items)
	{
		const range = findRangeForAnchor(root, item);
		if (!range)
		{
			missing.push(item.id);
			continue;
		}
		const mark = wrapRangeWithAnnotation(range, item);
		if (mark) applied.push(item.id);
		else missing.push(item.id);
	}

	cleanupEmptyAnnotationMarks(root);
	return { applied, missing };
}

export function selectionIntersectsAnnotation(range: Range): HTMLElement | null
{
	const startEl = range.startContainer instanceof Element
		? range.startContainer
		: range.startContainer.parentElement;
	const endEl = range.endContainer instanceof Element
		? range.endContainer
		: range.endContainer.parentElement;
	return (startEl?.closest(`mark.${ANNOTATION_MARK_CLASS}`) as HTMLElement | null)
		?? (endEl?.closest(`mark.${ANNOTATION_MARK_CLASS}`) as HTMLElement | null);
}

export function flashAnnotationMark(id: string, times: number = 3): void
{
	const marks = document.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}[data-id="${escapeSelectorValue(id)}"]`);
	if (!marks.length) return;

	const first = marks[0] as HTMLElement;
	first.scrollIntoView({ behavior: "smooth", block: "center" });

	marks.forEach((el) =>
	{
		const mark = el as HTMLElement;
		mark.classList.remove("is-flash");
		// Restart CSS animation
		void mark.offsetWidth;
		mark.style.setProperty("--export-flash-times", String(Math.max(1, times)));
		mark.classList.add("is-flash");
	});

	window.setTimeout(() =>
	{
		marks.forEach((el) => el.classList.remove("is-flash"));
	}, Math.max(1, times) * 450 + 50);
}

/** Document order of note annotation ids currently present in the page. */
export function getNoteIdsInDocumentOrder(root?: ParentNode | null): string[]
{
	const scope = root ?? getDocumentRoot() ?? document;
	const seen = new Set<string>();
	const ordered: string[] = [];
	scope.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}[data-kind="note"]`).forEach((el) =>
	{
		const id = (el as HTMLElement).dataset.id;
		if (!id || seen.has(id)) return;
		seen.add(id);
		ordered.push(id);
	});
	return ordered;
}

export function syncAnnotationMarkAppearance(mark: HTMLElement, item: AnnotationItem): void
{
	mark.dataset.color = item.color;
	mark.dataset.kind = item.kind;
	mark.setAttribute("data-color", item.color);
	mark.setAttribute("data-kind", item.kind);
	mark.className = `${ANNOTATION_MARK_CLASS} export-annotation-${item.kind} export-annotation-color-${item.color}`;
}
