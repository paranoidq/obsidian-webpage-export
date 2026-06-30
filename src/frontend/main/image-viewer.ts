import { Notice } from "./notifications";

export class ImageViewer {
	private static instance: ImageViewer | null = null;

	private overlay: HTMLElement | null = null;
	private stage: HTMLElement | null = null;
	private imageEl: HTMLImageElement | null = null;
	private scale = 1;
	private readonly minScale = 0.1;
	private readonly maxScale = 5;
	private readonly zoomStep = 0.15;

	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private wheelHandler: ((event: WheelEvent) => void) | null = null;
	private attachedRoots = new WeakSet<HTMLElement>();

	private static readonly EXCLUDED_ANCESTORS =
		"#navbar, #left-sidebar, #right-sidebar, #file-explorer, #outline, .graph-view-wrapper, .canvas-wrapper, .graph-view-container, #webpage-icon";

	private static readonly ZOOM_OUT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>`;

	private static readonly ZOOM_IN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`;

	private static readonly COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

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

		const img = target.closest("img");
		if (!img || !this.isEligibleImage(img)) return;

		event.preventDefault();
		event.stopPropagation();
		this.open(img);
	};

	private isEligibleImage(img: HTMLImageElement): boolean {
		if (img.classList.contains("emoji")) return false;
		if (!img.closest(".markdown-preview-sizer")) return false;
		if (img.closest(ImageViewer.EXCLUDED_ANCESTORS)) return false;
		if (!img.getAttribute("src")) return false;
		return true;
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
			.querySelector(".image-lightbox-copy")
			?.addEventListener("click", (event) => {
				event.stopPropagation();
				void this.copyImage();
			});

		this.stage?.addEventListener("click", (event) => event.stopPropagation());
		this.overlay
			.querySelector(".image-lightbox-toolbar")
			?.addEventListener("click", (event) => event.stopPropagation());

		this.overlay.addEventListener("click", () => this.close());
	}

	public open(img: HTMLImageElement): void {
		this.ensureOverlay();
		if (!this.overlay || !this.stage) return;

		this.scale = 1;
		this.stage.replaceChildren();

		this.imageEl = document.createElement("img");
		this.imageEl.src = img.currentSrc || img.src;
		this.imageEl.alt = img.alt || "";
		this.imageEl.className = "image-lightbox-image";
		this.stage.appendChild(this.imageEl);

		const onImageReady = (): void => {
			this.applyScale();
		};
		if (this.imageEl.complete) {
			onImageReady();
		} else {
			this.imageEl.addEventListener("load", onImageReady, { once: true });
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
		}

		this.imageEl = null;
		this.scale = 1;
	}

	private adjustScale(delta: number): void {
		this.scale = Math.max(
			this.minScale,
			Math.min(this.maxScale, this.scale + delta * this.scale)
		);
		this.applyScale();
	}

	private applyScale(): void {
		if (!this.stage) return;
		this.stage.style.transform = `translate(-50%, -50%) scale(${this.scale})`;
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

	private async copyImage(): Promise<void> {
		if (!this.imageEl?.src) return;

		const src = this.imageEl.src;

		try {
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
			if (!src.startsWith("data:")) {
				try {
					await navigator.clipboard.writeText(src);
					new Notice("Image URL copied to clipboard.");
					return;
				} catch {
					// fall through
				}
			}

			new Notice("Failed to copy image.");
		}
	}
}
