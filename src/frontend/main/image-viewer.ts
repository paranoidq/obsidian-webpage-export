type ViewableSource =
	| { type: "img"; element: HTMLImageElement }
	| { type: "svg"; element: SVGSVGElement }
	| { type: "code"; element: HTMLElement };

export class ImageViewer {
	private static instance: ImageViewer | null = null;

	private overlay: HTMLElement | null = null;
	private stage: HTMLElement | null = null;
	private viewEl: Element | null = null;
	private scale = 1;
	private panX = 0;
	private panY = 0;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private dragStartPanX = 0;
	private dragStartPanY = 0;
	private readonly minScale = 0.1;
	private readonly maxScale = 5;
	private readonly zoomStep = 0.15;

	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private wheelHandler: ((event: WheelEvent) => void) | null = null;
	private attachedRoots = new WeakSet<HTMLElement>();

	private static readonly EXCLUDED_ANCESTORS =
		"#navbar, #left-sidebar, #right-sidebar, #file-explorer, #outline, .graph-view-wrapper, .canvas-wrapper, .graph-view-container, #webpage-icon";

	private static readonly CONTENT_SELECTORS =
		".markdown-preview-sizer, .internal-embed, .markdown-embed, .media-embed, .excalidraw-svg, .excalidraw-plugin, .mermaid, .block-language-mermaid";

	private static readonly ZOOM_OUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>`;

	private static readonly ZOOM_IN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`;

	private static readonly FIT_VIEWPORT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;

	private static readonly VIEWPORT_FIT_RATIO = 0.9;

	public static isEnabled(): boolean {
		const meta = ObsidianSite.metadata;
		if (meta?.ignoreMetadata) return false;
		return (
			meta?.isCascadeExport === true &&
			meta?.combineAsSingleFile === true
		);
	}

	public static attach(root: HTMLElement): void {
		if (!ImageViewer.isEnabled()) return;

		const viewer = ImageViewer.getInstance();
		if (viewer.attachedRoots.has(root)) return;

		root.classList.add("image-viewer-enabled");
		root.addEventListener("click", viewer.onRootClick);
		viewer.attachedRoots.add(root);
	}

	/** Open a code block (`<pre>`) in the same lightbox used for images. */
	public static openCode(preEl: HTMLElement): void {
		if (!ImageViewer.isEnabled()) return;
		ImageViewer.getInstance().open({ type: "code", element: preEl });
	}

	private static getInstance(): ImageViewer {
		if (!ImageViewer.instance) {
			ImageViewer.instance = new ImageViewer();
		}
		return ImageViewer.instance;
	}

	private onRootClick = (event: MouseEvent): void => {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const viewable = this.findViewableSource(target);
		if (!viewable) return;

		event.preventDefault();
		event.stopPropagation();
		this.open(viewable);
	};

	private findViewableSource(target: Element): ViewableSource | null {
		const img = target.closest("img");
		if (img instanceof HTMLImageElement && this.isEligibleImage(img)) {
			return { type: "img", element: img };
		}

		const embedImg = this.findEmbedImage(target);
		if (embedImg) {
			return { type: "img", element: embedImg };
		}

		const mermaidSvg = this.findMermaidSvg(target);
		if (mermaidSvg) {
			return { type: "svg", element: mermaidSvg };
		}

		const svg = target.closest("svg");
		if (svg instanceof SVGSVGElement && this.isEligibleSvg(svg)) {
			return { type: "svg", element: svg };
		}

		return null;
	}

	private findEmbedImage(target: Element): HTMLImageElement | null {
		const container = target.closest(".internal-embed, .markdown-embed, .media-embed, .excalidraw-svg, .excalidraw-plugin");
		if (!container || !this.isInDocumentContent(container)) return null;

		const img = container.querySelector("img");
		return img instanceof HTMLImageElement && this.isEligibleImage(img) ? img : null;
	}

	private isInDocumentContent(element: Element): boolean {
		if (!element.closest(".obsidian-document")) return false;
		if (element.closest(ImageViewer.EXCLUDED_ANCESTORS)) return false;
		return !!element.closest(ImageViewer.CONTENT_SELECTORS);
	}

	private isEligibleImage(img: HTMLImageElement): boolean {
		if (img.classList.contains("emoji")) return false;
		if (img.classList.contains("is-broken-image")) return false;
		if (!this.isInDocumentContent(img)) return false;
		if (!img.getAttribute("src")) return false;
		return true;
	}

