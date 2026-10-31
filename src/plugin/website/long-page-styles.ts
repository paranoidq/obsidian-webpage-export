import postcss from "postcss";
import safeParser from "postcss-safe-parser";

/** Keep theme rules scoped to their reading panes after removing the app shell.
 * Rewrite selectors only: CSS values, SVG data URIs and custom properties must
 * keep their original contents. Multiple notes use classes instead of duplicate ids.
 */
export function remapLongPageCss(css: string): string
{
	const root = safeParser(css) as postcss.Root;
	root.walkRules((rule) =>
	{
		rule.selector = rule.selector.replace(
			/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/)|(#center-content|\.markdown-reading-view|#main-horizontal|\.workspace|#main)(?![\w-])/g,
			(token, literal: string | undefined) =>
			{
				if (literal) return literal;
				if (token === "#center-content" || token === ".markdown-reading-view") return ".lp-page";
				if (token === "#main") return "#lp-root";
				return "#lp-content";
			},
		);
	});
	return root.toString();
}
