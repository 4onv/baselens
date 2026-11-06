import { analyzeLinks, LIMITS } from './core.js';

export const MAX_HTML_BYTES = 512 * 1024;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** Parse a static HTML fragment in an inert template. Never attach its nodes. */
export function inspectHtml(html, pageUrl) {
  if (typeof html !== 'string') throw new TypeError('HTML must be text.');
  if (html.length > MAX_HTML_BYTES || new TextEncoder().encode(html).length > MAX_HTML_BYTES) {
    throw new RangeError('HTML exceeds the 512 KiB limit.');
  }
  // A fragment parser drops frameset tags that would suppress body links in a
  // full document. Conservatively reject this marker, including quoted examples.
  if (/<frameset(?:\s|>|\/)/i.test(html)) {
    throw new TypeError('HTML contains a frameset marker. Inspect a body fragment instead.');
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const bases = [];
  const links = [];
  let truncatedLabels = 0;
  let ignoredNoscriptNodes = 0;
  for (const el of template.content.querySelectorAll('base[href], a[href], area[href]')) {
    if (el.namespaceURI !== HTML_NAMESPACE) continue;
    // Inert templates parse noscript contents as markup. A scripting-enabled
    // document treats them as text, so their apparent links and bases stay out.
    let inNoscript = false;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.namespaceURI === HTML_NAMESPACE && parent.localName === 'noscript') {
        inNoscript = true;
        break;
      }
    }
    if (inNoscript) {
      ignoredNoscriptNodes++;
      continue;
    }
    const href = el.getAttribute('href');
    if (el.localName === 'base') {
      bases.push({ href });
      if (bases.length > LIMITS.maxBases) throw new RangeError(`At most ${LIMITS.maxBases} base elements are supported.`);
    } else {
      // textContent reads text without executing markup or triggering layout.
      const label = (el.localName === 'area' ? el.getAttribute('alt') || '' : el.textContent).replace(/\s+/g, ' ').trim();
      if (label.length > LIMITS.maxTextLength) truncatedLabels++;
      links.push({ href, text: label.slice(0, LIMITS.maxTextLength), tag: el.localName });
      if (links.length > LIMITS.maxLinks) throw new RangeError(`At most ${LIMITS.maxLinks} links are supported.`);
    }
  }
  return { ...analyzeLinks({ pageUrl, bases, links }), extraction: { mode: 'inert-template', truncatedLabels, ignoredNoscriptNodes } };
}