	private findMermaidSvg(target: Element): SVGSVGElement | null {
		const container = target.closest(".mermaid, .block-language-mermaid");
		if (!container || !this.isInDocumentContent(container)) return null;

		const svg = container.querySelector("svg");
		return svg instanceof SVGSVGElement ? svg : null;
	}

	private isEligibleSvg(svg: SVGSVGElement): boolean {
		if (!this.isInDocumentContent(svg)) return false;

		const container = svg.closest(".excalidraw-svg, .excalidraw-plugin");
		if (!container) return false;

		const primarySvg =
			container.tagName === "svg"
				? container
				: container.querySelector(":scope > svg");

		return primarySvg === svg;
	}

	private ensureOverlay(): void {
		if (this.overlay) return;

		this.overlay = document.createElement("div");
		this.overlay.className = "image-lightbox hide";
		this.overlay.innerHTML = `
			<div class="image-lightbox-canvas">
				<div class="image-lightbox-stage"></div>
			</div>
			<div class="image-lightbox-toolbar">
				<button type="button" class="image-lightbox-btn image-lightbox-zoom-out" title="Zoom out" aria-label="Zoom out">${ImageViewer.ZOOM_OUT_ICON}</button>
				<button type="button" class="image-lightbox-btn image-lightbox-zoom-in" title="Zoom in" aria-label="Zoom in">${ImageViewer.ZOOM_IN_ICON}</button>
				<button type="button" class="image-lightbox-btn image-lightbox-fit-viewport" title="Fit to 90% of window" aria-label="Fit to 90% of window">${ImageViewer.FIT_VIEWPORT_ICON}</button>
			</div>
		`;
		document.body.appendChild(this.overlay);

		this.stage = this.overlay.querySelector(
			".image-lightbox-stage"
		) as HTMLElement;

		this.overlay
			.querySelector(".image-lightbox-zoom-out")
			?.addEventListener("click", (event) => {
				event.stopPropagation();
				this.adjustScale(-this.zoomStep);
			});
		this.overlay
			.querySelector(".image-lightbox-zoom-in")
			?.addEventListener("click", (event) => {
				event.stopPropagation();
				this.adjustScale(this.zoomStep);
			});
		this.overlay
			.querySelector(".image-lightbox-fit-viewport")
			?.addEventListener("click", (event) => {
				event.stopPropagation();
				this.fitToViewport();
			});

		this.stage?.addEventListener("click", (event) => event.stopPropagation());
		this.setupDragHandlers();
		this.overlay
			.querySelector(".image-lightbox-toolbar")
			?.addEventListener("click", (event) => event.stopPropagation());

		this.overlay.addEventListener("click", () => this.close());
	}

	private setupDragHandlers(): void {
		if (!this.stage) return;

		this.stage.addEventListener("pointerdown", (event: PointerEvent) => {
			if (event.button !== 0 || !this.viewEl) return;

			event.preventDefault();
			event.stopPropagation();

			this.isDragging = true;
			this.stage?.classList.add("is-dragging");
			this.dragStartX = event.clientX;
			this.dragStartY = event.clientY;
			this.dragStartPanX = this.panX;
			this.dragStartPanY = this.panY;
			this.stage?.setPointerCapture(event.pointerId);
		});

		this.stage.addEventListener("pointermove", (event: PointerEvent) => {
			if (!this.isDragging) return;

			this.panX = this.dragStartPanX + (event.clientX - this.dragStartX);
			this.panY = this.dragStartPanY + (event.clientY - this.dragStartY);
			this.applyTransform();
		});

		const endDrag = (event: PointerEvent): void => {
			if (!this.isDragging) return;

			this.isDragging = false;
			this.stage?.classList.remove("is-dragging");
			if (this.stage?.hasPointerCapture(event.pointerId)) {
				this.stage.releasePointerCapture(event.pointerId);
			}
		};

		this.stage.addEventListener("pointerup", endDrag);
		this.stage.addEventListener("pointercancel", endDrag);
	}

