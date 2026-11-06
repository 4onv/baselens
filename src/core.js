/** URL analysis for inert, already-extracted HTML link attributes. */
export const LIMITS = Object.freeze({
  maxLinks: 500,
  maxBases: 20,
  maxUrlLength: 8192,
  maxTextLength: 1000,
});

function record(value, allowed, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} has an unknown field`);
  }
}

function string(value, maximum, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  if (value.length > maximum) throw new RangeError(`${label} exceeds ${maximum} characters`);
  return value;
}

function list(value, maximum, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > maximum) throw new RangeError(`${label} exceeds ${maximum} entries`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${label} must not have missing entries`);
  }
}

function resolve(href, base) {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

function isHttp(url) {
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

/**
 * Compare links resolved with the first HTML base[href] against the page URL.
 * Only the supplied attributes are analyzed. This function performs no I/O.
 * URL parsing follows the host runtime's WHATWG URL implementation.
 * Input records are never mutated. Returned raw values are text, not markup.
 */
export function analyzeLinks(input) {
  record(input, ['pageUrl', 'bases', 'links'], 'input');
  const { pageUrl, bases, links } = input;
  string(pageUrl, LIMITS.maxUrlLength, 'pageUrl');
  list(bases, LIMITS.maxBases, 'bases');
  list(links, LIMITS.maxLinks, 'links');
  const page = resolve(pageUrl);
  if (!isHttp(page) || page.username || page.password) {
    throw new TypeError('pageUrl must be an absolute HTTP or HTTPS URL without credentials');
  }

  // Validate all entries, including ignored bases, so malformed captures fail clearly.
  bases.forEach((base, index) => {
    record(base, ['href'], `bases[${index}]`);
    string(base.href, LIMITS.maxUrlLength, `bases[${index}].href`);
  });
  links.forEach((link, index) => {
    record(link, ['href', 'text', 'tag'], `links[${index}]`);
    string(link.href, LIMITS.maxUrlLength, `links[${index}].href`);
    string(link.text, LIMITS.maxTextLength, `links[${index}].text`);
    if (link.tag !== 'a' && link.tag !== 'area') {
      throw new TypeError(`links[${index}].tag must be a or area`);
    }
  });

  let effective = page;
  const base = {
    status: 'absent',
    href: null,
    ignoredCount: Math.max(0, bases.length - 1),
    changesOrigin: false,
  };
  if (bases.length > 0) {
    base.href = bases[0].href;
    const candidate = resolve(base.href, page);
    if (candidate === null) {
      base.status = 'invalid';
    } else if (candidate.protocol === 'data:' || candidate.protocol === 'javascript:') {
      base.status = 'disallowed';
    } else {
      base.status = 'applied';
      effective = candidate;
      base.changesOrigin = candidate.origin !== page.origin;
    }
  }

  const rows = links.map((link, index) => {
    const target = resolve(link.href, effective);
    const fallback = resolve(link.href, page);
    const resolved = target?.href ?? null;
    const withoutBase = fallback?.href ?? null;
    return {
      index: index + 1,
      tag: link.tag,
      text: link.text,
      href: link.href,
      resolved,
      withoutBase,
      changed: resolved !== withoutBase,
      // A non-HTTP URL is classified separately. It is never a navigable app link.
      originChanged: isHttp(target) && target.origin !== page.origin,
      kind: target === null ? 'invalid' : isHttp(target) ? 'http' : 'non-http',
    };
  });
  return {
    version: 1,
    model: 'static-first-base-url',
    warnings: base.status === 'invalid' ? ['Invalid first base: the model uses the page URL fallback. Browser behavior can differ; verify this case in the target browser.'] : [],
    pageUrl: page.href,
    effectiveBase: effective.href,
    base,
    links: rows,
    summary: {
      total: rows.length,
      changed: rows.filter(row => row.changed).length,
      originChanged: rows.filter(row => row.originChanged).length,
      nonHttp: rows.filter(row => row.kind === 'non-http').length,
      invalid: rows.filter(row => row.kind === 'invalid').length,
    },
  };
}
