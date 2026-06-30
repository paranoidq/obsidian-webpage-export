import { Notice } from "./notifications";

type ViewableSource =
	| { type: "img"; element: HTMLImageElement }
	| { type: "svg"; element: SVGSVGElement };

export class ImageViewer {
	private static instance: ImageViewer | null = null;

	private overlay: HTMLElement | null = null;
	private stage: HTMLElement | null = null;
	private viewEl: HTMLImageElement | SVGSVGElement | null = null;
	private source: ViewableSource | null = null;
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
		".markdown-preview-sizer, .excalidraw-svg, .excalidraw-plugin";

	private static readonly ZOOM_OUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>`;

	private static readonly ZOOM_IN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`;

	private static readonly COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

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

		const svg = target.closest("svg");
		if (svg instanceof SVGSVGElement && this.isEligibleSvg(svg)) {
			return { type: "svg", element: svg };
		}

		return null;
	}

	private isInDocumentContent(element: Element): boolean {
		if (!element.closest(".obsidian-document")) return false;
		if (element.closest(ImageViewer.EXCLUDED_ANCESTORS)) return false;
		return !!element.closest(ImageViewer.CONTENT_SELECTORS);
	}

	private isEligibleImage(img: HTMLImageElement): boolean {
		if (img.classList.contains("emoji")) return false;
		if (!this.isInDocumentContent(img)) return false;
		if (!img.getAttribute("src")) return false;
		return true;
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
				<button type="button" class="image-lightbox-btn image-lightbox-copy" title="Copy" aria-label="Copy">${ImageViewer.COPY_ICON}</button>
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
		this.overlay
			.querySelector(".image-lightbox-copy")
			?.addEventListener("click", (event) => {
				event.stopPropagation();
				void this.copyImage();
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
		this.source = source;
		this.stage.replaceChildren();

		if (source.type === "img") {
			const imageEl = document.createElement("img");
			imageEl.src = source.element.currentSrc || source.element.src;
			imageEl.alt = source.element.alt || "";
			imageEl.className = "image-lightbox-image";
			this.stage.appendChild(imageEl);
			this.viewEl = imageEl;

			const onImageReady = (): void => {
				this.applyTransform();
			};
			if (imageEl.complete) {
				onImageReady();
			} else {
				imageEl.addEventListener("load", onImageReady, { once: true });
			}
		} else {
			const svgEl = source.element.cloneNode(true) as SVGSVGElement;
			svgEl.classList.add("image-lightbox-image", "image-lightbox-svg");
			this.stage.appendChild(svgEl);
			this.viewEl = svgEl;
			this.applyTransform();
		}

		this.overlay.classList.remove("hide");
		document.body.classList.add("image-lightbox-open");

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
			this.stage.classList.remove("is-dragging");
		}

		this.viewEl = null;
		this.source = null;
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

	private fitToViewport(): void {
		if (!this.viewEl) return;

		const previousScale = this.scale;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.applyTransform();

		const baseWidth = this.viewEl.getBoundingClientRect().width;
		const baseHeight = this.viewEl.getBoundingClientRect().height;
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

	private async getImageBlob(src: string): Promise<Blob> {
		if (src.startsWith("data:")) {
			return this.dataUrlToBlob(src);
		}

		const response = await fetch(src);
		if (!response.ok) {
			throw new Error(`Failed to fetch image: ${response.status}`);
		}
		return response.blob();
	}

	private dataUrlToBlob(dataUrl: string): Blob {
		const commaIndex = dataUrl.indexOf(",");
		if (commaIndex === -1) {
			throw new Error("Invalid data URL");
		}

		const header = dataUrl.slice(0, commaIndex);
		const data = dataUrl.slice(commaIndex + 1);
		const mimeMatch = header.match(/^data:([^;,]+)/);
		const mime = mimeMatch?.[1] || "application/octet-stream";
		const isBase64 = header.includes(";base64");

		if (isBase64) {
			const binary = atob(data);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			return new Blob([bytes], { type: mime });
		}

		return new Blob([decodeURIComponent(data)], { type: mime });
	}

	private resolveImageMime(blob: Blob, src: string): string {
		const subtypeMatch = src.match(/^data:[^;,]*\/([^;,]+)/i);
		if (subtypeMatch) {
			const subtype = subtypeMatch[1].toLowerCase();
			const subtypeToMime: Record<string, string> = {
				gif: "image/gif",
				png: "image/png",
				jpeg: "image/jpeg",
				jpg: "image/jpeg",
				webp: "image/webp",
				bmp: "image/bmp",
				svg: "image/svg+xml",
				ico: "image/x-icon",
				avif: "image/avif",
			};
			if (subtypeToMime[subtype]) {
				return subtypeToMime[subtype];
			}
		}

		if (blob.type.startsWith("image/")) {
			return blob.type;
		}

		const extensionMatch = src.match(/\.(gif|png|jpe?g|webp|bmp|svg)(?:[?#]|$)/i);
		if (extensionMatch) {
			const ext = extensionMatch[1].toLowerCase();
			if (ext === "jpg") return "image/jpeg";
			if (ext === "svg") return "image/svg+xml";
			return `image/${ext}`;
		}

		return "image/png";
	}

	private async svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
		const svgString = new XMLSerializer().serializeToString(svg);
		const svgUrl =
			"data:image/svg+xml;charset=utf-8," +
			encodeURIComponent(svgString);
		const image = new Image();
		image.decoding = "async";

		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Failed to render SVG"));
			image.src = svgUrl;
		});

		const viewBox = svg.viewBox.baseVal;
		const width =
			Number(svg.getAttribute("width")) ||
			viewBox.width ||
			image.naturalWidth ||
			800;
		const height =
			Number(svg.getAttribute("height")) ||
			viewBox.height ||
			image.naturalHeight ||
			600;

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Canvas unavailable");
		}
		context.drawImage(image, 0, 0, width, height);

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/png")
		);
		if (!blob) {
			throw new Error("Failed to encode PNG");
		}
		return blob;
	}

	private async copyImage(): Promise<void> {
		if (!this.source) return;

		try {
			if (this.source.type === "svg") {
				const svgBlob = new Blob(
					[
						new XMLSerializer().serializeToString(
							this.source.element
						),
					],
					{ type: "image/svg+xml" }
				);

				if (navigator.clipboard?.write) {
					try {
						await navigator.clipboard.write([
							new ClipboardItem({ "image/svg+xml": svgBlob }),
						]);
						new Notice("Image copied to clipboard.");
						return;
					} catch {
						const pngBlob = await this.svgToPngBlob(
							this.source.element
						);
						await navigator.clipboard.write([
							new ClipboardItem({ "image/png": pngBlob }),
						]);
						new Notice("Image copied to clipboard.");
						return;
					}
				}
			}

			const src =
				this.source.type === "img"
					? this.source.element.currentSrc || this.source.element.src
					: "";

			if (!src) {
				throw new Error("Missing image source");
			}

			const blob = await this.getImageBlob(src);
			const mime = this.resolveImageMime(blob, src);
			const imageBlob =
				blob.type === mime
					? blob
					: new Blob([await blob.arrayBuffer()], { type: mime });

			if (!navigator.clipboard?.write) {
				throw new Error("Clipboard API unavailable");
			}

			const clipboardItem = new ClipboardItem({ [mime]: imageBlob });
			await navigator.clipboard.write([clipboardItem]);
			new Notice("Image copied to clipboard.");
		} catch {
			if (this.source?.type === "img") {
				const src =
					this.source.element.currentSrc || this.source.element.src;
				if (!src.startsWith("data:")) {
					try {
						await navigator.clipboard.writeText(src);
						new Notice("Image URL copied to clipboard.");
						return;
					} catch {
						// fall through
					}
				}
			}

			new Notice("Failed to copy image.");
		}
	}
}
