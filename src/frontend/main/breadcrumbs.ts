import { CascadeBreadcrumbItem } from "src/shared/website-data";

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
				separator.textContent = "/";
				nav.appendChild(separator);
			}

			const isLast = index == breadcrumbs.length - 1;
			const item = document.createElement(isLast ? "span" : "a");
			item.classList.add("cascade-breadcrumb-item");
			if (breadcrumb.isEntry) item.classList.add("is-cascade-entry");
			item.textContent = breadcrumb.isEntry ? `★ ${breadcrumb.title}` : breadcrumb.title;
			if (!isLast) item.setAttribute("href", breadcrumb.path);
			nav.appendChild(item);
		});

		title.insertAdjacentElement("afterend", nav);
	}
}
