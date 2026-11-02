import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFObject, PDFRef, PDFString } from "pdf-lib";
import type { PdfOutlineNode } from "./pdf-print-view";

/** Write only the entry tree, not a browser-generated outline of every heading. */
export async function addEntryPdfOutline(bytes: Uint8Array, outline: PdfOutlineNode[]): Promise<Uint8Array>
{
	const doc = await PDFDocument.load(bytes);
	const destinations = new Map<string, PDFObject>();
	const oldDests = doc.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
	if (oldDests) for (const [key, value] of oldDests.entries()) destinations.set(key.decodeText(), value);
	const readNames = (tree: PDFDict): void =>
	{
		const names = tree.lookupMaybe(PDFName.of("Names"), PDFArray);
		if (names) for (let i = 0; i + 1 < names.size(); i += 2)
		{
			const key = names.lookup(i);
			if (key instanceof PDFString || key instanceof PDFHexString) destinations.set(key.decodeText(), names.get(i + 1));
		}
		const kids = tree.lookupMaybe(PDFName.of("Kids"), PDFArray);
		if (kids) for (let i = 0; i < kids.size(); i++) readNames(kids.lookup(i, PDFDict));
	};
	const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict)?.lookupMaybe(PDFName.of("Dests"), PDFDict);
	if (names) readNames(names);
	const destinationFor = (target: string): PDFObject =>
	{
		const raw = destinations.get(target);
		const resolved = raw ? doc.context.lookup(raw) : undefined;
		if (resolved instanceof PDFArray) return resolved;
		if (resolved instanceof PDFDict)
		{
			const value = resolved.get(PDFName.of("D"));
			if (value) return value;
		}
		throw new Error(`PDF link destination missing for entry item: ${target}`);
	};
	doc.catalog.delete(PDFName.of("Outlines"));
	if (!outline.length) return doc.save();
	const root = doc.context.obj({ Type: "Outlines" });
	const rootRef = doc.context.register(root);
	const writeLevel = (nodes: PdfOutlineNode[], parent: PDFDict, parentRef: PDFRef): number =>
	{
		const entries = nodes.map((node) =>
		{
			const dict = doc.context.obj({ Title: PDFHexString.fromText(node.title), Parent: parentRef, Dest: destinationFor(node.target) });
			return { node, dict, ref: doc.context.register(dict) };
		});
		let count = entries.length;
		entries.forEach(({ node, dict, ref }, index) =>
		{
			if (index) dict.set(PDFName.of("Prev"), entries[index - 1].ref);
			if (index + 1 < entries.length) dict.set(PDFName.of("Next"), entries[index + 1].ref);
			const children = writeLevel(node.children, dict, ref);
			if (children) dict.set(PDFName.of("Count"), doc.context.obj(children));
			count += children;
		});
		if (entries.length)
		{
			parent.set(PDFName.of("First"), entries[0].ref);
			parent.set(PDFName.of("Last"), entries[entries.length - 1].ref);
		}
		return count;
	};
	root.set(PDFName.of("Count"), doc.context.obj(writeLevel(outline, root, rootRef)));
	doc.catalog.set(PDFName.of("Outlines"), rootRef);
	doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
	return doc.save();
}
