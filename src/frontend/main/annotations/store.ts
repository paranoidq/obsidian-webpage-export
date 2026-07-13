import {
	createLinkedAnnotationsFile,
	downloadAnnotationsFile,
	hasLinkedAnnotationsFile,
	importAnnotationsFromFileInput,
	linkExistingAnnotationsFile,
	tryFetchAnnotations,
	writeLinkedAnnotationsFile,
} from "./persist";
import {
	AnnotationColor,
	AnnotationItem,
	AnnotationKind,
	AnnotationsFile,
	createEmptyAnnotationsFile,
	generateAnnotationId,
} from "./types";

type Listener = () => void;

class AnnotationStoreImpl
{
	private data: AnnotationsFile = createEmptyAnnotationsFile();
	private listeners = new Set<Listener>();

	public get snapshot(): AnnotationsFile
	{
		return this.data;
	}

	public get items(): AnnotationItem[]
	{
		return this.data.items;
	}

	public subscribe(listener: Listener): () => void
	{
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void
	{
		for (const listener of this.listeners)
			listener();
	}

	public async bootstrap(): Promise<void>
	{
		const fetched = await tryFetchAnnotations();
		if (fetched)
		{
			this.data = fetched;
			this.notify();
		}
	}

	public getForPage(pagePath: string): AnnotationItem[]
	{
		return this.data.items.filter((item) => item.pagePath === pagePath);
	}

	public getById(id: string): AnnotationItem | undefined
	{
		return this.data.items.find((item) => item.id === id);
	}

	public async add(partial: {
		pagePath: string;
		kind: AnnotationKind;
		color: AnnotationColor;
		quote: string;
		prefix: string;
		suffix: string;
		body?: string;
	}): Promise<AnnotationItem>
	{
		const now = Date.now();
		const item: AnnotationItem = {
			id: generateAnnotationId(),
			pagePath: partial.pagePath,
			kind: partial.kind,
			color: partial.color,
			quote: partial.quote,
			prefix: partial.prefix,
			suffix: partial.suffix,
			body: partial.body ?? "",
			createdAt: now,
			updatedAt: now,
		};
		this.data.items.push(item);
		this.data.updatedAt = now;
		this.notify();
		await this.persist();
		return item;
	}

	public async update(id: string, patch: Partial<Pick<AnnotationItem, "color" | "body" | "kind">>): Promise<AnnotationItem | undefined>
	{
		const item = this.getById(id);
		if (!item) return;

		if (patch.color !== undefined) item.color = patch.color;
		if (patch.body !== undefined) item.body = patch.body;
		if (patch.kind !== undefined) item.kind = patch.kind;
		item.updatedAt = Date.now();
		this.data.updatedAt = item.updatedAt;
		this.notify();
		await this.persist();
		return item;
	}

	public async remove(id: string): Promise<boolean>
	{
		const index = this.data.items.findIndex((item) => item.id === id);
		if (index < 0) return false;
		this.data.items.splice(index, 1);
		this.data.updatedAt = Date.now();
		this.notify();
		await this.persist();
		return true;
	}

	public async replaceAll(data: AnnotationsFile): Promise<void>
	{
		this.data = data;
		this.notify();
		await this.persist();
	}

	public async persist(): Promise<void>
	{
		if (hasLinkedAnnotationsFile())
			await writeLinkedAnnotationsFile(this.data);
	}

	public async saveExplicit(): Promise<void>
	{
		if (hasLinkedAnnotationsFile())
		{
			const ok = await writeLinkedAnnotationsFile(this.data);
			if (ok) return;
		}

		if (await createLinkedAnnotationsFile(this.data))
			return;

		downloadAnnotationsFile(this.data);
	}

	public async importExplicit(): Promise<boolean>
	{
		const linked = await linkExistingAnnotationsFile();
		if (linked)
		{
			this.data = linked;
			this.notify();
			return true;
		}

		const imported = await importAnnotationsFromFileInput();
		if (imported)
		{
			this.data = imported;
			this.notify();
			await this.persist();
			return true;
		}

		return false;
	}

	public isLinked(): boolean
	{
		return hasLinkedAnnotationsFile();
	}
}

export const annotationStore = new AnnotationStoreImpl();
