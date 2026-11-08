import { IMAGE_HOSTS } from './config.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'", '#x27': "'", '#x200B': '' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code in ENTITIES) return ENTITIES[code];
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith('#x')) return safeCodePoint(parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith('#')) return safeCodePoint(parseInt(lower.slice(1), 10), whole);
    return whole;
  });
}

function safeCodePoint(n, fallback) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return fallback;
  try { return String.fromCodePoint(n); } catch { return fallback; }
}

/**
 * Wandelt Reddit-Markdown in reinen Text um. Das Ergebnis wird ausschließlich
 * über textContent eingefügt; es entsteht nie HTML aus Fremdinhalten.
 */
export function markdownToPlain(markdown) {
  let text = decodeEntities(markdown).replace(/\r\n?/g, '\n');
  text = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, '').trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>!?\s?/gm, '')
    .replace(/!<|>!/g, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\^\(([^)]*)\)/g, '$1')
    .replace(/&#x200B;|\u200b/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~^])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function excerpt(text, max = 280) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max).trimEnd()} …`;
}

/** Nur http(s)-URLs ohne Zugangsdaten werden akzeptiert. */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let url;
  try {
    url = new URL(decodeEntities(value.trim()));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

export function safeImageUrl(value) {
  const href = safeHttpUrl(value);
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.includes(url.hostname)) return null;
  return url.href;
}

export function redditPermalink(permalink, id) {
  if (typeof permalink === 'string' && /^\/(?:r|user|u)\/[^\s]+$/.test(permalink)) {
    try {
      return new URL(permalink, 'https://www.reddit.com').href;
    } catch {
      /* fällt auf Kurzlink zurück */
    }
  }
  if (typeof id === 'string' && /^[a-z0-9]{1,13}$/i.test(id)) return `https://www.reddit.com/comments/${id}/`;
  return null;
}

/** Entfernt Diakritika und vereinheitlicht Groß-/Kleinschreibung für die lokale Suche. */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de');
}
