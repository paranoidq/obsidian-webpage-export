import { CascadeBreadcrumbItem } from "src/shared/website-data";

const HOME_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-home"><path d="m3 9 9-7 9 7"/><path d="M9 22V12h6v10"/><path d="M21 22H3"/></svg>`;

export class CascadeBreadcrumbs
{
	public static render(container: HTMLElement, breadcrumbs: CascadeBreadcrumbItem[] | undefined): void
	{
		container.querySelector(".cascade-breadcrumbs")?.remove();
		if (!breadcrumbs || breadcrumbs.length <= 1) return;

		const title = container.querySelector(".page-title");
		if (!title) return;

		const nav = document.createElement("nav");
		nav.classList.add("cascade-breadcrumbs");

		breadcrumbs.forEach((breadcrumb, index) =>
		{
			if (index > 0)
			{
				const separator = document.createElement("span");
				separator.classList.add("cascade-breadcrumb-separator");
				separator.textContent = " → ";
				nav.appendChild(separator);
			}

			const isLast = index == breadcrumbs.length - 1;
			const item = document.createElement(isLast ? "span" : "a");
			item.classList.add("cascade-breadcrumb-item");
			if (breadcrumb.isEntry) item.classList.add("is-cascade-entry");
			if (breadcrumb.isEntry)
			{
				item.innerHTML = HOME_ICON_SVG;
				item.setAttribute("aria-label", "Home");
				item.setAttribute("title", "Home");
			}
			else
			{
				item.textContent = breadcrumb.title;
			}
			if (!isLast)
			{
				item.classList.add("internal-link");
				item.setAttribute("href", breadcrumb.path);
			}
			nav.appendChild(item);
		});

		title.insertAdjacentElement("afterend", nav);
	}
}
