import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/usr/bin/google-chrome', chromium.executablePath(),
].find(existsSync);
assert.ok(executablePath, 'Set CHROMIUM_EXECUTABLE_PATH to a Chromium executable');
const temporary = await mkdtemp(path.join(tmpdir(), 'long-page-styles-'));
const bundle = await build({
  stdin: { contents: `export { buildLongPage } from './src/plugin/website/long-page';
    export { remapLongPageCss } from './src/plugin/website/long-page-styles';
    export { remapExportCssSelectors } from './src/plugin/utils/css-selector-remap';
    export { wrapCssInStyleTag } from './src/plugin/utils/css-html-safe';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'Export', write: false,
});
const base = process.env.LONG_PAGE_BASE_CSS ? await readFile(process.env.LONG_PAGE_BASE_CSS, 'utf8') : '';
const theme = process.env.LONG_PAGE_THEME_CSS ? await readFile(process.env.LONG_PAGE_THEME_CSS, 'utf8') : '';
// Rules gated on body classes AND reading-pane ancestors reproduce both failure modes.
// Real Obsidian/theme CSS supplies all remaining properties when supplied above.
const css = `${base}\n${theme}
body { color: var(--text-normal, #222222); }
.theme-light { --fixture-inline: #edf1f7; --fixture-code: #f6f7fa; --fixture-accent: #6550b9; }
.theme-dark { --fixture-inline: #343540; --fixture-code: #292a32; --fixture-accent: #b6a4ef; }
.fixture-body .workspace .markdown-reading-view .fixture-note table { border: 2px solid var(--fixture-accent); border-collapse: collapse; }
.fixture-body .workspace .markdown-reading-view .fixture-note td, .fixture-body .workspace .markdown-reading-view .fixture-note th { padding: 8px 12px; border: 1px solid var(--fixture-accent); }
.fixture-body .workspace .markdown-reading-view .fixture-note tr:nth-child(even) { background: var(--fixture-inline); }
.fixture-body .workspace .markdown-reading-view .fixture-note blockquote { border-left: 4px solid var(--fixture-accent); padding: 12px 18px; background: var(--fixture-inline); border-radius: 6px; }
.fixture-body .workspace .markdown-reading-view .fixture-note pre { background: var(--fixture-code); border: 1px solid var(--fixture-accent); border-radius: 8px; padding: 16px; }
.fixture-body .workspace .markdown-reading-view .fixture-note p > code { color: var(--fixture-accent); background: var(--fixture-inline); border-radius: 4px; padding: 2px 5px; }
.fixture-body .workspace .markdown-reading-view .fixture-note .token.keyword { color: var(--fixture-accent); }
`;
const note = `<div class="obsidian-document markdown-preview-view markdown-rendered fixture-note is-readable-line-width" data-type="markdown"><div class="markdown-preview-sizer"><h1>正文样式验证</h1>
  <p>段落中的 <code class="fixture-inline">inline code</code> 应保留背景、颜色与圆角。</p>
  <div class="el-table"><table><thead><tr><th>项目</th><th>说明</th></tr></thead><tbody><tr><td>表格</td><td>边框、间距、斑马纹</td></tr><tr><td>主题</td><td>与阅读视图保持一致</td></tr></tbody></table></div>
  <blockquote><p>引用应保留主题的边框、背景与留白。</p></blockquote>
  <div class="callout" data-callout="note"><div class="callout-title"><div class="callout-title-inner">提示</div></div><div class="callout-content"><p>保留 Obsidian callout 样式。</p></div></div>
  <pre class="language-javascript"><code class="language-javascript"><span class="token keyword">const</span> message = <span class="token string">"主题样式"</span>;\nconsole.log(message);</code></pre>
</div></div>`;
const props = ['color', 'background-color', 'border-left-width', 'border-left-style', 'border-left-color',
  'border-radius', 'border-collapse', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-bottom', 'font-size', 'font-family', 'font-weight'];
const selectors = ['table', 'th', 'td', 'tbody tr:nth-child(2)', 'blockquote', 'p > code', 'pre', 'pre > code', '.token.keyword', '.token.string', '.callout', '.callout-title', '.callout-content'];
const snapshot = page => page.evaluate(({ props, selectors }) => Object.fromEntries(selectors.map(selector => {
  const style = getComputedStyle(document.querySelector('.fixture-note ' + selector));
  return [selector, Object.fromEntries(props.map(property => [property, style.getPropertyValue(property)]))];
})), { props, selectors });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const generator = await browser.newPage();
  await generator.addScriptTag({ content: bundle.outputFiles[0].text });
  const remapped = await generator.evaluate(() => Export.remapLongPageCss(`
#center-content-extra { color: red; }
[data-href="#center-content"] #center-content { --example: "#center-content .workspace"; background: url('#center-content'); }
.workspace-leaf #main-horizontal > #center-content.leaf { color: blue; }
@media screen { .workspace .markdown-reading-view code { border: 0; } }`));
  assert.match(remapped, /#center-content-extra/);
  assert.match(remapped, /\[data-href="#center-content"\] \.lp-page/);
  assert.match(remapped, /--example: "#center-content \.workspace"/);
  assert.match(remapped, /url\('#center-content'\)/);
  assert.match(remapped, /\.workspace-leaf #lp-content > \.lp-page\.leaf/);
  assert.match(remapped, /#lp-content \.lp-page code/);
  for (const mode of ['light', 'dark']) {
    const bodyClasses = `publish css-settings-manager fixture-body theme-${mode}`;
    const baseline = await generator.evaluate(({ css, note, bodyClasses }) => `<!doctype html><html><head>${Export.wrapCssInStyleTag(css)}</head><body class="${bodyClasses}"><div class="workspace"><div class="markdown-reading-view">${note}</div></div></body></html>`, { css, note, bodyClasses });
    for (const style of ['mobile', 'desktop']) {
      const result = await generator.evaluate(({ css, note, bodyClasses, style }) => Export.buildLongPage({
        pages: [{ targetPath: 'note.html', title: '正文样式验证', html: `<html><body class="publish css-settings-manager"><div id="main"><div id="main-horizontal"><div id="center-content">${note}</div></div></div></body></html>` }],
        bodyClasses, headHtml: Export.wrapCssInStyleTag(Export.remapExportCssSelectors(css)), mediaRegistry: {}, attachmentPaths: [],
        style, title: '正文样式验证', tocTitle: '目录', backToTocLabel: '目录', closeNavigationLabel: '关闭',
      }), { css, note, bodyClasses, style });
      assert.deepEqual(result.warnings, []);
      const baselinePath = path.join(temporary, `baseline-${mode}.html`);
      const exportedPath = path.join(temporary, `exported-${mode}-${style}.html`);
      await writeFile(baselinePath, baseline);
      await writeFile(exportedPath, result.html);
      for (const width of [390, 1280]) {
        for (const javaScriptEnabled of [true, false]) {
          const context = await browser.newContext({ javaScriptEnabled, viewport: { width, height: 960 } });
          const reference = await context.newPage();
          const exported = await context.newPage();
          await reference.goto(pathToFileURL(baselinePath).href);
          await exported.goto(pathToFileURL(exportedPath).href);
          assert.equal(await exported.locator('body').evaluate(el => el.classList.contains('theme-dark')), mode === 'dark');
          assert.equal(await exported.locator('body').evaluate(el => el.classList.contains('theme-light')), mode === 'light');
          const before = await snapshot(reference), after = await snapshot(exported);
          for (const selector of selectors) assert.deepEqual(after[selector], before[selector], `${mode} ${style} ${width}px JS=${javaScriptEnabled}: ${selector} matches original reading view`);
          assert.notEqual(after['p > code']['background-color'], 'rgba(0, 0, 0, 0)', 'inline code has its theme background');
          assert.notEqual(after.pre['background-color'], 'rgba(0, 0, 0, 0)', 'code block has its theme background');
          if (process.env.LONG_PAGE_ARTIFACT_DIR && width === 1280 && javaScriptEnabled && style === 'desktop') {
            await mkdir(process.env.LONG_PAGE_ARTIFACT_DIR, { recursive: true });
            await exported.screenshot({ path: path.join(process.env.LONG_PAGE_ARTIFACT_DIR, `content-styles-${mode}.png`) });
          }
          await context.close();
        }
      }
    }
    // Explicit export-time classes override stale cached page themes.
    const stale = await generator.evaluate(({ css, note, bodyClasses }) => Export.buildLongPage({
      pages: [{ targetPath: 'note.html', title: 'Note', html: `<body class="theme-${bodyClasses.includes('theme-dark') ? 'light' : 'dark'}">${note}</body>` }],
      bodyClasses, headHtml: Export.wrapCssInStyleTag(css), mediaRegistry: {}, attachmentPaths: [], style: 'mobile',
      title: 'Note', tocTitle: 'Contents', backToTocLabel: 'Contents', closeNavigationLabel: 'Close',
    }).html, { css, note, bodyClasses });
    const body = await generator.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.className, stale);
    assert.ok(body.split(/\s+/).includes(`theme-${mode}`));
    assert.ok(!body.split(/\s+/).includes(`theme-${mode === 'light' ? 'dark' : 'light'}`));
    console.log(`${mode}: table, quote, callout, code block, syntax tokens and inline code match original styles (mobile/desktop, 390px/1280px, with/without JS)`);
  }
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
