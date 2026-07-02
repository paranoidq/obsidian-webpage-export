import { slideDown, slideUp } from "./utils";

const CHEVRON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * Whitelist of code block languages that should receive a collapsible header.
 * Only mainstream programming languages and common text/config formats are
 * included so that plugin blocks (mermaid, dataview, admonition, etc.) are not
 * affected. Those plugin blocks are usually rendered as `block-language-*`
 * divs rather than `<pre><code>` anyway.
 */
const LANGUAGE_WHITELIST = new Set<string>([
	// C family
	"c", "h", "cpp", "c++", "cc", "cxx", "hpp", "cs", "csharp", "objc", "objective-c", "objectivec",
	// JVM
	"java", "kotlin", "kt", "kts", "scala", "groovy", "clojure", "clj",
	// Go / Rust / Swift / Dart
	"go", "golang", "rust", "rs", "swift", "dart",
	// Web
	"js", "javascript", "mjs", "cjs", "jsx", "ts", "typescript", "tsx",
	"html", "htm", "xml", "svg", "css", "scss", "sass", "less", "vue", "svelte",
	// Scripting
	"py", "python", "rb", "ruby", "php", "perl", "pl", "lua", "r",
	"sh", "bash", "shell", "zsh", "fish", "ps1", "powershell", "bat", "cmd", "batch",
	// Functional / others
	"haskell", "hs", "elixir", "ex", "erlang", "erl", "fsharp", "fs", "ocaml", "elm",
	"julia", "jl", "matlab", "vb", "vbnet", "pascal", "fortran", "cobol", "asm", "assembly",
	"solidity", "sol", "zig", "nim", "crystal", "cr", "d",
	// Data / query
	"sql", "graphql", "gql", "sparql", "cypher",
	// Config / markup / data
	"json", "json5", "jsonc", "yaml", "yml", "toml", "ini", "properties", "env", "dotenv",
	"csv", "tsv", "md", "markdown", "tex", "latex", "rst",
	"dockerfile", "docker", "makefile", "make", "cmake", "nginx", "apache",
	"diff", "patch", "http", "proto", "protobuf", "gradle", "terraform", "hcl", "tf",
	"gitignore", "editorconfig",
	// Plain text
	"txt", "text", "plaintext", "plain", "none",
]);

export class CodeBlock
{
	public wrapperEl: HTMLElement;
	public preEl: HTMLElement;
	public codeEl: HTMLElement;
	public headerEl: HTMLElement;
	public foldIconEl: HTMLElement;
	public copyButtonEl: HTMLElement;

	private collapsed: boolean = false;
	private copyResetTimeout: number | null = null;

	constructor(preEl: HTMLElement, codeEl: HTMLElement, startCollapsed: boolean)
	{
		this.preEl = preEl;
		this.codeEl = codeEl;

		// remove obsidian's native copy button
		preEl.querySelectorAll("button.copy-code-button").forEach((el) => el.remove());

		// wrap the <pre> in a container and prepend a header
		const wrapper = document.createElement("div");
		wrapper.className = "code-block-wrapper";
		preEl.parentElement?.insertBefore(wrapper, preEl);

		const header = document.createElement("div");
		header.className = "code-block-header";

		// macOS style traffic-light dots on the left
		const dots = document.createElement("div");
		dots.className = "code-block-dots";
		for (let i = 0; i < 3; i++)
		{
			const dot = document.createElement("span");
			dot.className = "code-block-dot";
			dots.appendChild(dot);
		}

		const right = document.createElement("div");
		right.className = "code-block-header-right";

		const foldIcon = document.createElement("div");
		foldIcon.className = "code-block-fold-indicator";
		foldIcon.innerHTML = CHEVRON_ICON;

		const copyButton = document.createElement("button");
		copyButton.className = "code-block-copy";
		copyButton.setAttribute("type", "button");
		copyButton.setAttribute("aria-label", "Copy");
		copyButton.innerHTML = COPY_ICON;

		right.appendChild(foldIcon);
		right.appendChild(copyButton);

		header.appendChild(dots);
		header.appendChild(right);

		wrapper.appendChild(header);
		wrapper.appendChild(preEl);

		this.wrapperEl = wrapper;
		this.headerEl = header;
		this.foldIconEl = foldIcon;
		this.copyButtonEl = copyButton;

		if (startCollapsed) this.setInitiallyCollapsed();

		this.init();
	}

	private setInitiallyCollapsed()
	{
		this.collapsed = true;
		this.wrapperEl.classList.add("is-collapsed");
		this.foldIconEl.classList.add("is-collapsed");
		this.preEl.style.display = "none";
	}

	public toggle(force?: boolean)
	{
		if (force === undefined) force = !this.collapsed;
		this.collapsed = force;
		this.wrapperEl.classList.toggle("is-collapsed", force);
		this.foldIconEl.classList.toggle("is-collapsed", force);
		if (force) slideUp(this.preEl, 150);
		else slideDown(this.preEl, 150);
	}

