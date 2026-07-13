export const ANNOTATIONS_FILENAME = "annotations.json";
export const ANNOTATION_MARK_CLASS = "export-annotation";

export type AnnotationKind = "highlight" | "note";

export type AnnotationColor = "yellow" | "green" | "blue" | "pink" | "purple";

export const ANNOTATION_COLORS: AnnotationColor[] = [
	"yellow",
	"green",
	"blue",
	"pink",
	"purple",
];

export interface AnnotationItem
{
	id: string;
	pagePath: string;
	kind: AnnotationKind;
	color: AnnotationColor;
	quote: string;
	prefix: string;
	suffix: string;
	body?: string;
	createdAt: number;
	updatedAt: number;
}

export interface AnnotationsFile
{
	version: 1;
	updatedAt: number;
	items: AnnotationItem[];
}

export function createEmptyAnnotationsFile(): AnnotationsFile
{
	return {
		version: 1,
		updatedAt: Date.now(),
		items: [],
	};
}

export function generateAnnotationId(): string
{
	if (typeof crypto !== "undefined" && crypto.randomUUID)
		return crypto.randomUUID();
	return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
