export interface H1Section
{
	/** Display title with `#word-…` tags removed. */
	title: string;
	markdown: string;
	outputFileName: string;
	/** Index of this H1 among all ATX H1s in the source file (for DOM clipping). */
	sourceH1Index: number;
	/**
	 * Word attachment id from a `#word-<id>` tag on the H1 line.
	 * Maps to `{{html_attachment:<id>}}` in the Word template.
	 */
	wordAttachmentId?: string;
}

const ATX_H1_LINE = /^#\s+(.+?)\s*$/;
const ILLEGAL_FILENAME_CHARS = /[\/\\:*?"<>|]/g;
/** Obsidian tags like `#word-status` used to map H1 sections into Word placeholders. */
const WORD_ATTACHMENT_TAG = /(?:^|\s)#word-([A-Za-z0-9_-]+)\b/g;

export interface ParsedH1Title
{
	displayTitle: string;
	wordAttachmentId?: string;
}

/**
 * Extract `#word-<id>` tags from an H1 title and return a cleaned display title.
 * When multiple `#word-…` tags exist, the last one wins.
 */
export function parseH1TitleForWordAttachment(rawTitle: string): ParsedH1Title
{
	let wordAttachmentId: string | undefined;
	const withoutWordTags = rawTitle.replace(WORD_ATTACHMENT_TAG, (_match, id: string) =>
	{
		wordAttachmentId = id;
		return " ";
	});

	const displayTitle = withoutWordTags.replace(/\s+/g, " ").trim();
	return { displayTitle, wordAttachmentId };
}

/**
 * Split markdown into sections by ATX level-1 headings (`# `).
 * Content before the first H1 is discarded.
 * Headings inside fenced code blocks are ignored.
 * Sections whose body is empty/whitespace-only (aside from the H1 line) are skipped.
 * Returns an empty array when there are no exportable H1 sections.
 *
 * `#word-<id>` tags on H1 lines are stripped from the exported markdown/title/filename
 * and exposed as `wordAttachmentId` for Word template embedding.
 */
export function splitMarkdownByH1(markdown: string): H1Section[]
{
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const sections: { rawTitle: string; lines: string[] }[] = [];
	let current: { rawTitle: string; lines: string[] } | undefined;
	let inFence = false;
	let fenceMarker = "";

	for (const line of lines)
	{
		const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/);
		if (fenceMatch)
		{
			const ticks = fenceMatch[1];
			if (!inFence)
			{
				inFence = true;
				fenceMarker = ticks;
			}
			else if (ticks[0] === fenceMarker[0] && ticks.length >= fenceMarker.length && fenceMatch[2].trim() === "")
			{
				inFence = false;
				fenceMarker = "";
			}

			if (current) current.lines.push(line);
			continue;
		}

		if (!inFence)
		{
			const h1Match = line.match(ATX_H1_LINE);
			if (h1Match)
			{
				current = { rawTitle: h1Match[1].trim(), lines: [line] };
				sections.push(current);
				continue;
			}
		}

		if (current) current.lines.push(line);
	}

	if (sections.length === 0) return [];

	const usedNames = new Map<string, number>();
	const result: H1Section[] = [];

	for (let sourceH1Index = 0; sourceH1Index < sections.length; sourceH1Index++)
	{
		const section = sections[sourceH1Index];
		if (!sectionHasBodyContent(section.lines)) continue;

		const parsed = parseH1TitleForWordAttachment(section.rawTitle);
		const title = parsed.displayTitle.length > 0 ? parsed.displayTitle : "section";
		const cleanedLines = [...section.lines];
		cleanedLines[0] = `# ${title}`;

		result.push({
			title,
			markdown: cleanedLines.join("\n").replace(/\n+$/, "") + "\n",
			outputFileName: allocateOutputFileName(title, usedNames),
			sourceH1Index,
			wordAttachmentId: parsed.wordAttachmentId,
		});
	}

	return result;
}

/** True when there is non-whitespace content after the leading H1 line. */
function sectionHasBodyContent(lines: string[]): boolean
{
	if (lines.length <= 1) return false;

	for (let i = 1; i < lines.length; i++)
	{
		if (lines[i].trim().length > 0) return true;
	}

	return false;
}

export function sanitizeH1FileStem(title: string): string
{
	const cleaned = title
		.replace(ILLEGAL_FILENAME_CHARS, "")
		.replace(/\s+/g, " ")
		.trim();

	return cleaned.length > 0 ? cleaned : "section";
}

function allocateOutputFileName(title: string, usedNames: Map<string, number>): string
{
	const stem = sanitizeH1FileStem(title);
	const count = usedNames.get(stem) ?? 0;
	usedNames.set(stem, count + 1);
	const uniqueStem = count === 0 ? stem : `${stem}_${count}`;
	return `${uniqueStem}.html`;
}

/**
 * After a full-file preview render, keep only the Nth H1 section's DOM
 * (from that h1 through the node before the next h1). Does not touch vault files.
 */
export function clipRenderedContentToH1Section(contentEl: HTMLElement, sectionIndex: number): void
{
	const sizer = (contentEl.querySelector(".markdown-preview-sizer") as HTMLElement | null) ?? contentEl;
	const headings = Array.from(sizer.querySelectorAll("h1"));
	if (sectionIndex < 0 || sectionIndex >= headings.length) return;

	const startHeading = headings[sectionIndex];
	const endHeading = headings[sectionIndex + 1];
	const startBlock = findTopLevelBlock(sizer, startHeading);
	const endBlock = endHeading ? findTopLevelBlock(sizer, endHeading) : null;
	if (!startBlock) return;

	const blocks = Array.from(sizer.children);
	let reachedStart = false;

	for (const block of blocks)
	{
		if (block === startBlock)
		{
			reachedStart = true;
			continue;
		}

		if (endBlock && block === endBlock)
		{
			let node: ChildNode | null = block;
			while (node)
			{
				const next: ChildNode | null = node.nextSibling;
				node.remove();
				node = next;
			}
			break;
		}

		if (!reachedStart)
			block.remove();
	}

	// Render uses the vault file; strip #word-… markers from the visible H1.
	stripWordAttachmentTagsFromHeading(startHeading);
}

/**
 * Remove `#word-<id>` tags from a rendered heading (Obsidian tag links and plain text).
 */
export function stripWordAttachmentTagsFromHeading(heading: Element): void
{
	heading.querySelectorAll("a.tag").forEach((anchor) =>
	{
		const text = (anchor.textContent ?? "").trim();
		if (/^#word-[A-Za-z0-9_-]+$/.test(text))
			anchor.remove();
	});

	const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode()))
		textNodes.push(node as Text);

	for (const textNode of textNodes)
	{
		const next = textNode.nodeValue?.replace(WORD_ATTACHMENT_TAG, " ").replace(/\s+/g, " ");
		if (next !== undefined && next !== textNode.nodeValue)
			textNode.nodeValue = next;
	}

	heading.normalize();
}

function findTopLevelBlock(sizer: HTMLElement, el: Element): Element | null
{
	let current: Element | null = el;
	while (current && current.parentElement !== sizer)
		current = current.parentElement;

	return current?.parentElement === sizer ? current : null;
}
