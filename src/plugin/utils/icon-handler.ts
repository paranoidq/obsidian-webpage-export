import { getIcon as getObsidianIcon, requestUrl } from "obsidian";
import { EmojiStyle } from "src/shared/website-data";
import { Settings } from "src/plugin/settings/settings";


export namespace IconHandler
{
	export function getLucideIcon(iconName: string): string | undefined
	{
		const iconEl = getObsidianIcon(iconName);
		if (iconEl)
		{
			const svg = iconEl.outerHTML;
			iconEl.remove();
			return svg;
		}
		else 
		{
			return undefined;
		}
	}

	export function getEmojiIcon(iconCode: string): string | undefined
	{
		const iconCodeInt = parseInt(iconCode, 16);
		if (!isNaN(iconCodeInt)) 
		{
			return String.fromCodePoint(iconCodeInt);
		} 
		else 
		{
			return undefined;
		}
	}

	export async function getIcon(iconName: string): Promise<string>
	{
		if (iconName.startsWith('emoji//'))
		{
			const iconCode = iconName.replace(/^emoji\/\//, '');
			iconName = getEmojiIcon(iconCode) ?? "�";
		}
		else if (iconName.startsWith('lucide//'))
		{
			const lucideIconName = iconName.replace(/^lucide\/\//, '');
			iconName = getLucideIcon(lucideIconName) ?? "�";
		}

		// Only convert true emoji (😀⚡), not text-default symbols like ↔™
		if (IconHandler.isEmojiPresentation(iconName))
		{
			const codepoint = [...iconName].map(e => e.codePointAt(0)!.toString(16)).join(`-`);

			switch (Settings.exportOptions.iconEmojiStyle)
			{
				case EmojiStyle.Twemoji:
					return `<img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${codepoint}.svg" class="emoji" />`;
				case EmojiStyle.OpenMoji:
					return `<img src="https://openmoji.org/data/color/svg/${codepoint.toUpperCase()}.svg" class="emoji" />`;
				case EmojiStyle.OpenMojiOutline:
					const req = await requestUrl(`https://openmoji.org/data/black/svg/${codepoint.toUpperCase()}.svg`);
					if (req.status == 200)
						return req.text.replaceAll(/#00+/g, "currentColor").replaceAll(`stroke-width="2"`, `stroke-width="5"`);
			
					return iconName;
				case EmojiStyle.FluentUI:
					return `<img src="https://emoji.fluent-cdn.com/1.0.0/100x100/${codepoint}.png" class="emoji" />`;
				default:
					return iconName;
			}
		}

		return getLucideIcon(iconName.toLowerCase()) ?? iconName; // try and parse a plain lucide icon name
	}

	/** True emoji like 😀⚡; excludes text-default symbols such as ↔™. */
	export function isEmojiPresentation(text: string): boolean
	{
		return /^\p{Emoji_Presentation}/u.test(text);
	}

	/**
	 * Force text presentation (U+FE0E) on text-default pictographs (e.g. ↔ / ↔️)
	 * so macOS/iOS don't render them as oversized color emoji mid-sentence.
	 * True emoji (😀⚡) are left unchanged.
	 */
	export function forceTextPresentationInElement(root: HTMLElement): void
	{
		const doc = root.ownerDocument ?? document;
		const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];

		let node = walker.nextNode();
		while (node)
		{
			const parent = node.parentElement;
			if (parent && !parent.closest("code, pre, script, style, textarea"))
			{
				textNodes.push(node as Text);
			}
			node = walker.nextNode();
		}

		for (const textNode of textNodes)
		{
			const value = textNode.nodeValue;
			if (!value || !/\p{Extended_Pictographic}/u.test(value)) continue;

			// Text-default pictographs → always FE0E (strip FE0F if present).
			// Emoji_Presentation chars keep their original form.
			const next = value.replace(/(\p{Extended_Pictographic})\uFE0F?/gu, (match, char: string) =>
			{
				if (/\p{Emoji_Presentation}/u.test(char)) return match;
				return char + "\uFE0E";
			});

			if (next !== value) textNode.nodeValue = next;
		}
	}
}
