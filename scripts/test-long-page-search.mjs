import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome', chromium.executablePath(),
].find(existsSync);
assert.ok(executablePath, 'Set CHROMIUM_EXECUTABLE_PATH to a Chromium executable');
const temporary = await mkdtemp(path.join(tmpdir(), 'responsive-reading-'));
const bundle = await build({ entryPoints: ['src/plugin/website/long-page.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'Export', write: false });
const browser = await chromium.launch({ executablePath, headless: true });
const content = text => `<body class="publish"><div class="obsidian-document markdown-preview-view markdown-rendered"><div class="markdown-preview-sizer">${text}</div></div></body>`;
const input = {
  pages: [
    { targetPath: 'entry.html', title: '入口文章', html: content('<h1>当前文章搜索</h1><p>Needle one, needle two.</p><p>中文<strong>搜索</strong>测试。 a+b[0].* <mark>原有标注</mark></p><pre><code><span class="token keyword">const</span> <span class="token variable">needle</span> = 1;</code></pre><p hidden>needle hidden</p><p><a href="next.html">正文引用</a></p>') },
    { targetPath: 'next.html', title: '引用文章', html: content('<h1>引用文章</h1><p>needle in another article. needle again.</p>') },
  ],
  navigation: [{ title: 'needle in directory', href: 'entry.html', children: [] }],
  bodyClasses: 'theme-light', mediaRegistry: {}, attachmentPaths: [],
  headHtml: '<style>body { --font-text-size: 22px !important; --font-text: Georgia, serif; --font-monospace: monospace; } .markdown-preview-view { font: var(--font-text-size)/1.6 var(--font-text); } code { font-family: var(--font-monospace); background: #eee; } .token.keyword { color: #a32d75; }</style>',
  title: 'Responsive reading', tocTitle: '目录', backToTocLabel: '返回目录', closeNavigationLabel: '关闭目录',
};
const errors = [];
try {
  const generator = await browser.newPage();
  await generator.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await generator.evaluate(input => Export.buildLongPage(input), input);
  const legacy = await generator.evaluate(input => Export.buildLongPage({ ...input, style: 'mobile' }), input);
  assert.equal(legacy.html, result.html, 'legacy presentation setting no longer changes output');
  const file = path.join(temporary, 'responsive.html');
  await writeFile(file, result.html);
  await generator.close();
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    const article = page.locator('#lp-page-0 .obsidian-document');
    const original = await article.innerHTML();
    assert.equal(await page.locator('#lp-menu').textContent(), '', 'menu has an icon only');
    assert.equal(await page.locator('#lp-menu').getAttribute('aria-label'), '目录');
    const menuBounds = await page.locator('#lp-menu').boundingBox();
    assert.equal(menuBounds.width, 48); assert.equal(menuBounds.height, 48);
    assert.equal(await page.locator('#lp-toc').isVisible(), width > 760);
    const font = await article.evaluate(el => ({ size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily }));
    assert.equal(font.size, width <= 760 ? '16px' : '22px');
    assert.equal(font.family.includes('Georgia'), width > 760, 'phone uses system fonts; desktop preserves theme fonts');
    assert.equal(await page.locator('code').first().evaluate(el => getComputedStyle(el).fontFamily), 'monospace');
    await page.locator('#lp-search-toggle').click();
    const query = page.locator('#lp-search-input');
    const status = page.locator('#lp-search-status');
    const find = async (text, expected) => { await query.fill(text); await page.waitForFunction(expected => document.getElementById('lp-search-status').textContent === expected, expected); };
    await find('needle', '1 / 3');
    assert.equal(await page.locator('#lp-page-1 mark[data-lp-search]').count(), 0, 'other article excluded');
    assert.equal(await page.locator('#lp-toc mark[data-lp-search]').count(), 0, 'directory excluded');
    assert.equal(await page.locator('#lp-page-0 [hidden] mark').count(), 0, 'hidden text excluded');
    await page.locator('#lp-search-next').click(); assert.equal(await status.textContent(), '2 / 3');
    await query.press('Enter'); assert.equal(await status.textContent(), '3 / 3');
    await query.press('Shift+Enter'); assert.equal(await status.textContent(), '2 / 3');
    await page.locator('#lp-search-previous').click(); assert.equal(await status.textContent(), '1 / 3');
    await page.locator('#lp-search-previous').click(); assert.equal(await status.textContent(), '3 / 3');
    await query.dispatchEvent('compositionstart');
    await query.fill('中文搜索');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.lp-search-current').textContent(), 'needle', 'composition leaves existing highlights intact');
    await query.dispatchEvent('compositionend');
    await page.waitForFunction(() => document.getElementById('lp-search-status').textContent === '1 / 1');
    assert.equal(await page.locator('.lp-search-current').count(), 2, 'one result across inline markup');
    assert.equal(await page.locator('strong mark').textContent(), '搜索');
    await find('a+b[0].*', '1 / 1');
    assert.equal(await page.locator('.lp-search-current').textContent(), 'a+b[0].*', 'search metacharacters are literal');
    await find('not in article', 'No matches');
    assert.equal(await page.locator('#lp-search-next').isDisabled(), true);
    await find('<img src=x onerror=alert(1)>', 'No matches');
    assert.equal(await article.locator('img').count(), 0, 'search text never becomes HTML');
    await find('needle', '1 / 3');
    if (process.env.LONG_PAGE_ARTIFACT_DIR) {
      await mkdir(process.env.LONG_PAGE_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.LONG_PAGE_ARTIFACT_DIR, `search-${width}.png`) });
    }
    await page.locator('#lp-page-0 a').filter({ hasText: '正文引用' }).click();
    await page.waitForFunction(() => document.querySelector('#lp-page-1.lp-active') && document.getElementById('lp-search-status').textContent === '1 / 2');
    assert.equal(await page.locator('#lp-page-0 mark[data-lp-search]').count(), 0, 'marks removed from old article');
    assert.equal(await article.innerHTML(), original, 'styles and inline markup restored exactly');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#lp-search-panel').isVisible(), false);
    assert.equal(await page.locator('mark[data-lp-search]').count(), 0);
    assert.equal(await page.locator('#lp-search-toggle').evaluate(el => el === document.activeElement), true);
    // Resize this very same HTML file across the breakpoint, with no navigation/reload.
    const resizeTo = async width => {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(wide => document.getElementById('lp-menu').getAttribute('aria-expanded') === String(wide) && !document.body.classList.contains('lp-nav-open'), width > 760);
    };
    await resizeTo(width <= 760 ? 1280 : 390);
    assert.equal(await page.locator('#lp-toc').isVisible(), width <= 760);
    assert.equal(await article.evaluate(el => getComputedStyle(el).fontSize), width <= 760 ? '22px' : '16px');
    if (width > 760) {
      await page.locator('#lp-menu').click();
      assert.equal(await page.locator('#lp-toc').isVisible(), true);
      await resizeTo(1280);
      assert.equal(await page.locator('#lp-toc').isVisible(), true);
      await resizeTo(390);
      assert.equal(await page.locator('#lp-toc').isVisible(), false, 'drawer does not remain stuck open after resizing');
    }
    await page.close();
    console.log(`${width}px: current-article search, highlighting, IME-safe input, literal queries, navigation, fonts and responsive resize passed`);
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const fallback = await noScript.newPage(); await fallback.goto(pathToFileURL(file).href);
  assert.equal(await fallback.locator('.lp-page:visible').count(), 2);
  assert.equal(await fallback.locator('#lp-search-toggle').isVisible(), false);
  assert.equal(await fallback.locator('#lp-search-panel').isVisible(), false);
  await noScript.close();
  assert.deepEqual(errors, []);
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
