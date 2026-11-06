import { inspectHtml, MAX_HTML_BYTES } from './extract.js';

const samples = {
  'base-path': {
    pageUrl: 'https://example.test/guides/getting-started.html',
    html: '<!-- Synthetic example: a base changes relative links. -->\n<base href="/docs/v2/">\n\n<a href="install.html">Installation</a>\n<a href="../changelog">Release notes</a>\n<a href="#configuration">Configuration</a>\n<a href="/support">Contact support</a>\n<a href="https://status.example.test/">Service status</a>\n<a href="mailto:hello@example.test">Send an email</a>',
  },
  'external-base': {
    pageUrl: 'https://example.test/articles/launch.html',
    html: '<!-- Synthetic example: an external base changes origins. -->\n<base href="https://preview.example.test/review/">\n\n<a href="notes.html">Launch notes</a>\n<a href="/account">Your account</a>\n<a href="#overview">Overview</a>\n<a href="https://example.test/home">Explicit home URL</a>\n<a href="tel:+15550102030">Call the team</a>\n\n<!-- Later base elements do not replace the first. -->\n<base href="https://example.test/">',
  },
  'invalid-first': {
    pageUrl: 'https://example.test/docs/index.html',
    html: '<!-- Synthetic example: the invalid first base still wins. -->\n<base href="http://[invalid">\n<base href="https://cdn.example.test/">\n\n<a href="intro.html">Introduction</a>\n<a href="../about">About this project</a>\n<a href="#details">Details</a>\n<a href="http://[broken">An unresolvable URL</a>\n<a href="javascript:void(0)">A script URL, shown as text</a>',
  },
};

