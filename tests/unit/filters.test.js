import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, sortPosts, groupBySubreddit, sortGroups, resolveTimeRange, parseQuery, buildTimeline, commonSubreddits, defaultFilters, activeFilterChips, removeFilterChip } from '../../js/filters.js';
import { normalizePost } from '../../js/posts.js';
import { rawPost } from './fixtures.js';

const NOW = Date.UTC(2026, 10, 8, 12) / 1000;
const DAY = 86400;
const ctx = { source: 'arctic-shift', searchedAuthor: null, retrievedAt: NOW * 1000 };
const P = (o) => normalizePost(rawPost(o), ctx).post;

const posts = [
  P({ id: 'p1', author: 'Alice', subreddit: 'mycology', title: 'Austernpilze auf Kaffeesatz', selftext: 'Substrat und Feuchtigkeit', created_utc: NOW - 2 * DAY, score: 50 }),
  P({ id: 'p2', author: 'Alice', subreddit: 'woodworking', title: 'Eichentisch', selftext: '', is_self: false, post_hint: 'image', url: 'https://i.redd.it/a.jpg', preview: { images: [{ source: { url: 'https://i.redd.it/a.jpg' } }] }, created_utc: NOW - 20 * DAY, score: 500 }),
  P({ id: 'p3', author: 'Alice', subreddit: 'u_Alice', subreddit_type: 'user', title: 'Profilnotiz', created_utc: NOW - 40 * DAY }),
  P({ id: 'p4', author: 'Alice', subreddit: 'mycology', title: 'Crosspost Pilze', is_self: false, crosspost_parent: 't3_p1', created_utc: NOW - 100 * DAY, score: 5 }),
  P({ id: 'p5', author: 'Bob', subreddit: 'mycology', title: 'Ärger mit Schimmel', selftext: 'Grüner Belag', created_utc: Date.UTC(2023, 4, 1) / 1000, score: 1 }),
  P({ id: 'p6', author: 'Bob', subreddit: 'AskReddit', title: 'Zebra Frage', is_self: false, url: 'https://example.com', created_utc: Date.UTC(2021, 0, 1) / 1000, score: null })
];

const base = { ...defaultFilters({}), profile: false };

test('Profilposts sind standardmäßig ausgeblendet und einblendbar', () => {
  assert.ok(!applyFilters(posts, base).some((p) => p.isProfile));
  assert.ok(applyFilters(posts, { ...base, profile: true }).some((p) => p.isProfile));
});

test('Zeitfilter: Voreinstellungen, Jahr und frei wählbar', () => {
  assert.deepEqual(applyFilters(posts, { ...base, time: '7d' }, { nowSeconds: NOW }).map((p) => p.id), ['p1']);
  assert.deepEqual(applyFilters(posts, { ...base, time: '30d' }, { nowSeconds: NOW }).map((p) => p.id).sort(), ['p1', 'p2']);
  assert.deepEqual(applyFilters(posts, { ...base, time: 'year', year: 2023 }, { nowSeconds: NOW }).map((p) => p.id), ['p5']);
  assert.deepEqual(applyFilters(posts, { ...base, time: 'custom', from: '2020-12-31', to: '2021-01-01' }, { nowSeconds: NOW }).map((p) => p.id), ['p6']);
  const range = resolveTimeRange({ time: 'custom', from: '2024-01-01', to: '' });
  assert.equal(range.to, null);
});

test('Zeitraum aus der Zeitleiste hat Vorrang', () => {
  const period = { from: Date.UTC(2021, 0, 1) / 1000 - 86400, to: Date.UTC(2022, 0, 1) / 1000, label: '2021' };
  assert.deepEqual(applyFilters(posts, { ...base, period }).map((p) => p.id), ['p6']);
});

test('Textsuche: Titel, Text, Phrasen, Ausschluss, Umlaute', () => {
  assert.deepEqual(applyFilters(posts, { ...base, query: 'pilze' }).map((p) => p.id).sort(), ['p1', 'p4']);
  assert.deepEqual(applyFilters(posts, { ...base, query: 'feuchtigkeit', scope: 'title' }).map((p) => p.id), []);
  assert.deepEqual(applyFilters(posts, { ...base, query: 'feuchtigkeit', scope: 'body' }).map((p) => p.id), ['p1']);
  assert.deepEqual(applyFilters(posts, { ...base, query: 'pilze -crosspost' }).map((p) => p.id), ['p1']);
  assert.deepEqual(applyFilters(posts, { ...base, query: '"grüner belag"' }).map((p) => p.id), ['p5']);
  assert.deepEqual(applyFilters(posts, { ...base, query: 'arger' }).map((p) => p.id), ['p5']);
  assert.deepEqual(parseQuery('a "b c" -d'), { include: ['a', 'b c'], exclude: ['d'] });
});

