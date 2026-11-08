/**
 * Exportfunktionen. Exportiert werden ausschließlich Metadaten (URL, ID,
 * Subreddit, Datum) und eigene Angaben (Notiz, Tags, Sammlung) – keine
 * fremden Volltexte.
 */

const FINDING_FIELDS = [
  ['url', 'URL'],
  ['id', 'Post-ID'],
  ['subreddit', 'Subreddit'],
  ['published', 'Veröffentlicht (UTC)'],
  ['savedAt', 'Gespeichert am'],
  ['tags', 'Tags'],
  ['collection', 'Sammlung'],
  ['favorite', 'Favorit'],
  ['note', 'Notiz']
];

const iso = (seconds) => (Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : '');

export function findingRow(f) {
  return {
    url: f.url ?? '',
    id: f.id ?? '',
    subreddit: f.subreddit ?? '',
    published: iso(f.publishedUtc),
    savedAt: f.savedAt ?? '',
    tags: Array.isArray(f.tags) ? f.tags : [],
    collection: f.collection ?? '',
    favorite: Boolean(f.favorite),
    note: f.note ?? ''
  };
}

/** Schützt vor Formel-Injektion in Tabellenkalkulationen und quotiert nach RFC 4180. */
export function csvCell(value) {
  let text = Array.isArray(value) ? value.join('; ') : typeof value === 'boolean' ? (value ? 'ja' : 'nein') : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows, fields) {
  const lines = [fields.map(([, label]) => csvCell(label)).join(',')];
  for (const row of rows) lines.push(fields.map(([key]) => csvCell(row[key])).join(','));
  // BOM, damit Excel UTF-8 korrekt erkennt.
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

export function mdEscape(value) {
  return String(value ?? '').replace(/([\\`*_{}[\]()#+!|<>~])/g, '\\$1').replace(/\r?\n/g, ' ');
}

export function findingsToJson(findings) {
  return JSON.stringify({ format: 'reddit-investigator-findings', version: 1, exportedAt: new Date().toISOString(), findings: findings.map(findingRow) }, null, 2);
}

export function findingsToCsv(findings) {
  return toCsv(findings.map(findingRow), FINDING_FIELDS);
}

export function findingsToMarkdown(findings) {
  const lines = ['# Reddit Investigator – Fundstellen', '', `Exportiert: ${new Date().toISOString()}`, ''];
  for (const f of findings.map(findingRow)) {
    lines.push(`## r/${mdEscape(f.subreddit)} · ${mdEscape(f.id)}`);
    lines.push('');
    if (f.url) lines.push(`- Link: <${f.url.replace(/[<>\s]/g, encodeURIComponent)}>`);
    if (f.published) lines.push(`- Veröffentlicht: ${f.published}`);
    lines.push(`- Gespeichert: ${mdEscape(f.savedAt)}`);
    if (f.tags.length) lines.push(`- Tags: ${f.tags.map(mdEscape).join(', ')}`);
    if (f.collection) lines.push(`- Sammlung: ${mdEscape(f.collection)}`);
    if (f.favorite) lines.push('- Favorit: ja');
    if (f.note) {
      lines.push('');
      for (const line of String(f.note).split(/\r?\n/)) lines.push(`> ${mdEscape(line)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const RESULT_FIELDS = [
  ['url', 'URL'],
  ['id', 'Post-ID'],
  ['subreddit', 'Subreddit'],
  ['published', 'Veröffentlicht (UTC)'],
  ['type', 'Typ'],
  ['crosspost', 'Crosspost'],
  ['sources', 'Quellen'],
  ['tags', 'Lokale Tags'],
  ['note', 'Eigene Notiz']
];

/** Gefilterte Ergebnisliste als Metadaten-Export (ohne Titel/Text). */
export function resultRows(posts, findingsById = new Map()) {
  return posts.map((p) => {
    const f = findingsById.get(p.id);
    return {
      url: p.permalink ?? '',
      id: p.id,
      subreddit: p.subreddit,
      published: iso(p.createdUtc),
      type: p.type,
      crosspost: p.isCrosspost,
      sources: p.sources.join(', '),
      tags: f?.tags ?? [],
      note: f?.note ?? ''
    };
  });
}

export function resultsExport(posts, format, findingsById) {
  const rows = resultRows(posts, findingsById);
  if (format === 'csv') return toCsv(rows, RESULT_FIELDS);
  if (format === 'md') {
    const lines = ['# Reddit Investigator – Gefilterte Ergebnisse', '', `Exportiert: ${new Date().toISOString()}`, '', '| Datum (UTC) | Subreddit | Typ | Link |', '|---|---|---|---|'];
    for (const r of rows) lines.push(`| ${r.published.slice(0, 10)} | r/${mdEscape(r.subreddit)} | ${mdEscape(r.type)}${r.crosspost ? ' (Crosspost)' : ''} | <${r.url}> |`);
    return `${lines.join('\n')}\n`;
  }
  return JSON.stringify({ format: 'reddit-investigator-results', version: 1, exportedAt: new Date().toISOString(), results: rows }, null, 2);
}

const SUBREDDIT_FIELDS = [
  ['name', 'Subreddit'],
  ['count', 'Gefundene Beiträge'],
  ['oldest', 'Ältester gefundener Beitrag (UTC)'],
  ['newest', 'Neuester gefundener Beitrag (UTC)'],
  ['url', 'URL']
];

export function subredditsExport(groups, format) {
  const rows = groups.map((g) => ({
    name: g.isProfile ? g.name : `r/${g.name}`,
    count: g.count,
    oldest: iso(g.oldest),
    newest: iso(g.newest),
    url: g.isProfile ? `https://www.reddit.com/user/${encodeURIComponent(g.name.replace(/^u_/i, ''))}/` : `https://www.reddit.com/r/${encodeURIComponent(g.name)}/`
  }));
  if (format === 'csv') return toCsv(rows, SUBREDDIT_FIELDS);
  if (format === 'md') {
    const lines = ['# Reddit Investigator – Gefundene Subreddits', '', '| Subreddit | Gefundene Beiträge | Ältester | Neuester |', '|---|---:|---|---|'];
    for (const r of rows) lines.push(`| [${mdEscape(r.name)}](<${r.url}>) | ${r.count} | ${r.oldest.slice(0, 10)} | ${r.newest.slice(0, 10)} |`);
    return `${lines.join('\n')}\n`;
  }
  return JSON.stringify({ format: 'reddit-investigator-subreddits', version: 1, exportedAt: new Date().toISOString(), subreddits: rows }, null, 2);
}

export const MIME = { json: 'application/json;charset=utf-8', csv: 'text/csv;charset=utf-8', md: 'text/markdown;charset=utf-8' };

export function downloadText(filename, content, format) {
  const blob = new Blob([content], { type: MIME[format] ?? 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
