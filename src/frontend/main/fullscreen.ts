const ENTER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon sidebar-fullscreen-enter-icon"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>`;

const EXIT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon sidebar-fullscreen-exit-icon"><path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path></svg>`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1;

let pageZoom = DEFAULT_ZOOM;
let zoomControlsEl: HTMLElement | null = null;
let zoomLabelEl: HTMLElement | null = null;
let fullscreenButton: HTMLElement | null = null;

function canUseFullscreen(): boolean
{
	const el = document.documentElement as HTMLElement & {
		webkitRequestFullscreen?: () => Promise<void> | void;
	};
	return typeof el.requestFullscreen === "function"
		|| typeof el.webkitRequestFullscreen === "function";
}

function isFullscreen(): boolean
{
	const doc = document as Document & { webkitFullscreenElement?: Element | null };
	return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}

async function enterFullscreen(): Promise<void>
{
	const el = document.documentElement as HTMLElement & {
		webkitRequestFullscreen?: () => Promise<void> | void;
	};
	if (el.requestFullscreen)
		await el.requestFullscreen();
	else if (el.webkitRequestFullscreen)
		await el.webkitRequestFullscreen();
}

async function exitFullscreen(): Promise<void>
{
	const doc = document as Document & {
		webkitExitFullscreen?: () => Promise<void> | void;
	};
	if (document.exitFullscreen)
		await document.exitFullscreen();
	else if (doc.webkitExitFullscreen)
		await doc.webkitExitFullscreen();
}

function clampZoom(value: number): number
{
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function getZoomTarget(): HTMLElement | null
{
	return document.querySelector("#center-content") as HTMLElement | null;
}

function applyPageZoom(): void
{
	const target = getZoomTarget();
	if (!target) return;

	document.documentElement.style.setProperty("--export-page-zoom", String(pageZoom));

	// Zoom only the article pane so left/right sidebars stay at 100%.
	const supportsZoom = "zoom" in target.style;
	if (supportsZoom)
	{
		(target.style as CSSStyleDeclaration & { zoom: string }).zoom = String(pageZoom);
		target.style.removeProperty("transform");
		target.style.removeProperty("transform-origin");
		target.style.removeProperty("width");
		target.style.removeProperty("height");
	}
	else
	{
		target.style.removeProperty("zoom");
		target.style.transformOrigin = "top center";
		target.style.transform = `scale(${pageZoom})`;
		target.style.width = `${100 / pageZoom}%`;
	}

	if (zoomLabelEl)
		zoomLabelEl.textContent = `${Math.round(pageZoom * 100)}%`;
}

function setPageZoom(value: number): void
{
	pageZoom = clampZoom(value);
	applyPageZoom();
}

function resetPageZoom(): void
{
	pageZoom = DEFAULT_ZOOM;
	document.documentElement.style.removeProperty("--export-page-zoom");
	document.documentElement.style.removeProperty("zoom");

	const target = getZoomTarget();
	if (target)
	{
		target.style.removeProperty("zoom");
		target.style.removeProperty("transform");
		target.style.removeProperty("transform-origin");
		target.style.removeProperty("width");
		target.style.removeProperty("height");
	}

	if (zoomLabelEl)
		zoomLabelEl.textContent = "100%";
}

function ensureZoomControls(): HTMLElement
{
	if (zoomControlsEl) return zoomControlsEl;

	const controls = document.createElement("div");
	controls.className = "fullscreen-zoom-controls";
	controls.setAttribute("role", "group");
	controls.setAttribute("aria-label", "Zoom");

	const zoomOut = document.createElement("button");
	zoomOut.type = "button";
	zoomOut.className = "clickable-icon fullscreen-zoom-out";
	zoomOut.title = "Zoom out";
	zoomOut.setAttribute("aria-label", "Zoom out");
	zoomOut.textContent = "−";

	const label = document.createElement("button");
	label.type = "button";
	label.className = "fullscreen-zoom-label";
	label.title = "Reset zoom";
	label.setAttribute("aria-label", "Reset zoom");
	label.textContent = "100%";

	const zoomIn = document.createElement("button");
	zoomIn.type = "button";
	zoomIn.className = "clickable-icon fullscreen-zoom-in";
	zoomIn.title = "Zoom in";
	zoomIn.setAttribute("aria-label", "Zoom in");
	zoomIn.textContent = "+";

	zoomOut.addEventListener("click", (event) =>
	{
		event.preventDefault();
		event.stopPropagation();
		setPageZoom(pageZoom - ZOOM_STEP);
	});

	label.addEventListener("click", (event) =>
	{
		event.preventDefault();
		event.stopPropagation();
		setPageZoom(DEFAULT_ZOOM);
	});

	zoomIn.addEventListener("click", (event) =>
	{
		event.preventDefault();
		event.stopPropagation();
		setPageZoom(pageZoom + ZOOM_STEP);
	});

	controls.append(zoomOut, label, zoomIn);
	document.body.appendChild(controls);

	zoomControlsEl = controls;
	zoomLabelEl = label;
	return controls;
}

function syncFullscreenUi(button: HTMLElement): void
{
	const active = isFullscreen();
	button.classList.toggle("is-fullscreen", active);
	button.innerHTML = active ? EXIT_ICON : ENTER_ICON;
	const label = active ? "Exit fullscreen" : "Fullscreen";
	button.setAttribute("title", label);
	button.setAttribute("aria-label", label);

	document.documentElement.classList.toggle("is-export-fullscreen", active);

	const controls = ensureZoomControls();
	controls.classList.toggle("is-visible", active);

	if (active)
		applyPageZoom();
	else
		resetPageZoom();
}

function onWheelZoom(event: WheelEvent): void
{
	if (!isFullscreen()) return;
	if (!(event.ctrlKey || event.metaKey)) return;

	event.preventDefault();
	const direction = event.deltaY > 0 ? -1 : 1;
	setPageZoom(pageZoom + direction * ZOOM_STEP);
}

function onKeyboardZoom(event: KeyboardEvent): void
{
	if (!isFullscreen()) return;
	if (!(event.ctrlKey || event.metaKey)) return;

	const key = event.key;
	if (key === "+" || key === "=")
	{
		event.preventDefault();
		setPageZoom(pageZoom + ZOOM_STEP);
	}
	else if (key === "-" || key === "_")
	{
		event.preventDefault();
		setPageZoom(pageZoom - ZOOM_STEP);
	}
	else if (key === "0")
	{
		event.preventDefault();
		setPageZoom(DEFAULT_ZOOM);
	}
}

/**
 * Left-sidebar fullscreen control with in-fullscreen page zoom.
 * Esc exits via the browser Fullscreen API.
 */
export function initFullscreenControl(): void
{
	const button = document.querySelector(".sidebar-fullscreen-icon") as HTMLElement | null;
	if (!button) return;

	if (!canUseFullscreen())
	{
		button.remove();
		return;
	}

	fullscreenButton = button;
	syncFullscreenUi(button);

	button.addEventListener("click", async (event) =>
	{
		event.preventDefault();
		event.stopPropagation();

		try
		{
			if (isFullscreen())
				await exitFullscreen();
			else
				await enterFullscreen();
		}
		catch (error)
		{
			console.warn("Fullscreen request failed", error);
		}
	});

	const onFullscreenChange = () =>
	{
		if (fullscreenButton) syncFullscreenUi(fullscreenButton);
	};

	document.addEventListener("fullscreenchange", onFullscreenChange);
	document.addEventListener("webkitfullscreenchange", onFullscreenChange);
	document.addEventListener("wheel", onWheelZoom, { passive: false });
	document.addEventListener("keydown", onKeyboardZoom);
}
