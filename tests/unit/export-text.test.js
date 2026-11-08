import test from 'node:test';
import assert from 'node:assert/strict';
import { findingsToCsv, findingsToJson, findingsToMarkdown, csvCell, resultsExport, subredditsExport, mdEscape } from '../../js/export.js';
import { markdownToPlain, decodeEntities, safeHttpUrl, safeImageUrl, redditPermalink, excerpt } from '../../js/text.js';
import { externalSearchLinks } from '../../js/adapters/external-search.js';
import { RedditLocalAdapter } from '../../js/adapters/reddit-local.js';

const findings = [
  { id: 'abc1', url: 'https://www.reddit.com/r/pilze/comments/abc1/x/', subreddit: 'pilze', publishedUtc: 1700000000, savedAt: '2026-11-01T10:00:00.000Z', note: 'Größe: 5 cm; "wichtig"\nZweite Zeile', tags: ['Fund', 'Wald & Wiese'], collection: 'Herbst', favorite: true },
  { id: 'abc2', url: 'https://www.reddit.com/r/x/comments/abc2/', subreddit: 'x', publishedUtc: null, savedAt: '2026-11-02T10:00:00.000Z', note: '=HYPERLINK("http://evil")', tags: [], collection: '', favorite: false }
];

test('CSV: UTF-8-BOM, Quoting, Sonderzeichen und Formelschutz', () => {
  const csv = findingsToCsv(findings);
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv, /"Größe: 5 cm; ""wichtig""\nZweite Zeile"/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /Fund; Wald & Wiese/);
  assert.equal(csvCell('-1+2'), "'-1+2");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(true), 'ja');
});

test('JSON enthält nur Metadaten und eigene Angaben', () => {
  const data = JSON.parse(findingsToJson(findings));
  assert.equal(data.findings.length, 2);
  assert.deepEqual(Object.keys(data.findings[0]).sort(), ['collection', 'favorite', 'id', 'note', 'published', 'savedAt', 'subreddit', 'tags', 'url']);
  assert.equal(data.findings[0].published, '2023-11-14T22:13:20.000Z');
  assert.equal(data.findings[1].published, '');
});

test('Markdown maskiert Steuerzeichen', () => {
  const md = findingsToMarkdown([{ ...findings[0], subreddit: 'a_b*c', tags: ['[x](y)'] }]);
  assert.match(md, /r\/a\\_b\\\*c/);
  assert.match(md, /\\\[x\\\]\\\(y\\\)/);
  assert.match(md, /> Größe: 5 cm; "wichtig"/);
  assert.equal(mdEscape('<b>'), '\\<b\\>');
});

test('Ergebnisexport ohne Titel und Volltexte', () => {
  const post = { id: 'p1', permalink: 'https://www.reddit.com/r/a/comments/p1/', subreddit: 'a', createdUtc: 1700000000, type: 'text', isCrosspost: false, sources: ['arctic-shift'], title: 'GEHEIMER TITEL', text: 'VOLLTEXT' };
  for (const format of ['json', 'csv', 'md']) {
    const out = resultsExport([post], format, new Map([['p1', { tags: ['t'], note: 'n' }]]));
    assert.ok(!out.includes('GEHEIMER TITEL') && !out.includes('VOLLTEXT'), format);
    assert.ok(out.includes('p1'), format);
  }
});

test('Subreddit-Liste exportieren', () => {
  const groups = [{ key: 'a', name: 'a', count: 3, oldest: 1600000000, newest: 1700000000, isProfile: false }, { key: 'u_x', name: 'u_x', count: 1, oldest: 1, newest: 1, isProfile: true }];
  const csv = subredditsExport(groups, 'csv');
  assert.match(csv, /r\/a,3,/);
  assert.match(csv, /https:\/\/www\.reddit\.com\/user\/x\//);
  assert.equal(JSON.parse(subredditsExport(groups, 'json')).subreddits.length, 2);
  assert.match(subredditsExport(groups, 'md'), /\| \[r\/a\]/);
});

test('Fremdtexte: Markdown wird zu reinem Text, HTML bleibt Text', () => {
  const plain = markdownToPlain('**Fett** und [Link](https://x.y) &lt;script&gt;alert(1)&lt;/script&gt;\n\n# Titel\n> Zitat\n* Punkt');
  assert.equal(plain.includes('**'), false);
  assert.match(plain, /Fett und Link <script>alert\(1\)<\/script>/);
  assert.match(plain, /^Titel$/m);
  assert.match(plain, /• Punkt/);
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('&#x1F344;'), '🍄');
  assert.equal(decodeEntities('&#99999999;'), '&#99999999;');
});

test('URL-Validierung', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,x'), null);
  assert.equal(safeHttpUrl('https://user:pw@example.com/'), null);
  assert.equal(safeHttpUrl('https://example.com/a?b=1&amp;c=2'), 'https://example.com/a?b=1&c=2');
  assert.equal(safeImageUrl('https://evil.example/x.png'), null);
  assert.equal(safeImageUrl('http://i.redd.it/x.png'), null);
  assert.equal(safeImageUrl('https://i.redd.it/x.png'), 'https://i.redd.it/x.png');
  assert.equal(redditPermalink('//evil.com/x', 'abc'), 'https://www.reddit.com/comments/abc/');
  assert.equal(redditPermalink(null, '../x'), null);
});

test('Auszüge kürzen an Wortgrenzen', () => {
  const text = 'Wort '.repeat(100);
  const ex = excerpt(text, 50);
  assert.ok(ex.length <= 52);
  assert.ok(ex.endsWith('…'));
});

test('Externe Suchlinks sind korrekt kodiert', () => {
  const links = externalSearchLinks('Beispiel_User');
  assert.ok(links.some((l) => l.query === 'site:reddit.com/r/ "Beispiel_User"'));
  for (const l of links) assert.match(l.url, /^https:\/\//);
  assert.ok(links.every((l) => !l.url.includes(' ')));
});

test('Reddit-Adapter akzeptiert nur lokale Adressen', () => {
  assert.equal(RedditLocalAdapter.validateBaseUrl('http://127.0.0.1:8791/'), 'http://127.0.0.1:8791');
  assert.equal(RedditLocalAdapter.validateBaseUrl('http://localhost:9000'), 'http://localhost:9000');
  assert.throws(() => RedditLocalAdapter.validateBaseUrl('https://proxy.example.com'));
  assert.throws(() => RedditLocalAdapter.validateBaseUrl('kein-url'));
});
