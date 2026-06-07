# Cascade Resource Export Design

## Summary

Entry-file cascade exports should include linked non-page files as downloadable/openable resources instead of rendering them as generated webpage documents. This keeps cascade note pages in the existing page flow while preserving linked files such as PDFs, Word documents, ZIP archives, and original HTML files as real files on disk.

The change applies only to the entry-file cascade export flow. Normal file, folder, and vault exports keep their current behavior.

## Goals

- Export linked non-page files from cascade exports into a top-level `resources/` directory.
- Preserve the source vault-relative folder structure below `resources/`.
- Keep generated cascade pages under the existing page layout:
  - Entry page at the export root.
  - Linked pages under `links/`.
- Update rendered links so clicking a resource points to the copied real file.
- Let browser and operating-system behavior decide how each resource opens.
- Preserve original `.html` and `.htm` resource filenames inside `resources/`.

## Non-Goals

- Do not change normal non-cascade export behavior.
- Do not create preview pages for resource files.
- Do not add resources to cascade breadcrumbs.
- Do not recursively inspect links inside resource files.
- Do not force browser behavior for specific file types.

## File Classification

Cascade export classifies linked vault files into two groups.

Page files:

- Markdown files.
- Canvas files.
- Excalidraw/drawing files.
- Other current note-like formats that the existing pipeline intentionally renders as webpage documents.

Resource files:

- PDF files.
- ZIP and other archive files.
- Word and office documents.
- Raw HTML and HTM files.
- Other linked vault files that should be copied as real files instead of rendered as generated pages.

Images, audio, and video that are already handled as embedded media should continue to work through the existing attachment/media pipeline unless they are explicitly included by the cascade resolver as linked resource files.

## Output Paths

For entry-file cascade exports:

- The entry page remains at the destination root.
- Linked generated pages remain under `links/`, preserving vault-relative paths as already implemented.
- Resource files are copied under `resources/`, preserving vault-relative paths.

Examples:

- `Entry.md` -> `Entry.html`
- `Notes/Sub/Page.md` -> `links/Notes/Sub/Page.html`
- `Files/report.pdf` -> `resources/Files/report.pdf`
- `Files/archive.zip` -> `resources/Files/archive.zip`
- `Web/example.html` -> `resources/Web/example.html`

Raw HTML resources must not be renamed to `*-content.html` in this cascade resource path. The `resources/` namespace prevents conflicts with generated pages.

## Link Behavior

Rendered links to resource files should use the copied resource path. For example, a link from the entry page to `Files/report.pdf` should resolve to `resources/Files/report.pdf`.

In combined single-file HTML exports, the HTML document may still be a single file plus `resources/`. Links to resources should remain normal browser links, not client-side page navigation. This lets:

- PDF files open in the browser or system PDF viewer.
- ZIP files download or open according to browser and OS behavior.
- Word documents open or download according to local environment behavior.
- HTML files open as standalone HTML files.

## Cascade Graph Behavior

Resource files are collected from Obsidian metadata cache links and embeds in the same resolver pass as page files. However:

- Resource files are not traversed for further links.
- Resource files do not receive breadcrumb metadata.
- Resource files do not appear as generated webpage data.
- Page-to-resource edges are still available for link rewriting and copying.

Cycles among page files remain handled by the existing visited set. Since resources are not traversed, they cannot introduce cascade cycles.

## Architecture

Extend the cascade context so it can represent:

- Page files to render.
- Resource files to copy.
- A source-path to export-target-path mapping for both groups.

The exporter should pass only page files into the generated webpage build pipeline while also giving the website/index layer enough cascade context to rewrite links to resource targets.

Resource copying should use the existing `Attachment` download path where practical, with a targeted override or constructor path that preserves `.html/.htm` resource filenames under `resources/`.

## Error Handling

- Unresolved links remain ignored, matching the current cascade behavior.
- External URLs, mail links, data URLs, and runtime-generated links remain out of scope.
- Existing whitelist/blacklist file-picker rules still apply before a file becomes either a page or resource.
- If a resource cannot be read or saved, the export should log the failure using the existing export logging path and continue where current attachment saving behavior allows it.

## Testing

Build verification:

- Run the existing build command.
- Run whitespace/diff checks.

Manual verification:

- Entry file links to a PDF. Export contains `resources/<vault-path>.pdf`; clicking the link opens the PDF.
- Entry file links to a ZIP. Export contains `resources/<vault-path>.zip`; clicking follows browser/OS behavior.
- Entry file links to a Word document. Export contains `resources/<vault-path>.docx`; clicking follows browser/OS behavior.
- Entry file links to raw HTML. Export contains `resources/<vault-path>.html` with the original filename; clicking opens that HTML.
- Linked Markdown pages still export under `links/` and remain navigable.
- Resource files do not appear in breadcrumbs.
- Normal non-cascade exports are unchanged.
- Combined single-file HTML export produces one HTML file plus `resources/` and resource links do not use client-side page navigation.

