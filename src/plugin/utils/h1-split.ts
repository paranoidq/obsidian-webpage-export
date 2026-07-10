export interface H1Section
{
	title: string;
	markdown: string;
	outputFileName: string;
	/** Index of this H1 among all ATX H1s in the source file (for DOM clipping). */
	sourceH1Index: number;
}

const ATX_H1_LINE = /^#\s+(.+?)\s*$/;
const ILLEGAL_FILENAME_CHARS = /[\/\\:*?"<>|]/g;

/**
 * Split markdown into sections by ATX level-1 headings (`# `).
 * Content before the first H1 is discarded.
 * Headings inside fenced code blocks are ignored.
 * Sections whose body is empty/whitespace-only (aside from the H1 line) are skipped.
 * Returns an empty array when there are no exportable H1 sections.
 */
export function splitMarkdownByH1(markdown: string): H1Section[]
{
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const sections: { title: string; lines: string[] }[] = [];
	let current: { title: string; lines: string[] } | undefined;
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
				current = { title: h1Match[1].trim(), lines: [line] };
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

		result.push({
			title: section.title,
			markdown: section.lines.join("\n").replace(/\n+$/, "") + "\n",
			outputFileName: allocateOutputFileName(section.title, usedNames),
			sourceH1Index,
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
}

function findTopLevelBlock(sizer: HTMLElement, el: Element): Element | null
{
	let current: Element | null = el;
	while (current && current.parentElement !== sizer)
		current = current.parentElement;

	return current?.parentElement === sizer ? current : null;
}
