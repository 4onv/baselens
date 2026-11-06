import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const actualUrl = new URL('../../dist/baselens.html', import.meta.url).href;

async function analyze(page, html, pageUrl = 'https://example.test/forum/topic.html') {
  await page.locator('#page-url').fill(pageUrl);
  await page.locator('#html-input').fill(html);
  await page.locator('#analyze-button').click();
}

async function report(page) {
  const download = page.waitForEvent('download');
  await page.locator('#download-button').click();
  const path = await (await download).path();
  return JSON.parse(await readFile(path, 'utf8'));
}

test.beforeEach(async ({ page }) => {
  await page.goto(actualUrl, { waitUntil: 'domcontentloaded' });
});

test('standalone demo, filters, search and JSON export work', async ({ page }) => {
  await expect(page.locator('#result-body tr').first()).toBeVisible();
  await analyze(page, '<base href="/"><a href="articles">News</a><a href="https://outside.test/">External</a><a href="mailto:hello@example.test">Email</a>');
  const r = await report(page);
  expect(r.links[0].resolved).toBe('https://example.test/articles');
  expect(r.links[0].withoutBase).toBe('https://example.test/forum/articles');
  expect(r.summary).toEqual({ total: 3, changed: 1, originChanged: 1, nonHttp: 1, invalid: 0 });
  await page.locator('#filter-select').selectOption('changed');
  await expect(page.locator('#result-body tr')).toHaveCount(1);
  await page.locator('#filter-select').selectOption('all');
  await page.locator('#search-input').fill('Outside');
  await expect(page.locator('#result-body tr')).toHaveCount(1);
  await expect(page.locator('#result-body')).toContainText('outside.test');
});

test('invalid first base, entities, nested templates and namespaces', async ({ page }) => {
  await analyze(page, '<base href="http://["><base href="https://other.test/"><template><base href="https://hidden.test/"><a href="hidden">Hidden</a></template><svg><a href="svg">SVG</a></svg><a href="?x=1&amp;y=2">A &amp; B</a><map><area href="#part" alt="Map"></map>');
  const r = await report(page);
  expect(r.base.status).toBe('invalid');
  expect(r.warnings[0]).toContain('Browser behavior can differ');
  await expect(page.locator('#base-explanation')).toContainText('target browser');
  expect(r.base.ignoredCount).toBe(1);
  expect(r.summary.total).toBe(2);
  expect(r.links[0].resolved).toBe('https://example.test/forum/topic.html?x=1&y=2');
  expect(r.links[0].text).toBe('A & B');
  expect(r.links[1].text).toBe('Map');
});

test('pasted active content stays inert and cannot make requests', async ({ page }) => {
  const requests = [];
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await analyze(page, '<base href="https://external.invalid/"><script>globalThis.pastedCodeRan=true</script><img src="https://external.invalid/image" onerror="globalThis.pastedCodeRan=true"><iframe src="https://external.invalid/frame"></iframe><link rel="stylesheet" href="https://external.invalid/style"><meta http-equiv="refresh" content="0;url=https://external.invalid/"><a href="javascript:globalThis.pastedCodeRan=true">&lt;img src=x onerror=alert(1)&gt;</a><a href="data:text/html,unsafe">Data</a>');
  const r = await report(page);
  expect(r.summary.nonHttp).toBe(2);
  expect(await page.evaluate(() => globalThis.pastedCodeRan)).toBeUndefined();
  expect(await page.locator('#result-body img, #result-body script, #result-body a').count()).toBe(0);
  expect(requests).toEqual([]);
});

test('invalid inputs remove stale output and disable export', async ({ page }) => {
  await analyze(page, '<a href="x">X</a>', 'file:///private/file.html');
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#download-button')).toBeDisabled();
  await analyze(page, '<a href="x">X</a>'.repeat(501));
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#download-button')).toBeDisabled();
  await analyze(page, '<frameset><frame src="frame.html"></frameset>');
  await expect(page.locator('#error-message')).toContainText('frameset');
  await expect(page.locator('#download-button')).toBeDisabled();
  await analyze(page, '<a href="x">Recovered</a>');
  expect((await report(page)).summary.total).toBe(1);
});

test('local file input analyzes text and rejects oversized files', async ({ page }) => {
  await page.locator('#file-input').setInputFiles({ name: 'synthetic.html', mimeType: 'text/html', buffer: Buffer.from('<base href="/docs/"><a href="guide">Guide</a>') });
  await page.locator('#analyze-button').click();
  expect((await report(page)).links[0].resolved).toContain('/docs/guide');
  await page.locator('#file-input').setInputFiles({ name: 'large.html', mimeType: 'text/html', buffer: Buffer.alloc(512 * 1024 + 1, 65) });
  await expect(page.locator('#error-message')).toBeVisible();
  await expect(page.locator('#download-button')).toBeDisabled();
  await page.locator('#file-input').setInputFiles({ name: 'invalid.html', mimeType: 'text/html', buffer: Buffer.from([0xff, 0xfe, 0x80]) });
  await expect(page.locator('#error-message')).toContainText('UTF-8');
});

test('mobile layout keeps primary controls within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const id of ['page-url', 'html-input', 'analyze-button', 'sample-select']) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(361);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);
});

test('resolutions match live browser DOM for trusted static fixtures', async ({ page, context }) => {
  const fixtures = [
    '<base href="/"><a href="articles">A</a><a href="#top">B</a>',
    '<base href="../assets/"><a href="./guide?q=a&amp;b=c">A</a><a href="//cdn.test/file">B</a>',
    '<base href="javascript:void(0)"><base href="/later/"><a href="item">A</a>',
    '<base target="_blank"><base href="https://other.test:443/docs/"><a href="?q=x">A</a>',
    '<template><base href="https://hidden.test/"></template><a href="item">A</a>',
    '<noscript><base href="/ignored/"><a href="wrong">Wrong</a></noscript><base href="/docs/"><a href="next">Next</a>',
  ];
  const native = await context.newPage();
  let documentHtml = '';
  await native.route('https://example.test/**', route => route.fulfill({ contentType: 'text/html', body: documentHtml }));
  for (const html of fixtures) {
    documentHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    await native.goto('https://example.test/forum/topic.html');
    const expected = await native.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.href));
    await analyze(page, documentHtml);
    const r = await report(page);
    expect(r.links.map(n => n.resolved)).toEqual(expected);
  }
  await native.close();
});
