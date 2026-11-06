import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLinks, LIMITS } from '../src/core.js';

const pageUrl = 'https://example.test/forum/topic?view=all#old';
const link = (href, text = href, tag = 'a') => ({ href, text, tag });
const analyze = (hrefs, baseHrefs = [], page = pageUrl) => analyzeLinks({
  pageUrl: page, bases: baseHrefs.map(href => ({ href })), links: hrefs.map(href => link(href)),
});

test('relative base produces exact browser and page-only destinations', () => {
  const result = analyze(['articles', '../help', '/status'], ['/docs/']);
  assert.equal(result.effectiveBase, 'https://example.test/docs/');
  assert.deepEqual(result.links.map(row => [row.resolved, row.withoutBase, row.changed]), [
    ['https://example.test/docs/articles', 'https://example.test/forum/articles', true],
    ['https://example.test/help', 'https://example.test/help', false],
    ['https://example.test/status', 'https://example.test/status', false],
  ]);
  assert.deepEqual(result.summary, { total: 3, changed: 1, originChanged: 0, nonHttp: 0, invalid: 0 });
});

test('absent base keeps empty, fragment and query links tied to the page', () => {
  const result = analyze(['', '#new', '?page=2']);
  assert.deepEqual(result.base, { status: 'absent', href: null, ignoredCount: 0, changesOrigin: false });
  assert.deepEqual(result.links.map(row => row.resolved), [
    'https://example.test/forum/topic?view=all',
    'https://example.test/forum/topic?view=all#new',
    'https://example.test/forum/topic?page=2',
  ]);
  assert.equal(result.summary.changed, 0);
});

test('base also redirects empty, fragment-only and query-only references', () => {
  const result = analyze(['', '#part', '?v=2'], ['https://cdn.test/assets/?v=1#base']);
  assert.deepEqual(result.links.map(row => row.resolved), [
    'https://cdn.test/assets/?v=1', 'https://cdn.test/assets/?v=1#part', 'https://cdn.test/assets/?v=2',
  ]);
  assert.equal(result.summary.changed, 3);
  assert.equal(result.summary.originChanged, 3);
  assert.equal(result.base.changesOrigin, true);
});

test('first base wins, including an empty first href', () => {
  const result = analyze(['next'], ['', '/ignored/', 'https://elsewhere.test/']);
  assert.equal(result.base.status, 'applied');
  assert.equal(result.base.href, '');
  assert.equal(result.base.ignoredCount, 2);
  assert.equal(result.effectiveBase, 'https://example.test/forum/topic?view=all');
  assert.equal(result.links[0].resolved, 'https://example.test/forum/next');
});

test('invalid first base falls back rather than selecting the second base', () => {
  const result = analyze(['next'], ['https://[invalid', '/must-not-win/']);
  assert.equal(result.base.status, 'invalid');
  assert.equal(result.effectiveBase, pageUrl);
  assert.equal(result.base.ignoredCount, 1);
  assert.equal(result.links[0].resolved, 'https://example.test/forum/next');
  assert.equal(result.links[0].changed, false);
});

test('javascript and data bases fall back and later valid bases stay ignored', () => {
  for (const href of ['JaVaScRiPt:alert(1)', 'data:text/html,hello', '\tjavascript:evil\n']) {
    const result = analyze(['next'], [href, '/must-not-win/']);
    assert.equal(result.base.status, 'disallowed');
    assert.equal(result.effectiveBase, pageUrl);
    assert.equal(result.links[0].resolved, 'https://example.test/forum/next');
  }
});

test('absolute targets and protocol-relative URLs use WHATWG normalization', () => {
  const result = analyze(['https://EXAMPLE.test:443/a', '//Elsewhere.test:443/b', '//example.test:444/c'], ['/docs/']);
  assert.deepEqual(result.links.map(row => [row.resolved, row.changed, row.originChanged]), [
    ['https://example.test/a', false, false],
    ['https://elsewhere.test/b', false, true],
    ['https://example.test:444/c', false, true],
  ]);
});

test('IDNA, Unicode path, percent dot segments and backslashes follow URL semantics', () => {
  const result = analyze(['../café', '%2e%2e/up', '\\next\\item'], ['/docs/'], 'https://bücher.example/root/index');
  assert.equal(result.pageUrl, 'https://xn--bcher-kva.example/root/index');
  assert.deepEqual(result.links.map(row => row.resolved), [
    'https://xn--bcher-kva.example/caf%C3%A9',
    'https://xn--bcher-kva.example/up',
    'https://xn--bcher-kva.example/next/item',
  ]);
});

