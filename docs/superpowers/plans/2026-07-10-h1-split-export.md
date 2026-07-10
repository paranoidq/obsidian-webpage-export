# H1 Split Export Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Split cascade entry exports by ATX `# ` headings into multiple combined HTML files sharing one `resources/` folder.

**Architecture:** Detect/split H1 sections → per-section scoped `CascadeExportContext` (markdown override + output name) → mini Website build/save each HTML → dedupe resource downloads once.

**Tech Stack:** TypeScript, Obsidian API, existing cascade export pipeline.

**Spec:** `docs/superpowers/specs/2026-07-10-h1-split-export-design.md`

---

### Task 1: H1 split helper

**Files:**
- Create: `src/plugin/utils/h1-split.ts`

- [x] Split ATX H1s (ignore code fences / frontmatter for detection)
- [x] Sanitize + dedupe output filenames
- [x] Export `H1Section { title, markdown, outputFileName }`

### Task 2: Scoped cascade resolver

**Files:**
- Modify: `src/plugin/cascade-export-resolver.ts`

- [x] Extend `CascadeExportContext` with override fields
- [x] `collectFromSection(entry, markdown, meta)` — entry links from section text only

### Task 3: Render / path / tree / title wiring

**Files:**
- Modify: `src/plugin/website/webpage.ts`, `website.ts`, `cascade-content-tree.ts`, `render-api.ts` (if needed)

- [x] Entry uses markdown override when set
- [x] Entry target filename from `entryOutputFileName`
- [x] Title from `entryDisplayTitle`
- [x] Content tree reads override; root title = display title; skip leading H1 as child

### Task 4: Export loop + shared resources

**Files:**
- Modify: `src/plugin/exporter.ts`

- [x] Branch no-H1 vs split
- [x] Multi save; deleteOld once; dedupe resources

### Task 5: Build verify

- [x] `npm run build`
