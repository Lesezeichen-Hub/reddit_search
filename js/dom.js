/** Kleiner DOM-Baukasten. Fremdtexte landen ausschließlich in Textknoten. */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'style' && typeof value === 'object') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(document.createTextNode(String(child)));
  }
}

/** Wie replaceChildren, ignoriert aber null/false und flacht Arrays ab. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

/** Externer Link mit sicheren Attributen; ungültige URLs ergeben einen deaktivierten Platzhalter. */
export function extLink(href, content, attrs = {}) {
  if (!href || !/^https?:\/\//i.test(href)) return h('span', { class: `${attrs.class ?? ''} disabled`, 'aria-disabled': 'true' }, content);
  return h('a', { ...attrs, href, target: '_blank', rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer' }, content);
}

export function button(label, { iconName, cls = 'btn', action, title, data = {}, attrs = {} } = {}) {
  return h('button', { type: 'button', class: cls, title, 'data-action': action, dataset: data, ...attrs }, iconName ? icon(iconName) : null, label ? h('span', null, label) : null);
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const numFmt = new Intl.NumberFormat('de-DE');

export const fmt = {
  date: (s) => (Number.isFinite(s) ? dateFmt.format(new Date(s * 1000)) : '–'),
  time: (s) => (Number.isFinite(s) ? timeFmt.format(new Date(s * 1000)) : ''),
  long: (s) => (Number.isFinite(s) ? longFmt.format(new Date(s * 1000)) : '–'),
  dateTime: (s) => (Number.isFinite(s) ? `${dateFmt.format(new Date(s * 1000))}, ${timeFmt.format(new Date(s * 1000))}` : '–'),
  iso: (s) => (Number.isFinite(s) ? new Date(s * 1000).toISOString() : ''),
  num: (n) => (Number.isFinite(n) ? numFmt.format(n) : '–'),
  relative(s, now = Date.now() / 1000) {
    if (!Number.isFinite(s)) return '';
    const diff = now - s;
    const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
    const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [sec, unit] of units) if (Math.abs(diff) >= sec) return rtf.format(-Math.round(diff / sec), unit);
    return 'gerade eben';
  },
  plural: (n, one, many) => `${numFmt.format(n)} ${n === 1 ? one : many}`
};

export function debounce(fn, wait = 200) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { class: 'sr-only', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** Deterministische Farbe (Farbton) für Subreddit-Monogramme. */
export function hueFor(name) {
  let hash = 0;
  for (const ch of String(name).toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function monogram(name, cls = 'mono-avatar') {
  const clean = String(name).replace(/^u_/i, '');
  return h('span', { class: cls, 'aria-hidden': 'true', style: { '--hue': String(hueFor(clean)) } }, clean.slice(0, 1).toUpperCase());
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
