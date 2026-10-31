import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Uses a local Chromium installation; no browser download or running Obsidian needed.
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  chromium.executablePath(),
].find(existsSync);
assert.ok(executablePath, 'Set CHROMIUM_EXECUTABLE_PATH to a Chromium executable');
const temporary = await mkdtemp(path.join(tmpdir(), 'long-page-navigation-'));
const bundle = await build({
  stdin: { contents: 'export { buildLongPage } from "./src/plugin/website/long-page"; export { wrapCssInStyleTag } from "./src/plugin/utils/css-html-safe";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
  platform: 'browser', format: 'iife', globalName: 'LongPage', write: false,
});
const browser = await chromium.launch({ executablePath, headless: true });
const baseCss = process.env.LONG_PAGE_BASE_CSS ? await readFile(process.env.LONG_PAGE_BASE_CSS, 'utf8') : '';
const themeCss = process.env.LONG_PAGE_THEME_CSS ? await readFile(process.env.LONG_PAGE_THEME_CSS, 'utf8') : '';
const css = `
${baseCss}
body { font: 16px/1.6 sans-serif; color: var(--text-normal, #222222); }
.el-table > table { margin: 17px 0; border-collapse: collapse; border: 3px solid rgb(25, 85, 115); }
.el-table > table td, .el-table > table th { border: 2px solid rgb(35, 95, 125); padding: 7px 11px; }
.el-table > table tr:nth-child(even) { background: rgb(220, 235, 245); }
.fixture-spacer { height: 700px; }
${themeCss}`;
const content = (title, links = '') => `<html><body class="publish css-settings-manager"><div class="obsidian-document markdown-rendered"><div class="markdown-preview-view"><div class="markdown-preview-sizer"><div class="markdown-preview-section">
  <h1 id="Shared_heading_0" data-heading="Shared heading">${title}</h1><p>${links}</p>
  <div class="fixture-spacer"></div><h2 id="第二节_0">第二节</h2>
  <div class="el-table"><table><thead><tr>${'<th>Column heading</th>'.repeat(24)}</tr></thead><tbody><tr>${'<td>Cell content</td>'.repeat(24)}</tr><tr>${'<td>Striped row</td>'.repeat(24)}</tr></tbody></table></div>
  <div class="fixture-spacer"></div><p id="footnote"><a class="footnote-back" href="#Shared_heading_0">Back</a></p>
  <p><a class="footnote" href="#footnote">Footnote</a><a href="https://example.com">External</a><a href="attachments/report.pdf">Attachment</a><a href="missing.html">Missing</a></p>
  <script>throw new Error('exported page script must be stripped')</script>
</div></div></div></div></body></html>`;
const node = (title, href, children = []) => ({ title, href, children });
const input = {
  bodyClasses: 'publish css-settings-manager theme-light',
  title: 'Navigation regression', tocTitle: 'Contents', backToTocLabel: 'Contents',
  closeNavigationLabel: 'Close contents',
  pages: [
    { targetPath: 'entry.html', title: 'Entry', html: content('Entry', '<a href="b.html#第二节">B section</a><a href="a.html">A</a>') },
    { targetPath: 'a.html', title: 'A', html: content('A', '<a href="c.html">C again</a>') },
    { targetPath: 'b.html', title: 'B', html: content('B', '<a href="c.html">C</a><a href="d.html">D</a>') },
    { targetPath: 'c.html', title: 'C', html: content('C', '<a href="b.html">Cycle B</a><a href="d.html">Shared D</a>') },
    { targetPath: 'd.html', title: 'D', html: content('D', '<a href="c.html">Cycle C</a>') },
    { targetPath: 'unlinked.html', title: 'Unlinked', html: content('Unlinked') },
    { targetPath: 'broken.html', title: 'Broken', html: '<p>no document</p>' },
  ],
  navigation: [node('Entry', 'entry.html', [
    node('Group', undefined, [
      { ...node('B alias', 'b.html'), titleHtml: '<strong>B alias</strong>', iconHtml: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>' },
      node('A alias', 'a.html'), node('B heading', 'b.html#Shared%20heading'),
      node('Entry section', 'entry.html#第二节_0'),
    ]),
  ])],
  mediaRegistry: {}, attachmentPaths: ['attachments/report.pdf'], headHtml: '', css,
};
const errors = [];
try {
  const generator = await browser.newPage();
  await generator.addScriptTag({ content: bundle.outputFiles[0].text });
  const files = {};
  for (const style of ['mobile', 'desktop']) {
    const result = await generator.evaluate((input) => LongPage.buildLongPage({ ...input, headHtml: LongPage.wrapCssInStyleTag(input.css) }), { ...input, style });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /Broken/);
    const file = path.join(temporary, `${style}.html`);
    await writeFile(file, result.html);
    files[style] = pathToFileURL(file).href;
    assert.doesNotMatch(result.html, /fetch\(|pushState\(|DecompressionStream/);
  }
  // Exercise the actual entry Markdown parser, with only Obsidian services mocked.
  const cascadeBundle = await build({
    stdin: { contents: `
      import { CascadeContentTree } from './src/plugin/features/cascade-content-tree';
      import { TFile } from 'obsidian';
      globalThis.parseCascade = async function(markdown) {
        const files = ['entry', 'a', 'b'].map(name => new TFile(name));
        globalThis.app = { vault: { read: async () => markdown }, metadataCache: {
          getFirstLinkpathDest: name => files.find(file => file.basename === name)
        } };
        const website = { index: { getWebpage: source => ({ targetPath: { path: source.replace('.md', '.html') } }) } };
        const tree = new CascadeContentTree(website, { entryFile: files[0] }, { targetPath: { path: 'entry.html' } });
        const convert = item => ({ title: item.title, href: item.href, icon: item.icon, children: item.children.map(convert) });
        return (await tree.getTreeItems()).map(convert);
      };`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', write: false,
    plugins: [{ name: 'obsidian-services', setup(build) {
      build.onResolve({ filter: /^(obsidian|src\/plugin\/settings\/settings|src\/plugin\/render-api\/render-api|\.\/file-tree)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: {
        obsidian: "export class TFile { constructor(name) { this.path = name + '.md'; this.basename = name; this.extension = 'md'; } }",
        'src/plugin/settings/settings': 'export const Settings = { isPathAllowedByFilePicker: () => true };',
        'src/plugin/render-api/render-api': "export const _MarkdownRendererInternal = { getIconForFile: async () => ({ icon: '📚' }) };",
        './file-tree': `export class FileTree { pathToItem = new Map(); async getTreeItems() { await this.populateTree(); return this.children; } }
          export class FileTreeItem { children = []; constructor(tree, parent, depth) { this.tree = tree; this.parent = parent; this.depth = depth; } }`,
      }[args.path], loader: 'ts' }));
    } }],
  });
  await generator.addScriptTag({ content: cascadeBundle.outputFiles[0].text });
  const parsedTree = await generator.evaluate(() => parseCascade('# Topic\n- **Group**\n  - [[a#第二节|A alias]]\n  - [B alias](b#Shared%20heading)\n## Nested\n- [[a]]'));
  const topic = parsedTree[0].children[0];
  assert.equal(parsedTree[0].icon, '📚');
  assert.equal(topic.title, 'Topic');
  assert.equal(topic.href, 'entry.html#Topic_0');
  assert.deepEqual(topic.children[0].children.map(item => [item.title, item.href]), [['A alias', 'a.html#第二节'], ['B alias', 'b.html#Shared%20heading']]);
  assert.equal(topic.children[1].title, 'Nested');
  assert.equal(topic.children[1].children[0].href, 'a.html');
  console.log('Entry headings, nested groups, aliases and linked heading fragments passed');
  // Reproduce the reported deep Chinese directory, including a wrapped selection.
  const designTree = [node('1. 主要内容索引', 'entry.html', [
    node('现状和目标', 'a.html'), node('三种探针的核心概念与职责边界', 'b.html'),
    node('课题方案', undefined, [
      node('探针配置必要性', 'a.html#Shared_heading_0'),
      node('三种探针检查项和检查方法', undefined, [
        node('存活探针检查项和检查方法（含异常情况处理）', 'c.html'),
        node('启动探针检查项和检查方法', 'd.html'),
        node('就绪性探针检查项和检查方法', 'unlinked.html'),
      ]), node('探针配置参数建议', 'a.html#第二节'),
    ]), node('SDK', undefined, [
      node('Java探针SDK设计方案–应用自托管', 'b.html#第二节'),
      node('统一SDK实现DEMO', 'b.html#Shared_heading_0'),
    ]), node('支持和改造事项', 'entry.html#第二节'),
  ])];
  for (const style of ['mobile', 'desktop']) {
    for (const mode of ['light', 'dark']) {
      const result = await generator.evaluate(input => LongPage.buildLongPage({ ...input, headHtml: LongPage.wrapCssInStyleTag(input.css) }), {
        ...input, navigation: designTree, style, tocTitle: '目录', bodyClasses: `publish css-settings-manager theme-${mode}`,
        pages: input.pages.map(page => ({ ...page, html: page.html.replace('theme-light', `theme-${mode}`) })),
      });
      const file = path.join(temporary, `sidebar-${style}-${mode}.html`);
      await writeFile(file, result.html);
      const preview = await browser.newPage({ viewport: { width: style === 'mobile' ? 390 : 1280, height: 920 } });
      await preview.goto(`${pathToFileURL(file).href}#lp-page-3`);
      if (style === 'mobile') await preview.locator('#lp-menu').click();
      const geometry = await preview.locator('#lp-toc .lp-current').evaluate(row => {
        const r = row.getBoundingClientRect(), t = row.querySelector('.lp-nav-text').getBoundingClientRect();
        const siblings = Array.from(row.parentElement.parentElement.children).map(li => li.getBoundingClientRect());
        return { centerOffset: (r.top + r.bottom - t.top - t.bottom) / 2, rowHeight: r.height, textHeight: t.height,
          gaps: siblings.slice(1).map((r, i) => r.top - siblings[i].bottom),
          overflow: document.getElementById('lp-toc').scrollWidth > document.getElementById('lp-toc').clientWidth,
          selectionCount: document.querySelectorAll('#lp-toc .lp-current').length };
      });
      assert.ok(Math.abs(geometry.centerOffset) < 1, 'multiline selection is vertically centered');
      assert.ok(geometry.rowHeight >= geometry.textHeight + 18, 'balanced vertical padding');
      assert.ok(geometry.gaps.every(gap => Math.abs(gap - 4) < 1), 'consistent sibling spacing');
      assert.equal(geometry.overflow, false, 'deep directory has no horizontal overflow');
      assert.equal(geometry.selectionCount, 1);
      if (style === 'mobile') assert.ok(geometry.textHeight > 22, 'fixture covers a multiline active label');
      if (process.env.LONG_PAGE_ARTIFACT_DIR) {
        await mkdir(process.env.LONG_PAGE_ARTIFACT_DIR, { recursive: true });
        await preview.screenshot({ path: path.join(process.env.LONG_PAGE_ARTIFACT_DIR, `sidebar-${style}-${mode}.png`) });
      }
      await preview.close();
    }
  }
  console.log('Chinese nested sidebar: multiline centering, consistent gaps, overflow and light/dark passed');
  await generator.close();
  const visiblePages = (page) => page.locator('.lp-page:visible').evaluateAll((els) => els.map((el) => el.id));
  for (const style of ['mobile', 'desktop']) {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      // Prove navigation does not need any interactive-site browser facilities.
      await context.addInitScript(() => {
        window.fetch = () => { throw new Error('fetch is forbidden'); };
        history.pushState = () => { throw new Error('pushState is forbidden'); };
        window.DecompressionStream = undefined;
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(files[style]);
      assert.deepEqual(await visiblePages(page), ['lp-page-0']);
      assert.equal(await page.locator('script').count(), 1);
      if (process.env.LONG_PAGE_ARTIFACT_DIR && ((style === 'mobile' && width === 390) || (style === 'desktop' && width === 1280))) {
        await mkdir(process.env.LONG_PAGE_ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.LONG_PAGE_ARTIFACT_DIR, `${style}-${width}.png`) });
        if (style === 'mobile') {
          await page.locator('#lp-menu').click();
          await page.screenshot({ path: path.join(process.env.LONG_PAGE_ARTIFACT_DIR, 'mobile-drawer.png') });
          await page.locator('#lp-close').click();
        }
      }
      assert.deepEqual(await page.locator('.lp-page').evaluateAll((els) => els.map((el) => el.id)),
        ['lp-page-0', 'lp-page-1', 'lp-page-2', 'lp-page-3', 'lp-page-4', 'lp-page-5']);
      const directoryLinks = ['#lp-page-0', '#lp-page-2', '#lp-page-1', '#p2-0', '#p0-1'];
      const assertDirectory = async (surface) => {
        assert.deepEqual(await surface.locator('#lp-toc a').evaluateAll(els => els.map(el => el.getAttribute('href'))), directoryLinks,
          'directory contains only the entry tree, including after reference navigation');
        assert.equal(await surface.locator('.lp-pager, .lp-next, .lp-previous').count(), 0, 'no sequential page controls');
      };
      await assertDirectory(page);
      assert.equal(await page.locator('#lp-toc strong').textContent(), 'B alias');
      assert.equal(await page.locator('.lp-nav-icon svg').count(), 1);
      const showNavigation = async () => { if (!await page.locator('#lp-toc').isVisible()) await page.locator('#lp-menu').click(); };
      const drawer = width <= 760;
      assert.equal(await page.locator('#lp-toc').isVisible(), !drawer);
      // Collapse the group, then follow a link into it; routing must reopen ancestors.
      if (drawer) await showNavigation();
      const group = page.locator('#lp-toc summary').filter({ hasText: /^Group$/ });
      await group.click();
      await page.locator('#lp-close').click();
      await page.locator('#lp-page-0 a').filter({ hasText: 'B section' }).click();
      await page.waitForFunction(() => location.hash.startsWith('#p2-') && document.querySelector('#lp-page-2.lp-active'));
      assert.deepEqual(await visiblePages(page), ['lp-page-2']);
      const target = page.locator('#lp-page-2 h2');
      assert.ok(Math.abs((await target.boundingBox()).y) <= 15, `cross-page heading scroll: ${(await target.boundingBox()).y}`);
      assert.equal(await page.locator('#lp-toc a[aria-current]').textContent(), 'B alias');
      assert.equal(await group.locator('..').getAttribute('open'), '');
      if (drawer) assert.equal(await page.locator('#lp-toc').isVisible(), false);
      // Navigation link to a heading, same-hash repeat, then body references to unlisted pages.
      await showNavigation();
      await page.locator('#lp-toc a').filter({ hasText: /^B heading$/ }).click();
      assert.deepEqual(await visiblePages(page), ['lp-page-2']);
      await page.waitForFunction(() => location.hash === '#p2-0' && document.querySelector('#lp-toc a[aria-current]')?.textContent === 'B heading');
      await showNavigation();
      await page.locator('#lp-toc a').filter({ hasText: /^B heading$/ }).click();
      assert.equal(await page.locator('#lp-toc a[aria-current]').textContent(), 'B heading');
      await page.locator('#lp-page-2 a').filter({ hasText: /^C$/ }).click();
      await page.waitForFunction(() => location.hash === '#lp-page-3' && document.querySelector('#lp-page-3.lp-active'));
      assert.deepEqual(await visiblePages(page), ['lp-page-3']);
      await assertDirectory(page);
      assert.equal(await page.locator('#lp-toc a[aria-current]').count(), 0, 'unlisted page has no directory selection');
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('#lp-page-2.lp-active'));
      assert.deepEqual(await visiblePages(page), ['lp-page-2']);
      await page.goForward();
      await page.waitForFunction(() => document.querySelector('#lp-page-3.lp-active'));
      assert.deepEqual(await visiblePages(page), ['lp-page-3']);
      await page.locator('#lp-page-3 a').filter({ hasText: /^Shared D$/ }).click();
      await page.waitForFunction(() => document.querySelector('#lp-page-4.lp-active'));
      await assertDirectory(page);
      await page.locator('#lp-page-4 a').filter({ hasText: /^Cycle C$/ }).click();
      await page.waitForFunction(() => document.querySelector('#lp-page-3.lp-active'));
      await assertDirectory(page);
      await page.locator('#lp-page-3 a').filter({ hasText: /^Cycle B$/ }).click();
      await page.waitForFunction(() => location.hash === '#lp-page-2' && document.querySelector('#lp-page-2.lp-active'));
      await page.locator('#lp-page-2 .footnote').click();
      await page.waitForFunction(() => location.hash.startsWith('#p2-') && document.querySelector('#lp-page-2.lp-active'));
      await page.locator('#lp-page-2 .footnote-back').click();
      await page.waitForFunction(() => location.hash === '#p2-0' && document.querySelector('#lp-toc a[aria-current]')?.textContent === 'B heading');
      assert.equal(await page.locator('.lp-dead-link').filter({ hasText: /^Missing$/ }).count(), 6);
      assert.equal(await page.locator('a[href="attachments/report.pdf"]').count(), 6);
      assert.equal(await page.locator('.el-table > table').count(), 6, 'theme table child selectors preserved');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body, #lp-root, #lp-content, .lp-active, .lp-active *')].filter(e => e.getBoundingClientRect().right > innerWidth || e.classList.contains('lp-table-scroll')).map(e => [e.tagName, e.className, e.getBoundingClientRect().width, getComputedStyle(e).overflowX, getComputedStyle(e).minWidth, getComputedStyle(e).width]).slice(0, 10))));
      assert.ok(await page.locator('#lp-page-2 .el-table').evaluate((el) => el.scrollWidth > el.clientWidth), 'wide table scrolls inside original parent');
      // Invalid routes keep the current document readable.
      await page.evaluate(() => { location.hash = '#unknown'; });
      await page.waitForFunction(() => location.hash === '#unknown');
      assert.deepEqual(await visiblePages(page), ['lp-page-2']);
      await page.reload();
      assert.equal((await visiblePages(page)).length, 1);
      await page.goto(`${files[style]}#lp-toc`);
      assert.equal((await visiblePages(page)).length, 1, 'direct contents hash keeps the entry readable');
      assert.equal(await page.locator('#lp-menu').getAttribute('aria-expanded'), 'true');
      await page.goto(`${files[style]}#p2-1`);
      assert.deepEqual(await visiblePages(page), ['lp-page-2']);
      await showNavigation();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#lp-menu').evaluate((el) => el === document.activeElement), true);
      await page.emulateMedia({ media: 'print' });
      assert.equal((await visiblePages(page)).length, 6, 'printing includes every page');
      await context.close();
      const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 844 } });
      const fallback = await noScript.newPage();
      await fallback.goto(files[style]);
      assert.equal((await visiblePages(fallback)).length, 6);
      assert.equal(await fallback.locator('#lp-toc').isVisible(), true);
      await assertDirectory(fallback);
      await fallback.locator('#lp-toc a').filter({ hasText: /^B heading$/ }).click();
      assert.match(fallback.url(), /#p2-0$/);
      await fallback.locator('#lp-page-2 a').filter({ hasText: /^C$/ }).click();
      assert.match(fallback.url(), /#lp-page-3$/);
      await assertDirectory(fallback);
      assert.equal(await fallback.locator('#lp-close').isVisible(), false);
      assert.ok(await fallback.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'fallback has no horizontal overflow');
      await noScript.close();
      console.log(`${style} ${width}px: navigation, history, anchors, overflow, print and no-script passed`);
    }
  }
  // Compare original vs. exported table presentation with exactly the same theme.
  const comparison = await browser.newPage({ viewport: { width: 1280, height: 844 } });
  await comparison.goto(files.desktop);
  const tableStyles = () => Array.from(document.querySelectorAll('#lp-page-0 table, #lp-page-0 th, #lp-page-0 td, #lp-page-0 tr')).map((el) => {
    const s = getComputedStyle(el);
    return [s.margin, s.border, s.borderCollapse, s.borderSpacing, s.padding, s.minWidth, s.fontFamily, s.fontSize, s.backgroundColor, s.color];
  });
  const exportedStyles = await comparison.evaluate(tableStyles);
  await comparison.evaluate(() => {
    document.getElementById('long-page-style').remove();
    document.querySelectorAll('.lp-table-scroll').forEach((el) => el.classList.remove('lp-table-scroll'));
  });
  const originalStyles = await comparison.evaluate(tableStyles);
  for (let i = 0; i < exportedStyles.length; i++) assert.deepEqual(exportedStyles[i], originalStyles[i], `table element ${i}: borders, stripes, spacing, font and min-width match original theme`);
  await comparison.close();
  // A single-note export stays visible and reserves no space for an absent sidebar.
  const single = await browser.newPage();
  await single.addScriptTag({ content: bundle.outputFiles[0].text });
  const one = await single.evaluate((input) => LongPage.buildLongPage({ ...input, navigation: [], pages: [input.pages[0]], style: 'mobile' }), input);
  const noDirectory = await single.evaluate((input) => LongPage.buildLongPage({ ...input, navigation: [], style: 'desktop' }), input);
  await single.setContent(noDirectory.html);
  assert.equal(await single.locator('#lp-toc').count(), 0, 'empty entry tree does not fall back to exported pages');
  assert.equal(await single.locator('.lp-page').count(), 6, 'pages remain embedded without directory entries');
  assert.deepEqual(await visiblePages(single), ['lp-page-0']);
  await single.evaluate(() => { location.hash = '#lp-page-3'; });
  await single.waitForFunction(() => document.querySelector('#lp-page-3.lp-active'));
  await single.setContent(one.html);
  assert.equal(await single.locator('#lp-toc').count(), 0);
  assert.deepEqual(await visiblePages(single), ['lp-page-0']);
  await single.setContent(one.html.replace('lp-mobile', 'lp-desktop'));
  assert.equal(await single.locator('#lp-content').evaluate((el) => getComputedStyle(el).marginLeft), '0px', 'single note reserves no sidebar space');
  assert.deepEqual(errors, []);
  console.log(`Table theme comparison${themeCss ? ' (real theme)' : ''} and single-page export passed`);
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
