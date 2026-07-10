# H1 Split Export Design

## Summary

When an entry-file cascade export’s Markdown contains ATX level-1 headings (`# `), split the export into one combined HTML file per H1 section. Each section runs a scoped mini-cascade (only wikilinks under that H1) with a section-local navigation tree. All sections share one `resources/` directory with deduplicated downloads.

When the entry has no level-1 headings, behavior stays identical to today’s single combined HTML named after the entry file.

## Goals

- Detect ATX `# ` headings in the cascade entry Markdown.
- Export one combined HTML per H1, named from the heading text (e.g. `文件1.html`, `文件2.html`).
- Scope each section’s page cascade and left nav to links/structure under that H1 only.
- Ignore content before the first H1.
- Share a single `resources/` folder across all section HTML files (no duplicated resource trees).
- Keep no-H1 exports unchanged.

## Non-Goals

- Setext-style H1 (`===` underlines).
- Cross-section navigation between section HTML files.
- Folder export or non-cascade export changes.
- Turning off `combineAsSingleFile` / multi-file HTTP site mode.
- Deduplicating embedded page HTML across section combine files (only disk `resources/` are deduped).

## Trigger and Fallback

| Entry content | Behavior |
|---------------|----------|
| At least one ATX `# ` heading | H1-split export |
| No ATX `# ` heading | Existing single cascade export (`EntryName.html` + `resources/`) |

Only lines that match ATX level-1 (exactly one `#` followed by space/content) count. `##` and deeper do not trigger split.

## Section Splitting

1. Read the entry file Markdown text.
2. Split on ATX H1 boundaries into ordered sections.
3. Each section starts at its H1 and ends just before the next H1 (or EOF).
4. Discard all content before the first H1; it is not written to any output.
5. Each section retains its H1 line and everything under it (H2+, lists, wikilinks, etc.).

## Output Naming

- Filename stem = H1 text with leading `#` / whitespace stripped.
- Sanitize for the filesystem: remove `/ \ : * ? " < > |` and trim; collapse problematic whitespace as needed.
- Append `.html`.
- Duplicate stems after sanitize: `附录.html`, `附录_1.html`, `附录_2.html`, …
- Empty stem after sanitize: `section.html`, `section_1.html`, …

Example layout:

```text
export-dir/
  文件1.html
  文件2.html
  resources/
    ...
```

## Scoped Cascade (per section)

For each section:

1. Treat the section Markdown as the virtual entry body.
2. Collect outbound links/embeds from that body only (same classification as `CascadeExportResolver`: page vs resource).
3. BFS from those targets with existing cascade rules to build `pageFiles`, `resourceFiles`, and graph nodes.
4. Do not include links that appear only under other H1 sections.
5. If the same note is linked from multiple sections, each section’s combined HTML may embed that page’s HTML in its own metadata; disk `resources/` still store each resource path once.

Virtual entry path/export name:

- Root HTML filename = section output name (`文件1.html`), not the original entry basename (unless no-H1 fallback).
- Linked pages remain logical paths under `links/<vault-relative>.html` inside that section’s combined metadata (not written as separate files on disk, same as today).

## Shared Resources

- All section exports target the same destination directory.
- After each section build (or after all builds), collect cascade resource attachments.
- Deduplicate by vault-relative / target path before `downloadAttachments`.
- Relative links from every section HTML to `resources/...` stay rooted at the shared export directory.

## Navigation and Titles

**CascadeContentTree (per section HTML)**

- Parse only that section’s sliced Markdown.
- Tree root = that section’s entry (H1 title / corresponding HTML).
- Children = headings, list folders, and in-scope page links under that section only.
- No nodes for other H1 sections; no cross-HTML links in the tree.

**Page / document title**

- Split mode: prefer the section H1 text.
- No-H1 mode: keep using the entry file name (current behavior).

## Export Flow

`exportCascadeFromEntry`:

1. Update settings / destination as today.
2. Detect ATX H1s in the entry Markdown.
3. **No H1:** `CascadeExportResolver.collect(entryFile)` → one `Website` build → `saveAsCombinedHTML` → download resources. Unchanged.
4. **Has H1s:**
   - Split into sections; assign unique output filenames.
   - For each section `i` of `N`:
     - Build scoped cascade context from section Markdown + link BFS.
     - `Website.load` / `build` with that context.
     - `saveAsCombinedHTML` writing `sectionTitle.html` at destination root.
     - Accumulate resource download list.
     - Progress: section `i/N`.
   - Deduplicate accumulated resources and download once into `resources/`.
5. Optional open-after-export and success notice once at the end.

## Implementation Touchpoints (expected)

- New helper: H1 split + filename sanitize/dedupe.
- `CascadeExportResolver` (or sibling): collect from section Markdown text / virtual entry, not only whole `TFile` metadata for the entry body.
- `HTMLExporter.exportCascadeFromEntry`: branch split vs single; multi save + resource dedupe.
- `Website.saveAsCombinedHTML` / target path: allow section-named root HTML when in split mode.
- `CascadeContentTree`: accept section Markdown (or equivalent) instead of always reading the full entry file.

Exact APIs may vary during implementation as long as behavior matches this spec.

## Decisions Log

| Topic | Decision |
|-------|----------|
| Approach | Mini-cascade per H1 + shared `resources/` (Approach A) |
| Link scope | Only wikilinks under that H1 (and their BFS) |
| Nav tree | Section-local only |
| Preamble before first H1 | Discard |
| Duplicate H1 titles | Numeric suffix on filenames |
| Heading syntax | ATX `# ` only |

## Open Questions

None for v1; revisit Setext H1 or cross-section nav only if requested later.
