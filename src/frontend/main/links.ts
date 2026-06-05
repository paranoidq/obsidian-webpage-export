import { FilePreviewPopover } from "./link-preview";

export class LinkHandler
{

	public static initializeLinks(onElement: HTMLElement)
	{
		console.log("Initializing links on element", onElement);
		onElement?.querySelectorAll(".internal-link, a.tag, a.tree-item-self, a.footnote-link").forEach(function(link: HTMLElement)
		{
			const target = link.getAttribute("href") ?? "null";

			if(target == "null")
			{
				console.log("No target found for link");
				return;
			}

			link.addEventListener("click", function(event)
			{
				if (ObsidianSite.supportsClientSideHistory && !LinkHandler.isExternalURL(target))
				{
					event.preventDefault();
					event.stopPropagation();
					ObsidianSite.loadURL(target);
				}

				// Close the sidebar containing this link on phone
				if (ObsidianSite.deviceSize === "phone")
				{
					// Find which sidebar contains this link
					const leftSidebar = link.closest("#left-sidebar");
					const rightSidebar = link.closest("#right-sidebar");

					if (leftSidebar && ObsidianSite.leftSidebar?.collapsed === false)
					{
						ObsidianSite.leftSidebar.collapsed = true;
					}
					else if (rightSidebar && ObsidianSite.rightSidebar?.collapsed === false)
					{
						ObsidianSite.rightSidebar.collapsed = true;
					}
				}
			});

			// if the link doesn't point to a valid document in ObsidianSite set it to unresolved
			if(target && !LinkHandler.isExternalURL(target) && !ObsidianSite.documentExists(target))
			{
				link.classList.add("is-unresolved");
			}
			else if (link.classList.contains("internal-link"))
			{
				// Only initialize link preview if the feature is enabled
				if (!ObsidianSite.metadata?.ignoreMetadata && 
					ObsidianSite.metadata?.featureOptions?.linkPreview?.enabled)
				{
					FilePreviewPopover.initializeLink(link, target);
				}
			}
		});
	}

	public static getPathnameFromURL(url: string): string
	{
		if(url == "" || url == "/" || url == "\\") return "index.html";
		if(url?.startsWith("#") || url?.startsWith("?")) return ObsidianSite.document?.pathname ?? "index.html";

		const queryIndex = url.indexOf("?");
		const hashIndex = url.indexOf("#");
		const endIndex = [queryIndex, hashIndex].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? url.length;
		return url.substring(0, endIndex).trim() || "index.html";
	}

	public static getHashFromURL(url: string): string
	{
		return (url.split("#")[1] ?? "").split("?")[0]?.trim() ?? "";
	}

	public static getQueryFromURL(url: string): string
	{
		const queryIndex = url.indexOf("?");
		const hashIndex = url.indexOf("#");
		if (queryIndex < 0 || (hashIndex >= 0 && hashIndex < queryIndex)) return "";
		return url.substring(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)?.trim() ?? "";
	}

	public static buildInternalURL(pathname: string, query: string = "", hash: string = ""): string
	{
		let url = pathname == "index.html" ? "" : pathname;
		if (query) url += `?${query}`;
		if (hash) url += `#${hash}`;
		return url;
	}

	public static normalizeInternalURL(url: string): string
	{
		return this.buildInternalURL(
			this.getPathnameFromURL(url),
			this.getQueryFromURL(url),
			this.getHashFromURL(url)
		);
	}

	public static getClientSideHistoryURL(internalURL: string): string
	{
		const url = new URL(window.location.href);
		url.search = "";
		url.hash = "";

		const params = new URLSearchParams();
		params.set("page", internalURL || "index.html");
		url.search = params.toString();
		return url.href;
	}

	public static getInternalURLFromClientSideHistory(): string | undefined
	{
		return new URLSearchParams(window.location.search).get("page") ?? undefined;
	}

	public static isExternalURL(url: string): boolean
	{
		return url.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(url);
	}

	public static getExportRelativeHref(url: string): string
	{
		if (this.isExternalURL(url)) return url;

		const baseEl = document.querySelector("base");
		const rootHref = baseEl?.href
			?? (ObsidianSite.document?.info?.pathToRoot
				? new URL(ObsidianSite.document.info.pathToRoot, window.location.href).href
				: new URL("./", window.location.href).href);

		return new URL(url, rootHref).href;
	}

	public static getFileDataIdFromURL(url: string): string
	{
		url = this.getPathnameFromURL(url);
		if (url.startsWith("./")) url = url.substring(2);
		while (url.startsWith("../")) {
			url = url.substring(3);
		}
		return btoa(encodeURI(url));
	}
}
