import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcticShiftAdapter, coverWindows } from '../../js/adapters/arctic-shift.js';
import { RequestScheduler } from '../../js/net.js';
import { SOURCES } from '../../js/config.js';
import { SearchSession } from '../../js/search-engine.js';
import { jsonResponse, mockFetch, rawPost } from './fixtures.js';

const NOW = Date.UTC(2026, 10, 8) / 1000;
const Y = (year, month = 0, day = 1) => Date.UTC(year, month, day) / 1000;

/** Simuliertes Archiv (Mock) mit dokumentiertem Verhalten: before exklusiv, limit ≤ 100, sort=desc. */
function fakeArchive(posts, { failAggregate = false, zeroAggregate = false, timeoutWhen = null, onSearch, autoSize = 120 } = {}) {
  return mockFetch((url) => {
    const p = url.searchParams;
    const own = (list) => list.filter((x) => x.author.toLowerCase() === String(p.get('author')).toLowerCase());
    if (url.pathname === '/api/posts/search/aggregate') {
      if (failAggregate) return jsonResponse({ error: 'Query timed out' }, { status: 422 });
      if (p.get('aggregate') === 'subreddit') {
        const counts = {};
        for (const post of own(posts)) counts[post.subreddit] = (counts[post.subreddit] ?? 0) + 1;
        return jsonResponse({ data: Object.entries(counts).map(([key, count]) => ({ key, count: String(count) })) });
      }
      assert.equal(p.get('after'), '2005-01-01');
      const data = [];
      for (let year = 2005; year <= 2026; year += 1) {
        const count = own(posts).filter((x) => x.created_utc >= Y(year) && x.created_utc < Y(year + 1)).length;
        data.push({ created_utc: new Date(Y(year) * 1000 - 3600000).toISOString(), count: String(zeroAggregate ? 0 : count) });
      }
      return jsonResponse({ data });
    }
    if (url.pathname === '/api/posts/search') {
      const rawLimit = p.get('limit');
      const limit = rawLimit === 'auto' ? autoSize : Number(rawLimit);
      assert.ok(rawLimit === 'auto' || (limit >= 1 && limit <= 100), 'limit im dokumentierten Bereich');
      assert.equal(p.get('sort'), 'desc');
      const after = Number(p.get('after'));
      const before = Number(p.get('before'));
      onSearch?.({ after, before });
      if (timeoutWhen?.({ after, before })) return jsonResponse({ error: 'Query timed out' }, { status: 422 });
      const hits = posts
        .filter((x) => x.author.toLowerCase() === p.get('author').toLowerCase() && x.created_utc >= after && x.created_utc < before)
        .sort((a, b) => b.created_utc - a.created_utc)
        .slice(0, limit);
      return jsonResponse({ data: hits });
    }
    return jsonResponse({ error: 'unbekannt' }, { status: 404 });
  });
}

function adapterFor(fetchImpl) {
  const scheduler = new RequestScheduler({ fetchImpl, minIntervalMs: 0, retries: 1, baseDelayMs: 1, isOnline: () => true, sleepImpl: () => Promise.resolve() });
  return new ArcticShiftAdapter({ scheduler, config: { ...SOURCES.arcticShift, concurrency: 2 }, now: () => NOW * 1000 });
}

function makePosts() {
  const posts = [];
  // 140 Beiträge 2019, 90 Beiträge 2024, 20 Beiträge 2026 – inkl. mehrerer Beiträge in derselben Sekunde.
  for (let i = 0; i < 140; i += 1) posts.push(rawPost({ id: `a${i}`, created_utc: Y(2019, 5) + Math.floor(i / 3) * 60, subreddit: i % 2 ? 'mycology' : 'woodworking' }));
  for (let i = 0; i < 90; i += 1) posts.push(rawPost({ id: `b${i}`, created_utc: Y(2024, 2) + i * 3600, subreddit: 'photography' }));
  for (let i = 0; i < 20; i += 1) posts.push(rawPost({ id: `c${i}`, created_utc: Y(2026, 1) + i * 86400, subreddit: i < 5 ? 'u_TestUser' : 'AskReddit', subreddit_type: i < 5 ? 'user' : 'public' }));
  posts.push(rawPost({ id: 'other', author: 'Fremd', created_utc: Y(2024, 3) }));
  return posts;
}

