// MOCK-DATEN für automatisierte Tests. Diese Objekte imitieren die Struktur
// der Arctic-Shift-Antworten, stammen aber NICHT aus einem echten API-Abruf.
let seq = 0;

export function rawPost(overrides = {}) {
  seq += 1;
  const id = overrides.id ?? `mock${seq.toString(36)}`;
  return {
    id,
    name: `t3_${id}`,
    author: 'TestUser',
    subreddit: 'mycology',
    subreddit_type: 'public',
    created_utc: 1700000000 - seq,
    title: `Mock-Beitrag ${seq}`,
    selftext: 'Mock-Text',
    is_self: true,
    is_video: false,
    permalink: `/r/${overrides.subreddit ?? 'mycology'}/comments/${id}/mock/`,
    score: 10,
    num_comments: 2,
    retrieved_on: 1700000100,
    _meta: { retrieved_2nd_on: 1700100000 },
    ...overrides
  };
}

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Fetch-Attrappe: handler(url) liefert Response oder wirft. Protokolliert alle URLs. */
export function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(String(url));
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return handler(new URL(url), init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

export const instantSleep = (ms, signal) => (signal?.aborted ? Promise.reject(Object.assign(new Error('abgebrochen'), { kind: 'aborted' })) : Promise.resolve());
