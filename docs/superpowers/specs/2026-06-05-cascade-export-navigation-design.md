# Cascade Export Navigation Design

## Summary

Improve entry-file cascade exports with a clearer generated site structure and navigation model. The single-page HTML history fix applies to all combined local exports; the `links/` folder layout, entry marker, collapsed links tree, and link-hierarchy breadcrumb apply only to entry-file cascade exports.

Normal file, folder, and vault exports keep their existing file layout and file tree behavior.

## Goals

- Support browser back and forward in single-page HTML exports when users navigate between internal links.
- Keep the cascade entry file at the export root, while placing all linked HTML pages under a `links/` folder.
- Make the left file tree show the entry file as special and keep the `links` subtree collapsed by default.
- Add a breadcrumb-like navigation under the title that reflects the first discovered link path from the entry file to the current page.

## Export Structure

Entry-file cascade export creates a cascade context that records the entry file, discovered files, and graph relationships.

Output paths:

- Entry file: exported at the destination root, e.g. `Entry.md` -> `Entry.html`.
- Linked HTML pages: exported below `links/` using their vault-relative paths, e.g. `A/Page.md` -> `links/A/Page.html`.
- Attachments and media: continue using existing attachment/resource export behavior and do not move into `links/`.

Existing slugify behavior still applies to output path segments.

## File Tree Behavior

For entry-file cascade exports, the file tree should show:

```text
★ Entry
▸ links
  ▸ A
    Page
  ▸ B
    ▸ Sub
      Note
```

- The entry file is marked with a special entry icon, such as `lucide//star`.
- The `links` folder is collapsed by default.
- The `links` folder should not auto-expand just because the current page is inside it.
- Non-cascade exports keep the existing file tree behavior.

## Single-Page HTML Browser History

For combined single-page HTML exports, internal document navigation should integrate with the browser history API.

- Internal link clicks call `history.pushState(...)` before loading the target document.
- Browser back and forward are handled with `window.popstate`, loading the target document without pushing another history entry.
- Hash navigation keeps existing scroll behavior.
- External URLs, `mailto:`, and `data:` links are not handled by this mechanism.
- Multi-file exports keep browser-native navigation.

## Link-Hierarchy Breadcrumb

Entry-file cascade exports add a breadcrumb under the page title and above the body content.

The breadcrumb is based on link traversal, not Obsidian folder structure:

```text
★ Entry / Chapter / Current Page
```

Resolver behavior:

- Traverse links from the entry file with BFS.
- When a file is first discovered, record its parent, depth, and breadcrumb path.
- If the same file is found through another path later, keep the first discovered parent.
- Cycles do not change existing parent relationships.

Example:

```text
Entry -> A -> B -> A
```

Breadcrumbs:

```text
A: Entry / A
B: Entry / A / B
```

Backlinks continue to represent reverse link relationships. Breadcrumbs only represent the entry-to-current discovery path.

## Implementation Shape

- Replace the current cascade resolver's file-list-only result with a `CascadeExportContext`.
- The context should include:
  - entry source path
  - discovered files in BFS order
  - source path to cascade node metadata
  - parent source path
  - depth
  - breadcrumb source path chain
  - entry marker
- Pass the context through cascade export into website/webpage generation.
- Use the context to map cascade page target paths and generate breadcrumb metadata.
- Add website data fields needed by the frontend breadcrumb renderer without changing normal export semantics.
- Add frontend history support for combined single-page HTML document navigation.

## Testing

- Build/type-check with `npm run build`.
- Verify combined single-page HTML supports browser back and forward between internal pages.
- Verify multi-file online/raw exports are not changed by the single-page history logic.
- Verify cascade entry page exports at root.
- Verify linked cascade pages export under `links/` with vault-relative structure.
- Verify attachments are not moved into `links/`.
- Verify left file tree marks the entry file and keeps `links` collapsed.
- Verify breadcrumbs for direct links, nested links, multiple paths, and cycles.
- Verify normal non-cascade exports preserve existing paths, file tree behavior, and no breadcrumb appears.

## Assumptions

- The `links/` folder layout applies only to entry-file cascade exports.
- Breadcrumbs use the first discovered BFS path and do not try to show every possible path.
- Dynamic links that are not present in Obsidian metadata remain out of scope.
- The local development `manifest.json` id/name change is not part of this design.
