import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import electronPath from 'electron';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const temporary = await mkdtemp(path.join(tmpdir(), 'long-page-pdf-test-'));
const artifacts = process.env.PDF_TEST_ARTIFACT_DIR || temporary;
await mkdir(artifacts, { recursive: true });
const bundle = await build({ stdin: { contents: `export { buildLongPage } from './src/plugin/website/long-page';
 export { buildPdfPrintView } from './src/plugin/pdf-export/pdf-print-view';
 export { wrapCssInStyleTag } from './src/plugin/utils/css-html-safe';`, loader: 'ts', resolveDir: process.cwd() }, bundle: true, format: 'iife', platform: 'browser', globalName: 'Export', write: false });
const nativeBundle = path.join(temporary, 'pdf-export.cjs');
await build({ entryPoints: ['src/plugin/pdf-export/pdf-export.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: nativeBundle });
const nativeReady = path.join(temporary, 'pdf-finished.json');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const base = process.env.LONG_PAGE_BASE_CSS ? await readFile(process.env.LONG_PAGE_BASE_CSS, 'utf8') : '';
  const theme = process.env.LONG_PAGE_THEME_CSS ? await readFile(process.env.LONG_PAGE_THEME_CSS, 'utf8') : '';
  const exportStyles = await readFile('src/assets/plugin-styles.txt.css', 'utf8');
  const deferredStyles = await readFile('src/assets/deferred.txt.css', 'utf8');
  const css = `${base}\n${theme}\n${exportStyles}\n${deferredStyles}\nbody { font-family: Arial, 'Heiti SC', sans-serif; color: var(--text-normal, #222); }
 .obsidian-document { font-size: var(--font-text-size, 16px); } blockquote { border-left: 3px solid #7562ce; padding: 10px; background: #f2f1f8; }
 td, th { border: 1px solid #bbb; padding: 8px; } table { border-collapse: collapse; } pre { background: #f2f3f6; padding: 12px; } code { font-family: Menlo, monospace; }`;
  const note = (title, body) => `<body class="publish"><div class="obsidian-document markdown-preview-view markdown-rendered"><div class="markdown-preview-sizer"><h1 id="Heading_0">${title}</h1>${body}</div></div></body>`;
  const input = {
    title: '入口层级 PDF 验证', tocTitle: '目录', backToTocLabel: '目录', closeNavigationLabel: '关闭', bodyClasses: 'theme-light',
    mediaRegistry: {}, attachmentPaths: [], css,
    pages: [
      { targetPath: 'entry.html', title: '入口', html: note('ENTRY_NOTE', '<p>入口原文只保留一次。</p><h2 id="Group_0">课题方案</h2><p>按入口中的层级组织阅读。</p><h2 id="Note_0">ENTRY_EXTRA</h2><p>入口后续小节也按树的位置展示。</p>') },
      { targetPath: 'a.html', title: 'A', html: note('A_NOTE', '<p>A appears after B in the entry tree.</p><p><code>inline code</code> 保留主题样式。</p>') },
      { targetPath: 'b.html', title: 'B', html: note('B_NOTE', '<p>B appears before A in the entry tree.</p><blockquote>主题中的引用样式</blockquote><pre><code>const value = 42;\nconsole.log(value);</code></pre><h2 id="Detail_0">B_DETAIL</h2><p><a href="c.html">引用页 C</a></p><table><tr><th>字段</th><th>含义</th></tr><tr><td>入口</td><td>层级顺序</td></tr></table>') },
      { targetPath: 'c.html', title: 'C', html: note('REFERENCE_C', '<p>未列入入口目录的引用资料。</p><p><a href="b.html#Detail_0">回到 B 的标题</a></p>') },
    ],
    navigation: [{ title: '主要内容索引', href: 'entry.html', children: [
      { title: '课题方案', href: 'entry.html#Group_0', children: [
        { title: 'B 方案', href: 'b.html', children: [{ title: 'B 详情', href: 'b.html#Detail_0', children: [] }] },
        { title: 'A 方案', href: 'a.html', children: [] },
      ] },
      { title: '入口补充说明', href: 'entry.html#Note_0', children: [] },
      { title: '重复引用', children: [{ title: 'B 别名', href: 'b.html', children: [] }] },
    ] }],
  };
  const exported = await page.evaluate(input => Export.buildLongPage({ ...input, headHtml: Export.wrapCssInStyleTag(input.css) }), input);
  const view = await page.evaluate(html => Export.buildPdfPrintView(html, { toc: '目录', references: '引用资料' }), exported.html);
  assert.deepEqual(view.pageOrder, ['lp-page-0', 'lp-page-2', 'lp-page-1', 'lp-page-3']);
  assert.equal(view.outline[0].title, '主要内容索引');
  assert.deepEqual(view.outline[0].children[0].children.map(node => node.title), ['B 方案', 'A 方案']);
  assert.equal(view.outline[0].children[2].children[0].target, 'lp-page-2');
  assert.ok(!JSON.stringify(view.outline).includes('REFERENCE_C'));
  await page.setContent(view.html);
  assert.equal(await page.locator('script, #lp-toc, .lp-floating-button, #lp-search-panel').count(), 0);
  assert.equal(await page.locator('#lp-pdf-toc a').count(), 8);
  assert.equal(await page.locator('.lp-page:not(.lp-pdf-entry-group)').count(), 4);
  assert.equal(await page.locator('.lp-pdf-references').textContent(), '引用资料');
  assert.equal(await page.locator('#lp-content > .lp-pdf-group').count(), 1, 'only pure groups need synthetic headings');
  assert.equal(await page.locator('.lp-pdf-entry-group h2').count(), 2, 'entry heading and its prose are moved once');
  assert.equal(await page.locator('h2').filter({hasText:'课题方案'}).count(), 1, 'entry group title is not duplicated');
  assert.equal(await page.locator('[id]').evaluateAll(els => new Set(els.map(el => el.id)).size === els.length), true, 'no duplicate anchor ids after entry splitting');
  const pdfPath = path.join(artifacts, 'entry-hierarchy.pdf');
  const htmlPath = path.join(artifacts, 'entry-hierarchy.html');
  await writeFile(htmlPath, exported.html);
  await writeFile(path.join(temporary, 'view.json'), JSON.stringify(view));
  const emptyEntry = await page.evaluate(input => {
    const html = Export.buildLongPage({ ...input, pages: [input.pages[0]], headHtml: Export.wrapCssInStyleTag(input.css), navigation: [{ title: '入口', href: 'entry.html', children: [{ title: '首个标题', href: 'entry.html#Heading_0', children: [] }] }] }).html;
    return Export.buildPdfPrintView(html, {toc:'目录',references:'引用资料'});
  }, input);
  await writeFile(path.join(temporary, 'empty-entry.json'), JSON.stringify(emptyEntry));
  const runner = path.join(temporary, 'native-test.cjs');
  await writeFile(runner, `const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {app, BrowserWindow} = require('electron');
app.on('window-all-closed', () => {});
const {exportLongPagePdf} = require(${JSON.stringify(nativeBundle)});
app.whenReady().then(async () => {
 const view = JSON.parse(await fs.readFile(${JSON.stringify(path.join(temporary, 'view.json'))}, 'utf8'));
 const factory = () => new BrowserWindow({show:false,width:1280,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 await exportLongPagePdf(view, ${JSON.stringify(pdfPath)}, factory);
 assert.equal(BrowserWindow.getAllWindows().length, 0, 'print window closed on success');
 const emptyEntry = JSON.parse(await fs.readFile(${JSON.stringify(path.join(temporary, 'empty-entry.json'))}, 'utf8'));
 await exportLongPagePdf(emptyEntry, ${JSON.stringify(path.join(temporary, 'empty-entry.pdf'))}, factory);
 const original = await fs.readFile(${JSON.stringify(pdfPath)});
 let failed = false;
 try { await exportLongPagePdf(view, ${JSON.stringify(pdfPath)}, () => { const win = factory(); win.webContents.printToPDF = async () => { throw new Error('simulated printer failure'); }; return win; }); }
 catch (error) { failed = error.message.includes('simulated printer failure'); }
 assert.equal(failed, true); assert.equal(BrowserWindow.getAllWindows().length, 0, 'print window closed on failure');
 assert.deepEqual(await fs.readFile(${JSON.stringify(pdfPath)}), original, 'failed export preserves previous PDF');
 assert.ok((await fs.readFile(${JSON.stringify(htmlPath)}, 'utf8')).includes('lp-search-toggle'), 'HTML preserved after failure');
 await fs.writeFile(${JSON.stringify(nativeReady)}, JSON.stringify({electron:process.versions.electron,chrome:process.versions.chrome}));
 app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });`);
  await new Promise((resolve, reject) => {
    const child = spawn(electronPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native Electron PDF test timed out: ' + output.slice(-3000))); }, 120000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error('Electron exited ' + code + ': ' + output.slice(-4000))); else resolve(); });
  });
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  const outlineRoot = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const readLevel = dict => {
    const nodes = []; let ref = dict.get(PDFName.of('First'));
    while (ref) {
      const item = pdf.context.lookup(ref, PDFDict), title = item.lookup(PDFName.of('Title'));
      const destination = item.lookup(PDFName.of('Dest'), PDFArray);
      assert.ok(destination.get(0) instanceof PDFRef, 'bookmark points to a PDF page');
      nodes.push({ title: title.decodeText(), children: readLevel(item), page: destination.get(0).toString(), destination: destination.toString() });
      ref = item.get(PDFName.of('Next'));
    }
    return nodes;
  };
  const bookmarks = readLevel(outlineRoot);
  const titles = nodes => nodes.map(node => ({ title: node.title, children: titles(node.children) }));
  assert.deepEqual(titles(bookmarks), titles(view.outline));
  assert.equal(bookmarks[0].children[0].children[0].destination, bookmarks[0].children[2].children[0].destination, 'duplicate entry aliases point to same physical note');
  let links = 0;
  for (const page of pdf.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annotations) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const annotation = annotations.lookup(i, PDFDict);
      if (annotation.get(PDFName.of('Dest'))) links++;
    }
  }
  assert.ok(links >= 9, 'clickable TOC and cross-note links remain internal PDF links');
  assert.ok(pdf.getPageCount() >= 3, 'TOC and reference section have page breaks');
  assert.ok(pdf.getPageCount() <= 4, 'compact fixture does not collapse into an unreadable zero-width layout');
  const noToc = await page.evaluate(html => { const parsed = new DOMParser().parseFromString(html,'text/html'); parsed.getElementById('lp-toc').remove(); return Export.buildPdfPrintView(parsed.documentElement.outerHTML, {toc:'目录',references:'引用资料'}); }, exported.html);
  assert.deepEqual(noToc.outline, []); assert.deepEqual(noToc.pageOrder, ['lp-page-0','lp-page-1','lp-page-2','lp-page-3']);
  const sourceLinks = await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const link = parsed.createElement('a'); link.href = 'attachments/report.pdf'; link.textContent = 'attachment';
    parsed.querySelector('.obsidian-document').appendChild(link);
    const result = Export.buildPdfPrintView(parsed.documentElement.outerHTML, {toc:'目录',references:'引用资料'}, 'file:///exports/book.html');
    const print = new DOMParser().parseFromString(result.html, 'text/html');
    return { attachment: Array.from(print.querySelectorAll('a')).find(a => a.textContent === 'attachment').getAttribute('href'), toc: print.querySelector('#lp-pdf-toc a').getAttribute('href') };
  }, exported.html);
  assert.equal(sourceLinks.attachment, 'file:///exports/attachments/report.pdf', 'attachments resolve beside original HTML rather than temporary print file');
  assert.equal(sourceLinks.toc, '#lp-page-0', 'hash links stay internal');

  console.log('PDF print view: entry preorder, grouping, duplicate notes, references and empty-tree export passed');
  console.log('Native Electron:', await readFile(nativeReady, 'utf8'));
  console.log('PDF:', pdf.getPageCount(), 'pages;', links, 'internal links; exact entry bookmarks; success/failure cleanup passed');
  console.log('Artifacts:', artifacts);
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