	private init()
	{
		this.headerEl.addEventListener("click", (event) =>
		{
			// don't toggle when the copy button (or its children) is clicked
			if ((event.target as HTMLElement).closest(".code-block-copy")) return;
			this.toggle();
		});

		this.copyButtonEl.addEventListener("click", async (event) =>
		{
			event.stopPropagation();
			const text = this.getCodeText();
			const success = await CodeBlocks.copyText(text);
			this.showCopyFeedback(success);
		});
	}

	/**
	 * Extract the code text while preserving the original line breaks and
	 * indentation. Handles the standard reading-mode structure (literal "\n"
	 * text nodes) as well as code-enhancer plugins that split each line into a
	 * separate element or use <br> for line breaks, where a plain textContent
	 * read would collapse everything onto a single line.
	 */
	private getCodeText(): string
	{
		const raw = this.codeEl.textContent ?? "";
		if (raw.includes("\n")) return raw;

		// <br>-separated lines
		if (this.codeEl.querySelector("br"))
		{
			const clone = this.codeEl.cloneNode(true) as HTMLElement;
			clone.querySelectorAll("br").forEach((br) =>
				br.replaceWith(document.createTextNode("\n"))
			);
			const text = clone.textContent ?? "";
			if (text.includes("\n")) return text;
		}

		// per-line block elements (Code Styler / CodeMirror / similar)
		const lineSelectors = [".cm-line", ".code-styler-line", ".code-line", ".line"];
		for (const selector of lineSelectors)
		{
			const lineEls = this.codeEl.querySelectorAll(selector);
			if (lineEls.length > 1)
			{
				return Array.from(lineEls)
					.map((el) => el.textContent ?? "")
					.join("\n");
			}
		}

		return raw;
	}

	private showCopyFeedback(success: boolean)
	{
		if (this.copyResetTimeout !== null)
		{
			window.clearTimeout(this.copyResetTimeout);
			this.copyResetTimeout = null;
		}

		this.copyButtonEl.classList.toggle("copied", success);
		this.copyButtonEl.classList.toggle("copy-failed", !success);
		this.copyButtonEl.innerHTML = success ? CHECK_ICON : COPY_ICON;

		this.copyResetTimeout = window.setTimeout(() =>
		{
			this.copyButtonEl.classList.remove("copied", "copy-failed");
			this.copyButtonEl.innerHTML = COPY_ICON;
			this.copyResetTimeout = null;
		}, 1500);
	}
}

export class CodeBlocks
{
	public static isEnabled(): boolean
	{
		const meta = ObsidianSite.metadata;
		if (!meta || meta.ignoreMetadata) return false;
		return meta.isCascadeExport === true && meta.combineAsSingleFile === true;
	}

	public static process(root: HTMLElement, threshold: number): void
	{
		if (!root) return;

		const preEls = Array.from(root.querySelectorAll("pre")) as HTMLElement[];
		for (const preEl of preEls)
		{
			this.processBlock(preEl, threshold);
		}
	}

	private static processBlock(preEl: HTMLElement, threshold: number): void
	{
		if (preEl.classList.contains("code-block-processed")) return;

		// only process real code blocks: <pre> directly containing a <code>
		const codeEl = preEl.querySelector(":scope > code") as HTMLElement | null;
		if (!codeEl) return;

		// never touch plugin blocks that render inside a block-language-* container
		if (preEl.closest("[class^='block-language-']")) return;

		const language = this.getLanguageToken(codeEl, preEl);

		// language present but not whitelisted -> leave untouched (likely a plugin)
		if (language !== null && !LANGUAGE_WHITELIST.has(language)) return;

		const startCollapsed = threshold > 0 && this.countLines(codeEl) > threshold;

		preEl.classList.add("code-block-processed");
		new CodeBlock(preEl, codeEl, startCollapsed);
	}

	/**
	 * Returns the language token (lowercased) from a `language-xxx` class, an
	 * empty-string sentinel converted to null when there is no marker.
	 */
	private static getLanguageToken(codeEl: HTMLElement, preEl: HTMLElement): string | null
	{
		const fromEl = (el: HTMLElement | null): string | null =>
		{
			if (!el) return null;
			for (const cls of Array.from(el.classList))
			{
				if (cls.startsWith("language-"))
				{
					const token = cls.substring("language-".length).toLowerCase().trim();
					if (token.length > 0) return token;
				}
			}
			return null;
		};

		return fromEl(codeEl) ?? fromEl(preEl);
	}

	private static countLines(codeEl: HTMLElement): number
	{
		const text = (codeEl.textContent ?? "").replace(/\n+$/, "");
		if (text.length === 0) return 0;
		return text.split("\n").length;
	}

	public static async copyText(text: string): Promise<boolean>
	{
		try
		{
			if (navigator.clipboard && navigator.clipboard.writeText)
			{
				await navigator.clipboard.writeText(text);
				return true;
			}
		}
		catch (e)
		{
			// fall through to the execCommand fallback (e.g. on file://)
		}

		try
		{
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.top = "0";
			textarea.style.left = "0";
			textarea.style.width = "1px";
			textarea.style.height = "1px";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			const ok = document.execCommand("copy");
			textarea.remove();
			return ok;
		}
		catch (e)
		{
			return false;
		}
	}
}
