import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestScheduler, SourceError, parseRetryAfter } from '../../js/net.js';
import { jsonResponse, mockFetch } from './fixtures.js';

function scheduler(fetchImpl, extra = {}) {
  const delays = [];
  const s = new RequestScheduler({
    fetchImpl,
    minIntervalMs: 0,
    retries: 3,
    baseDelayMs: 10,
    timeoutMs: 50,
    isOnline: () => true,
    sleepImpl: (ms, signal) => {
      delays.push(ms);
      if (signal?.aborted) return Promise.reject(new SourceError('aborted', 'abgebrochen'));
      return Promise.resolve();
    },
    ...extra
  });
  s.delays = delays;
  return s;
}

test('liefert JSON bei Erfolg', async () => {
  const s = scheduler(mockFetch(() => jsonResponse({ data: [1] })));
  const { body } = await s.getJson('https://example.test/a');
  assert.deepEqual(body, { data: [1] });
});

test('wiederholt Serverfehler mit exponentiellem Backoff', async () => {
  const fetchImpl = mockFetch((url, init, n) => (n < 3 ? jsonResponse({ error: 'boom' }, { status: 503 }) : jsonResponse({ data: [] })));
  const s = scheduler(fetchImpl);
  await s.getJson('https://example.test/a');
  assert.equal(fetchImpl.calls.length, 3);
  const backoffs = s.delays.filter((d) => d > 0);
  assert.equal(backoffs.length, 2);
  assert.ok(backoffs[1] >= 20, 'zweiter Versuch wartet länger');
  assert.equal(s.stats.retries, 2);
});

test('gibt nach erschöpften Wiederholungen einen Serverfehler zurück', async () => {
  const s = scheduler(mockFetch(() => jsonResponse({ error: 'down' }, { status: 502 })));
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'server' && err.status === 502);
});

test('Rate-Limit: wartet gemäß X-RateLimit-Reset und pausiert global', async () => {
  const fetchImpl = mockFetch((url, init, n) => (n === 1 ? jsonResponse({ error: 'rate' }, { status: 429, headers: { 'x-ratelimit-reset': '7' } }) : jsonResponse({ data: [] })));
  const s = scheduler(fetchImpl);
  await s.getJson('https://example.test/a');
  assert.ok(s.delays.some((d) => d >= 7000), `Wartezeit ${s.delays}`);
  assert.equal(s.stats.rateLimited, 1);
  assert.ok(s.pausedUntil > Date.now());
});

test('parseRetryAfter wertet die dokumentierten Header aus', () => {
  const h = (o) => new Headers(o);
  assert.equal(parseRetryAfter(h({ 'x-ratelimit-reset': '3' })), 3000);
  assert.equal(parseRetryAfter(h({ 'x-ratelimit-reset-at': '10000' }), 4000), 6000);
  assert.equal(parseRetryAfter(h({ 'retry-after': '2' })), 2000);
  assert.equal(parseRetryAfter(h({})), null);
});

test('Client-Fehler werden nicht wiederholt und behalten die API-Meldung', async () => {
  const fetchImpl = mockFetch(() => jsonResponse({ data: null, error: "'limit' must be between 1 and 100" }, { status: 400 }));
  const s = scheduler(fetchImpl);
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'client' && /limit/.test(err.message));
  assert.equal(fetchImpl.calls.length, 1);
});

test('„Query timed out“ wird als Abfrage-Timeout erkannt und nur einmal wiederholt', async () => {
  const fetchImpl = mockFetch(() => jsonResponse({ error: 'Query timed out' }, { status: 422 }));
  const s = scheduler(fetchImpl);
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'query-timeout');
  assert.equal(fetchImpl.calls.length, 2);
});

test('Netzwerk-Timeout bricht hängende Anfragen ab', async () => {
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const s = scheduler(fetchImpl, { retries: 0, timeoutMs: 20 });
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'timeout');
});

test('Netzwerkfehler werden verständlich gemeldet', async () => {
  const s = scheduler(async () => { throw new TypeError('Failed to fetch'); }, { retries: 0 });
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'network' && /nicht erreichbar/.test(err.message));
});

test('ungültiges JSON wird erkannt', async () => {
  const s = scheduler(async () => new Response('<html>', { status: 200 }), { retries: 0 });
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'invalid-response');
});

test('Offline wird ohne Anfrage gemeldet', async () => {
  const fetchImpl = mockFetch(() => jsonResponse({}));
  const s = scheduler(fetchImpl, { isOnline: () => false });
  await assert.rejects(s.getJson('https://example.test/a'), (err) => err.kind === 'offline');
  assert.equal(fetchImpl.calls.length, 0);
});

test('Abbruch beendet laufende und wartende Anfragen', async () => {
  const controller = new AbortController();
  let started = 0;
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    started += 1;
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const s = scheduler(fetchImpl, { concurrency: 1, timeoutMs: 10000 });
  const first = s.getJson('https://example.test/1', { signal: controller.signal });
  const second = s.getJson('https://example.test/2', { signal: controller.signal });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.active, 1);
  assert.equal(s.waiting.length, 1);
  controller.abort();
  await assert.rejects(first, (err) => err.kind === 'aborted');
  await assert.rejects(second, (err) => err.kind === 'aborted');
  assert.equal(started, 1, 'die wartende Anfrage wurde nie gestartet');
  assert.equal(s.active, 0);
});

test('begrenzt gleichzeitige Anfragen', async () => {
  let inflight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inflight += 1;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight -= 1;
    return jsonResponse({ data: [] });
  };
  const s = scheduler(fetchImpl, { concurrency: 2 });
  await Promise.all(Array.from({ length: 6 }, (_, i) => s.getJson(`https://example.test/${i}`)));
  assert.equal(peak, 2);
});