async function runSearch(fetchImpl, opts = {}) {
  const adapter = adapterFor(fetchImpl);
  const seen = [];
  const result = await adapter.search({ author: 'TestUser', maxResults: Infinity, onPage: (list) => seen.push(...list), ...opts });
  return { result, seen };
}

test('lädt alle Beiträge über mehrere Seiten und Zeitfenster ohne Dubletten', async () => {
  const fetchImpl = fakeArchive(makePosts());
  const { result, seen } = await runSearch(fetchImpl);
  assert.equal(seen.length, 250);
  assert.equal(new Set(seen.map((p) => p.id)).size, 250);
  assert.equal(result.expectedTotal, 250);
  assert.equal(result.completeness, 'complete');
  assert.equal(result.expectedBySubreddit.get('mycology'), 70);
  assert.ok(fetchImpl.calls.some((u) => u.includes('before=')), 'Fortsetzung über before-Cursor');
});

test('Zeitfenster decken den gesamten Zeitraum lückenlos ab', () => {
  const buckets = [
    { from: Y(2005), to: Y(2006), expected: 0 },
    { from: Y(2006), to: Y(2007), expected: 0 },
    { from: Y(2007), to: Y(2008), expected: 3 },
    { from: Y(2008), to: Y(2009), expected: 0 },
    { from: Y(2009), to: Y(2010), expected: 5 }
  ];
  const windows = coverWindows(buckets, { from: Y(2005, 5), to: NOW + 86400 }, 4);
  assert.deepEqual(windows.map((w) => w.expected), [3, 5]);
  for (let i = 1; i < windows.length; i += 1) assert.equal(windows[i].from, windows[i - 1].to);
  assert.equal(windows[0].from, Y(2005));
  assert.equal(windows.at(-1).to, NOW + 86400);
  assert.equal(coverWindows(buckets, { from: Y(2005), to: NOW }).length, 1, 'kleine Buckets werden zusammengefasst');
});

test('fehlerhafter Index (nur Nullen) führt nicht zu fehlenden Beiträgen', async () => {
  const { seen } = await runSearch(fakeArchive(makePosts(), { zeroAggregate: true }));
  assert.equal(seen.length, 250);
});

test('ohne Archivindex wird der Gesamtzeitraum durchsucht und Vollständigkeit als unbekannt markiert', async () => {
  const { result, seen } = await runSearch(fakeArchive(makePosts(), { failAggregate: true }));
  assert.equal(seen.length, 250);
  assert.equal(result.completeness, 'unknown');
  assert.ok(result.issues.some((i) => i.kind === 'index'));
});

test('Abfrage-Timeouts teilen das Zeitfenster auf', async () => {
  const ranges = [];
  let fails = 0;
  const fetchImpl = fakeArchive(makePosts(), {
    onSearch: (r) => ranges.push(r),
    timeoutWhen: ({ after, before }) => {
      if (after <= Y(2019, 5) && before - after > 120 * 86400 && before > Y(2019, 5)) { fails += 1; return true; }
      return false;
    }
  });
  const { result, seen } = await runSearch(fetchImpl);
  assert.ok(fails > 0);
  assert.equal(seen.length, 250);
  assert.equal(result.completeness, 'complete');
  assert.ok(ranges.some((r) => r.before - r.after <= 120 * 86400), 'kleinere Fenster wurden abgefragt');
});

test('Höchstzahl stoppt die Suche und kennzeichnet sie als unvollständig', async () => {
  const { result, seen } = await runSearch(fakeArchive(makePosts()), { maxResults: 100 });
  assert.ok(seen.length >= 100 && seen.length < 250);
  assert.equal(result.completeness, 'incomplete');
  assert.ok(result.issues.some((i) => i.kind === 'max-results'));
});

test('dauerhafte Fehler in einem Fenster werden als Lücke gemeldet', async () => {
  const fetchImpl = fakeArchive(makePosts(), { timeoutWhen: ({ after, before }) => after < Y(2025) && before > Y(2024) });
  const adapter = adapterFor(fetchImpl);
  adapter.config = { ...adapter.config, minSplitSeconds: 400 * 86400 };
  const seen = [];
  const result = await adapter.search({ author: 'TestUser', onPage: (l) => seen.push(...l) });
  assert.equal(result.completeness, 'incomplete');
  assert.ok(result.issues.some((i) => i.severity === 'gap' && i.range));
  assert.equal(seen.length, 160);
});