const byId = id => document.getElementById(id);
const form = byId('analyze-form');
const pageInput = byId('page-url');
const htmlInput = byId('html-input');
const searchInput = byId('search-input');
const filterSelect = byId('filter-select');
const statusMessage = byId('status-message');
const errorMessage = byId('error-message');
const downloadButton = byId('download-button');
const copyButton = byId('copy-button');
let report = null;
let source = 'Synthetic example';
let importGeneration = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clearOutput(message = '') {
  report = null;
  byId('results-section').hidden = true;
  byId('empty-state').hidden = false;
  downloadButton.disabled = true;
  copyButton.disabled = true;
  byId('result-body').replaceChildren();
  statusMessage.textContent = message;
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

function setSource(value) {
  source = value;
  byId('source-badge').textContent = value;
  byId('source-badge').classList.toggle('sample-badge', value === 'Synthetic example');
}

function fail(error) {
  clearOutput();
  errorMessage.textContent = error instanceof Error ? error.message : 'This document could not be analyzed.';
  errorMessage.hidden = false;
}

function analyze() {
  try {
    const nextReport = inspectHtml(htmlInput.value, pageInput.value);
    report = nextReport;
    errorMessage.hidden = true;
    errorMessage.textContent = '';
    byId('empty-state').hidden = true;
    byId('results-section').hidden = false;
    byId('result-context').textContent = source;
    byId('stat-total').textContent = report.summary.total;
    byId('stat-changed').textContent = report.summary.changed;
    byId('stat-origin').textContent = report.summary.originChanged;
    byId('stat-non-http').textContent = report.summary.nonHttp;
    byId('context-page').textContent = report.pageUrl;
    byId('context-raw').textContent = report.base.href === null ? 'No base[href] element' : report.base.href === '' ? '"" (empty attribute)' : report.base.href;
    byId('context-effective').textContent = report.effectiveBase;
    const baseLabels = { absent: 'Page URL used', applied: 'First base applied', invalid: 'Invalid first base', disallowed: 'Disallowed base scheme' };
    byId('base-status').textContent = baseLabels[report.base.status];
    const warning = report.base.status === 'invalid' || report.base.status === 'disallowed';
    byId('base-status').closest('.base-panel').classList.toggle('base-warning', warning);
    let explanation = report.base.status === 'absent'
      ? 'Each link resolves from the document’s page URL.'
      : report.base.status === 'applied'
        ? 'The first base[href] supplies the reference URL for relative links.'
        : 'This model falls back to the page URL. A later base does not take its place.';
    if (report.base.ignoredCount) explanation += ` ${report.base.ignoredCount} later base element${report.base.ignoredCount === 1 ? ' is' : 's are'} ignored.`;
    if (report.base.changesOrigin) explanation += ' The effective base has a different origin from the page.';
    if (report.base.status === 'invalid') explanation += ' Browser handling of malformed bases can differ. Treat these modeled destinations as a comparison aid and verify them in your target browser.';
    byId('base-explanation').textContent = explanation;
    downloadButton.disabled = false;
    copyButton.disabled = false;
    renderLinks();
    const truncated = report.extraction.truncatedLabels;
    statusMessage.textContent = `Analyzed ${report.summary.total} link${report.summary.total === 1 ? '' : 's'} locally.${truncated ? ` ${truncated} label${truncated === 1 ? ' was' : 's were'} shortened to 1,000 characters.` : ''}`;
  } catch (error) {
    fail(error);
  }
}

function renderLinks() {
  if (!report) return;
  const query = searchInput.value.toLowerCase();
  const filter = filterSelect.value;
  const matches = report.links.filter(row => {
    const selected = filter === 'all'
      || (filter === 'changed' && row.changed)
      || (filter === 'cross-origin' && row.originChanged)
      || (filter === 'non-http' && row.kind === 'non-http')
      || (filter === 'invalid' && row.kind === 'invalid');
    return selected && [row.text, row.href, row.resolved, row.withoutBase].some(value => value !== null && value.toLowerCase().includes(query));
  });
  const fragment = document.createDocumentFragment();
  for (const row of matches) {
    const tr = element('tr');
    const linkCell = element('td');
    const heading = element('div', 'row-heading');
    heading.append(element('span', 'row-index', `#${row.index}`), element('span', 'row-label', row.text || `(unlabeled ${row.tag})`));
    linkCell.append(heading, element('p', 'url-text source-href', row.href === '' ? '"" (empty href)' : row.href));
    const tags = element('div', 'row-tags');
    if (row.changed) tags.append(element('span', 'tag-changed', 'Changed by base'));
    if (row.originChanged) tags.append(element('span', 'tag-external', 'Cross-origin'));
    if (row.kind === 'non-http') tags.append(element('span', '', 'Non-HTTP'));
    if (row.kind === 'invalid') tags.append(element('span', 'tag-invalid', 'Unresolvable'));
    if (tags.childNodes.length) linkCell.append(tags);
    const resolvedCell = element('td');
    resolvedCell.append(element('p', `url-text resolved-url${row.changed ? ' changed-url' : ''}`, row.resolved ?? 'Cannot resolve this URL'));
    const fallbackCell = element('td');
    fallbackCell.append(element('p', 'url-text fallback-url', row.withoutBase ?? 'Cannot resolve this URL'));
    tr.append(linkCell, resolvedCell, fallbackCell);
    fragment.append(tr);
  }
  byId('result-body').replaceChildren(fragment);
  byId('visible-count').textContent = `${matches.length} of ${report.summary.total} links`;
  byId('no-results').hidden = matches.length > 0;
  byId('no-results').textContent = report.summary.total === 0 ? 'This document has no supported links with an href attribute.' : 'No links match these filters.';
}

function loadSample(key) {
  importGeneration++;
  const sample = samples[key];
  pageInput.value = sample.pageUrl;
  htmlInput.value = sample.html;
  setSource('Synthetic example');
  searchInput.value = '';
  filterSelect.value = 'all';
  analyze();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  analyze();
});
for (const input of [pageInput, htmlInput]) {
  input.addEventListener('input', () => {
    importGeneration++;
    setSource('Your document');
    clearOutput('Inputs changed. Analyze to refresh the results.');
  });
}
byId('sample-select').addEventListener('change', event => loadSample(event.target.value));
searchInput.addEventListener('input', renderLinks);
filterSelect.addEventListener('change', renderLinks);
byId('file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const generation = ++importGeneration;
  clearOutput();
  try {
    if (file.size > MAX_HTML_BYTES) throw new RangeError('This file exceeds the 512 KiB limit.');
    const buffer = await file.arrayBuffer();
    const html = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (generation !== importGeneration) return;
    clearOutput();
    htmlInput.value = html;
    setSource('Imported document');
    statusMessage.textContent = `Loaded ${file.name}. Check the page URL, then analyze the document.`;
  } catch (error) {
    if (generation !== importGeneration) return;
    fail(error instanceof TypeError ? new Error('This file must contain valid UTF-8 text.') : error);
  } finally {
    event.target.value = '';
  }
});

function reportJson() {
  return JSON.stringify({ ...report, provenance: { source, synthetic: source === 'Synthetic example' } }, null, 2) + '\n';
}

downloadButton.addEventListener('click', () => {
  if (!report) return;
  const blob = new Blob([reportJson()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'baselens-report.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  statusMessage.textContent = 'JSON download prepared. The report contains entered URLs and link text.';
});

copyButton.addEventListener('click', async () => {
  if (!report) return;
  const copiedReport = report;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(reportJson());
    if (report === copiedReport) statusMessage.textContent = 'JSON copied. Review the entered URLs and link text before sharing.';
  } catch {
    if (report === copiedReport) statusMessage.textContent = 'Clipboard access is unavailable here. Use Download JSON to save the report.';
  }
});

loadSample(byId('sample-select').value);