test('Kombination aus Subreddit, Typ, Crossposts und Bildern', () => {
  assert.deepEqual(applyFilters(posts, { ...base, subreddits: ['mycology'] }).map((p) => p.id).sort(), ['p1', 'p4', 'p5']);
  assert.deepEqual(applyFilters(posts, { ...base, subreddits: ['mycology'], crossposts: false }).map((p) => p.id).sort(), ['p1', 'p5']);
  assert.deepEqual(applyFilters(posts, { ...base, types: ['image'] }).map((p) => p.id), ['p2']);
  assert.deepEqual(applyFilters(posts, { ...base, onlyImages: true }).map((p) => p.id), ['p2']);
  assert.deepEqual(applyFilters(posts, { ...base, onlyText: true, subreddits: ['mycology'], time: '7d' }, { nowSeconds: NOW }).map((p) => p.id), ['p1']);
});

test('Autorenvergleich: Filter und gemeinsame Subreddits', () => {
  assert.deepEqual([...commonSubreddits(posts, ['Alice', 'Bob'])], ['mycology']);
  assert.deepEqual(applyFilters(posts, { ...base, commonOnly: true }, { authors: ['Alice', 'Bob'] }).map((p) => p.id).sort(), ['p1', 'p4', 'p5']);
  assert.deepEqual(applyFilters(posts, { ...base, authors: ['Bob'] }).map((p) => p.id).sort(), ['p5', 'p6']);
});

test('Sortierung', () => {
  assert.deepEqual(sortPosts(posts, 'newest').map((p) => p.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(sortPosts(posts, 'oldest').map((p) => p.id), ['p6', 'p5', 'p4', 'p3', 'p2', 'p1']);
  assert.equal(sortPosts(posts, 'title')[0].id, 'p5');
  assert.equal(sortPosts(posts, 'title').at(-1).id, 'p6');
  assert.deepEqual(sortPosts(posts, 'subreddit').map((p) => p.subreddit), ['AskReddit', 'mycology', 'mycology', 'mycology', 'u_Alice', 'woodworking']);
  const byScore = sortPosts(posts, 'score').map((p) => p.id);
  assert.equal(byScore[0], 'p2');
  assert.equal(byScore.at(-1), 'p6', 'Beiträge ohne Score stehen am Ende');
});

test('Gruppierung nach Subreddit mit ältestem und neuestem Fund', () => {
  const groups = groupBySubreddit(posts);
  const myco = groups.find((g) => g.key === 'mycology');
  assert.equal(myco.count, 3);
  assert.equal(myco.crossposts, 1);
  assert.equal(myco.newest, NOW - 2 * DAY);
  assert.equal(myco.oldest, Date.UTC(2023, 4, 1) / 1000);
  assert.deepEqual(myco.byAuthor, { alice: 2, bob: 1 });
  assert.equal(sortGroups(groups, 'count')[0].key, 'mycology');
  assert.equal(sortGroups(groups, 'name')[0].key, 'askreddit');
  assert.equal(sortGroups(groups, 'recent')[0].key, 'mycology');
});

test('Zeitleiste ist lückenlos', () => {
  const tl = buildTimeline(posts, 'year');
  assert.equal(tl[0].label, '2021');
  assert.equal(tl.at(-1).label, '2026');
  assert.equal(tl.length, 6);
  assert.equal(tl.find((b) => b.label === '2022').count, 0);
  assert.equal(tl.reduce((s, b) => s + b.count, 0), posts.length);
});

test('Filterchips einzeln entfernen', () => {
  const defaults = defaultFilters({});
  const f = { ...defaults, query: 'x', subreddits: ['a', 'b'], types: ['image'], onlyImages: true };
  const chips = activeFilterChips(f, defaults, {});
  assert.equal(chips.length, 5);
  const next = removeFilterChip(f, 'sub:a', defaults);
  assert.deepEqual(next.subreddits, ['b']);
  assert.equal(removeFilterChip(f, 'onlyImages', defaults).onlyImages, false);
  assert.equal(removeFilterChip(f, 'query', defaults).query, '');
});
