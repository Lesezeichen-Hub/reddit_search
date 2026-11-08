import test from 'node:test';
import assert from 'node:assert/strict';
import { RedditLocalAdapter } from '../../js/adapters/reddit-local.js';
import { ArcticShiftAdapter } from '../../js/adapters/arctic-shift.js';
import { RequestScheduler } from '../../js/net.js';
import { SearchSession } from '../../js/search-engine.js';
import { jsonResponse, mockFetch, rawPost } from './fixtures.js';

// MOCK: simulierter lokaler Reddit-Adapter und simuliertes Archiv – keine echten Abrufe.
const sched = (fetchImpl) => new RequestScheduler({ fetchImpl, minIntervalMs: 0, retries: 0, isOnline: () => true, sleepImpl: () => Promise.resolve() });

test('Reddit-Adapter blättert über den after-Cursor und kennzeichnet die Suche als begrenzt', async () => {
  const fetchImpl = mockFetch((url) => {
    if (url.pathname === '/reddit/search') {
      const after = url.searchParams.get('after');
      if (!after) return jsonResponse({ data: [rawPost({ id: 'r1' }), rawPost({ id: 'r2' })], after: 't3_r2' });
      return jsonResponse({ data: [rawPost({ id: 'r3' })], after: null });
    }
    return jsonResponse({ error: 'x' }, { status: 404 });
  });
  const adapter = new RedditLocalAdapter({ scheduler: sched(fetchImpl), baseUrl: 'http://127.0.0.1:8791' });
  const seen = [];
  const result = await adapter.search({ author: 'TestUser', onPage: (l) => seen.push(...l) });
  assert.deepEqual(seen.map((p) => p.id), ['r1', 'r2', 'r3']);
  assert.equal(result.completeness, 'partial-by-design');
  assert.ok(fetchImpl.calls.every((u) => u.startsWith('http://127.0.0.1:8791/reddit/search?author=TestUser')));
});

test('Nicht konfigurierter Adapter meldet sich verständlich', async () => {
  const adapter = new RedditLocalAdapter({ scheduler: sched(mockFetch(() => jsonResponse({ ok: true, configured: false }))) });
  const r = await adapter.test();
  assert.equal(r.ok, false);
  assert.match(r.message, /nicht mit Reddit-API-Zugangsdaten konfiguriert/);
});

test('Statusprüfung entfernt auf Reddit gelöschte Beiträge, Profilabgleich zieht keine Schlüsse', async () => {
  const archive = [rawPost({ id: 'k1', created_utc: 1700000300 }), rawPost({ id: 'k2', created_utc: 1700000200 }), rawPost({ id: 'k3', created_utc: 1700000100 })];
  const arcticFetch = mockFetch((url) => {
    if (url.pathname.endsWith('/aggregate')) return jsonResponse({ error: 'Query timed out' }, { status: 422 });
    return jsonResponse({ data: archive.filter((p) => p.created_utc < Number(url.searchParams.get('before'))) });
  });
  const redditFetch = mockFetch((url) => {
    if (url.pathname === '/reddit/info') {
      return jsonResponse({ data: [{ id: 'k1', score: 77, num_comments: 5 }, { id: 'k2', removed_by_category: 'deleted' }] });
    }
    if (url.pathname === '/reddit/submitted') return jsonResponse({ data: [{ id: 'k1' }], after: null });
    return jsonResponse({ error: 'x' }, { status: 404 });
  });
  const arcticScheduler = sched(arcticFetch);
  const arctic = new ArcticShiftAdapter({ scheduler: arcticScheduler, now: () => 1800000000000 });
  const reddit = new RedditLocalAdapter({ scheduler: sched(redditFetch) });
  const session = new SearchSession({ authors: ['TestUser'], adapters: [arctic], liveAdapter: reddit, profileCompare: true, schedulers: [arcticScheduler] });
  await session.run();
  assert.equal(session.status.state, 'done');
  assert.deepEqual([...session.collection.byId.keys()], ['k1'], 'k2 (gelöscht) und k3 (nicht mehr abrufbar) ausgeblendet');
  const k1 = session.collection.byId.get('k1');
  assert.equal(k1.liveChecked, true);
  assert.equal(k1.score, 77);
  assert.equal(session.status.liveCheck.removed, 2);
  assert.equal(session.status.profileCheck.checked, 3);
  assert.equal(session.status.profileCheck.notListed, 2);
  assert.equal(session.status.completeness, 'unknown', 'ohne Archivindex nicht überprüfbar');
});
