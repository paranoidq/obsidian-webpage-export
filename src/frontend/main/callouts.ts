import { slideDown, slideUp } from "./utils";
import { ImageViewer } from "./image-viewer";

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>`;

export enum CalloutType
{
	StartOpen,
	StartClosed,
	Static
}

export class Callout
{
	public calloutEl: HTMLElement;
	public titleEl: HTMLElement;
	public contentEl: HTMLElement;
	public iconEl: HTMLElement;
	public foldIconEl: HTMLElement;
	public foldType: CalloutType;
	public type: string;
	public metadata: string;
	
	get title(): string { return this.titleEl?.textContent ?? ""; }
	set title(title: string) { this.titleEl.textContent = title; }

	private _collapsed: boolean = false;
	get collapsed(): boolean { return this._collapsed; }
	set collapsed(collapse: boolean) { this.toggle(collapse); }

	constructor(calloutEl: HTMLElement, initEvents: boolean = true)
	{
		this.calloutEl = calloutEl;
		this.titleEl = calloutEl.querySelector(".callout-title-inner") as HTMLElement;
		this.contentEl = calloutEl.querySelector(".callout-content") as HTMLElement;
		this.iconEl = calloutEl.querySelector(".callout-icon") as HTMLElement;
		this.foldIconEl = calloutEl.querySelector(".callout-fold") as HTMLElement;

		const fold = calloutEl.getAttribute("data-callout-fold");
		switch (fold)
		{
			case "+":
				this.foldType = CalloutType.StartOpen;
				this._collapsed = false;
				break;
			case "-":
				this.foldType = CalloutType.StartClosed;
				this._collapsed = true;
				break;
			default:
				this.foldType = CalloutType.Static;
				this._collapsed = false;
				break;
		}

		this.type = calloutEl.getAttribute("data-callout") ?? "";
		this.metadata = calloutEl.getAttribute("data-callout-metadata") ?? "";

		if (initEvents) this.init();
	}

	public toggle(force?: boolean)
	{
		if (this.foldType == CalloutType.Static) return;
		if (force === undefined) force = !this._collapsed;
		this.calloutEl?.classList.toggle("is-collapsed", force);
		this.foldIconEl?.classList.toggle("is-collapsed", force);
		if (force) slideUp(this.contentEl, 150);
		else slideDown(this.contentEl, 150);

		this._collapsed = force;
	}

	public collapse()
	{
		this.toggle(true);
	}

	public expand()
	{
		this.toggle(false);
	}

	public init()
	{
		if (this.foldIconEl)
		{
			this.foldIconEl.addEventListener("click", () =>
			{
				this.toggle();
			});
		}

		this.addExpandButton();
	}

	private addExpandButton()
	{
		if (!ImageViewer.isEnabled()) return;
		if (this.calloutEl.querySelector(":scope > .callout-title > .callout-expand")) return;

		const titleEl = this.calloutEl.querySelector(":scope > .callout-title") as HTMLElement | null;
		if (!titleEl) return;

		const button = document.createElement("button");
		button.className = "callout-expand";
		button.setAttribute("type", "button");
		button.setAttribute("aria-label", "Expand");
		button.setAttribute("title", "Expand");
		button.innerHTML = EXPAND_ICON;
		titleEl.appendChild(button);

		button.addEventListener("click", (event) =>
		{
			event.preventDefault();
			event.stopPropagation();
			ImageViewer.openCallout(this.calloutEl);
		});
	}

}