test('Seitengröße 100 (numerisch) und kleine auto-Seiten funktionieren ebenfalls', async () => {
  const fetchImpl = fakeArchive(makePosts());
  const scheduler = new RequestScheduler({ fetchImpl, minIntervalMs: 0, retries: 0, isOnline: () => true, sleepImpl: () => Promise.resolve() });
  const adapter = new ArcticShiftAdapter({ scheduler, config: { ...SOURCES.arcticShift, pageSize: 100 }, now: () => NOW * 1000 });
  const seen = [];
  const result = await adapter.search({ author: 'TestUser', onPage: (l) => seen.push(...l) });
  assert.equal(new Set(seen.map((p) => p.id)).size, 250);
  assert.equal(result.completeness, 'complete');
  const small = await runSearch(fakeArchive(makePosts(), { autoSize: 100 }));
  assert.equal(small.seen.length, 250);
});

test('Serverausfall mitten in der Suche beendet vorzeitig und kennzeichnet Lücken', async () => {
  let searches = 0;
  const inner = fakeArchive(makePosts(), { autoSize: 100 });
  const fetchImpl = mockFetch((url, init) => {
    if (url.pathname === '/api/posts/search' && ++searches > 1) return jsonResponse({ error: 'down' }, { status: 503 });
    return inner(url.href, init);
  });
  const adapter = adapterFor(fetchImpl);
  adapter.config = { ...adapter.config, concurrency: 1 };
  const seen = [];
  const result = await adapter.search({ author: 'TestUser', onPage: (l) => seen.push(...l) });
  assert.equal(result.completeness, 'incomplete');
  assert.ok(result.issues.some((i) => /vorzeitig/.test(i.message)));
  assert.ok(seen.length > 0 && seen.length < 250);
  assert.ok(searches <= 4, `keine Anfragen-Lawine nach Ausfall (${searches})`);
});

test('Abbruch während der Suche', async () => {
  const controller = new AbortController();
  const fetchImpl = fakeArchive(makePosts(), { onSearch: () => controller.abort() });
  const adapter = adapterFor(fetchImpl);
  await assert.rejects(adapter.search({ author: 'TestUser', signal: controller.signal, onPage: () => {} }), (err) => err.kind === 'aborted');
});

test('SearchSession: Profilposts getrennt, Fremdautoren verworfen, Status vollständig', async () => {
  const fetchImpl = fakeArchive(makePosts());
  const scheduler = new RequestScheduler({ fetchImpl, minIntervalMs: 0, retries: 0, isOnline: () => true, sleepImpl: () => Promise.resolve() });
  const adapter = new ArcticShiftAdapter({ scheduler, now: () => NOW * 1000 });
  const session = new SearchSession({ authors: ['TestUser'], adapters: [adapter], schedulers: [scheduler] });
  await session.run();
  assert.equal(session.status.state, 'done');
  assert.equal(session.status.completeness, 'complete');
  const all = session.collection.all();
  assert.equal(all.length, 250);
  assert.equal(all.filter((p) => p.isProfile).length, 5);
  assert.equal(session.expectedFor('photography'), 90);
});

test('SearchSession: Abbruch setzt Status „abgebrochen“', async () => {
  const fetchImpl = fakeArchive(makePosts());
  const scheduler = new RequestScheduler({ fetchImpl, minIntervalMs: 0, retries: 0, isOnline: () => true, sleepImpl: (ms, s) => (s?.aborted ? Promise.reject(Object.assign(new Error('x'), { kind: 'aborted' })) : Promise.resolve()) });
  const adapter = new ArcticShiftAdapter({ scheduler, now: () => NOW * 1000 });
  const session = new SearchSession({ authors: ['TestUser'], adapters: [adapter], schedulers: [scheduler] });
  session.addEventListener('update', () => { if (session.collection.size > 0) session.cancel(); });
  await session.run();
  assert.equal(session.status.state, 'cancelled');
  assert.equal(session.status.completeness, 'incomplete');
});

test('SearchSession: nicht erreichbare Quelle ergibt Fehlerzustand', async () => {
  const scheduler = new RequestScheduler({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, minIntervalMs: 0, retries: 0, isOnline: () => true, sleepImpl: () => Promise.resolve() });
  const adapter = new ArcticShiftAdapter({ scheduler, now: () => NOW * 1000 });
  const session = new SearchSession({ authors: ['TestUser'], adapters: [adapter], schedulers: [scheduler] });
  await session.run();
  assert.equal(session.status.state, 'error');
  assert.equal(session.status.error.kind, 'network');
});