	public open(source: ViewableSource): void {
		this.ensureOverlay();
		if (!this.overlay || !this.stage) return;

		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.stage.replaceChildren();
		this.stage.classList.toggle("is-code", source.type === "code");

		if (source.type === "img") {
			const imageEl = source.element.cloneNode(true) as HTMLImageElement;
			imageEl.src = source.element.currentSrc || source.element.src;
			imageEl.alt = source.element.alt || "";
			imageEl.classList.add("image-lightbox-image");
			imageEl.removeAttribute("width");
			imageEl.removeAttribute("height");
			imageEl.style.width = "";
			imageEl.style.height = "";
			this.stage.appendChild(imageEl);
			this.viewEl = imageEl;
		} else if (source.type === "svg") {
			const svgEl = source.element.cloneNode(true) as SVGSVGElement;
			svgEl.classList.add("image-lightbox-image", "image-lightbox-svg");
			this.stage.appendChild(svgEl);
			this.viewEl = svgEl;
		} else {
			const codeEl = source.element.cloneNode(true) as HTMLElement;
			codeEl.classList.add("image-lightbox-image", "image-lightbox-code");
			codeEl.style.display = "";
			codeEl.style.height = "";
			codeEl.style.maxHeight = "";
			codeEl.style.overflow = "";
			codeEl.querySelectorAll("button.copy-code-button").forEach((el) => el.remove());
			this.stage.appendChild(codeEl);
			this.viewEl = codeEl;
		}

		// Show overlay before measuring so getBoundingClientRect is valid
		this.overlay.classList.remove("hide");
		document.body.classList.add("image-lightbox-open");

		const fitWhenReady = (): void => {
			this.fitToViewport();
		};

		if (source.type === "img" && this.viewEl instanceof HTMLImageElement) {
			const imageEl = this.viewEl;
			if (imageEl.complete && imageEl.naturalWidth > 0) {
				fitWhenReady();
			} else {
				imageEl.addEventListener("load", fitWhenReady, { once: true });
			}
		} else {
			// SVG / code: layout after paint
			requestAnimationFrame(fitWhenReady);
		}

		this.keydownHandler = (event: KeyboardEvent) => {
			if (event.key === "Escape") this.close();
		};
		document.addEventListener("keydown", this.keydownHandler);

		this.wheelHandler = (event: WheelEvent) => {
			event.preventDefault();
			const delta = event.deltaY < 0 ? this.zoomStep : -this.zoomStep;
			this.adjustScale(delta);
		};
		this.overlay.addEventListener("wheel", this.wheelHandler, {
			passive: false,
		});
	}

	public close(): void {
		if (!this.overlay) return;

		this.overlay.classList.add("hide");
		document.body.classList.remove("image-lightbox-open");

		if (this.keydownHandler) {
			document.removeEventListener("keydown", this.keydownHandler);
			this.keydownHandler = null;
		}

		if (this.wheelHandler) {
			this.overlay.removeEventListener("wheel", this.wheelHandler);
			this.wheelHandler = null;
		}

		if (this.stage) {
			this.stage.style.transform = "";
			this.stage.classList.remove("is-dragging", "is-code");
		}

		this.viewEl = null;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.isDragging = false;
	}

	private adjustScale(delta: number): void {
		this.scale = Math.max(
			this.minScale,
			Math.min(this.maxScale, this.scale + delta * this.scale)
		);
		this.applyTransform();
	}

	/**
	 * Scale content to at most 90% of the viewport on both axes while
	 * preserving aspect ratio (uniform scale transform).
	 */
	private fitToViewport(): void {
		if (!this.viewEl) return;

		const previousScale = this.scale;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.applyTransform();

		let baseWidth = 0;
		let baseHeight = 0;

		if (this.viewEl instanceof HTMLImageElement) {
			baseWidth = this.viewEl.naturalWidth || this.viewEl.getBoundingClientRect().width;
			baseHeight = this.viewEl.naturalHeight || this.viewEl.getBoundingClientRect().height;
		} else {
			const rect = this.viewEl.getBoundingClientRect();
			baseWidth = rect.width;
			baseHeight = rect.height;
		}

		if (baseWidth <= 0 || baseHeight <= 0) {
			this.scale = previousScale;
			this.applyTransform();
			return;
		}

		const maxWidth = window.innerWidth * ImageViewer.VIEWPORT_FIT_RATIO;
		const maxHeight = window.innerHeight * ImageViewer.VIEWPORT_FIT_RATIO;
		const fitScale = Math.min(maxWidth / baseWidth, maxHeight / baseHeight);

		this.scale = Math.max(
			this.minScale,
			Math.min(this.maxScale, fitScale)
		);
		this.applyTransform();
	}

	private applyTransform(): void {
		if (!this.stage) return;
		this.stage.style.transform = `translate(calc(-50% + ${this.panX}px), calc(-50% + ${this.panY}px)) scale(${this.scale})`;
	}
}