test('non-http and invalid targets remain display values and are counted separately', () => {
  const result = analyze(['mailto:hello@example.test', 'javascript:alert(1)', 'data:text/html,hi', 'https://[bad']);
  assert.deepEqual(result.links.map(row => row.kind), ['non-http', 'non-http', 'non-http', 'invalid']);
  assert.deepEqual(result.links.map(row => row.originChanged), [false, false, false, false]);
  assert.equal(result.links[3].resolved, null);
  assert.equal(result.links[3].withoutBase, null);
  assert.equal(result.links[3].changed, false);
  assert.equal(result.summary.nonHttp, 3);
  assert.equal(result.summary.invalid, 1);
});

test('other schemes can form a base and unsupported relative targets fail individually', () => {
  const ftp = analyze(['next'], ['ftp://files.example.test/dir/']);
  assert.equal(ftp.base.status, 'applied');
  assert.equal(ftp.links[0].resolved, 'ftp://files.example.test/dir/next');
  assert.equal(ftp.links[0].kind, 'non-http');
  const opaque = analyze(['next', 'https://example.test/ok'], ['mailto:user@example.test']);
  assert.equal(opaque.base.status, 'applied');
  assert.equal(opaque.links[0].kind, 'invalid');
  assert.equal(opaque.links[0].changed, true);
  assert.equal(opaque.links[1].kind, 'http');
});

test('the same attributes preserve input text and order without mutation', () => {
  const input = { pageUrl, bases: [{ href: '/docs/' }], links: [link('next', '<b>Raw & text</b>', 'area')] };
  const before = JSON.stringify(input);
  const result = analyzeLinks(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.links[0].index, 1);
  assert.equal(result.links[0].tag, 'area');
  assert.equal(result.links[0].text, '<b>Raw & text</b>');
  result.links[0].href = 'changed';
  result.base.href = 'changed';
  assert.equal(JSON.stringify(input), before);
});

test('page URL requires absolute HTTP(S) and rejects embedded credentials', () => {
  for (const value of ['/relative', '', 'file:///tmp/a.html', 'data:text/html,a', 'https://u:p@example.test/', 'https://u@example.test/', 'https://[bad']) {
    assert.throws(() => analyze([], [], value), /absolute HTTP or HTTPS/);
  }
});

test('malformed records fail clearly instead of silently accepting missing fields', () => {
  const valid = { pageUrl, bases: [], links: [] };
  for (const value of [null, [], '', 0]) assert.throws(() => analyzeLinks(value), TypeError);
  for (const patch of [{ bases: null }, { links: {} }, { pageUrl: 42 }, { extra: true }]) {
    assert.throws(() => analyzeLinks({ ...valid, ...patch }), TypeError);
  }
  assert.throws(() => analyzeLinks({ ...valid, bases: Array(1) }), TypeError);
  assert.throws(() => analyzeLinks({ ...valid, links: Array(1) }), TypeError);
  for (const value of [null, {}, { href: 42 }, { href: '/a', extra: true }]) {
    assert.throws(() => analyzeLinks({ ...valid, bases: [value] }), TypeError);
  }
  for (const value of [null, {}, { ...link('a'), tag: 'script' }, { ...link('a'), text: null }, { ...link('a'), href: undefined }]) {
    assert.throws(() => analyzeLinks({ ...valid, links: [value] }), TypeError);
  }
});

test('all declared bounds are enforced at their boundary', () => {
  assert.equal(analyze(Array(LIMITS.maxLinks).fill('')).links.length, LIMITS.maxLinks);
  assert.throws(() => analyze(Array(LIMITS.maxLinks + 1).fill('')), RangeError);
  assert.equal(analyze([], Array(LIMITS.maxBases).fill('')).base.ignoredCount, LIMITS.maxBases - 1);
  assert.throws(() => analyze([], Array(LIMITS.maxBases + 1).fill('')), RangeError);
  assert.doesNotThrow(() => analyzeLinks({ pageUrl, bases: [], links: [link('x'.repeat(LIMITS.maxUrlLength), '')] }));
  assert.throws(() => analyze(['x'.repeat(LIMITS.maxUrlLength + 1)]), RangeError);
  assert.throws(() => analyze([], ['x'.repeat(LIMITS.maxUrlLength + 1)]), RangeError);
  assert.throws(() => analyze([], [], 'https://example.test/' + 'x'.repeat(LIMITS.maxUrlLength)), RangeError);
  assert.doesNotThrow(() => analyzeLinks({ pageUrl, bases: [], links: [link('', 'x'.repeat(LIMITS.maxTextLength))] }));
  assert.throws(() => analyzeLinks({ pageUrl, bases: [], links: [link('', 'x'.repeat(LIMITS.maxTextLength + 1))] }), RangeError);
});
