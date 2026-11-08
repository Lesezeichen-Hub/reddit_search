/** Fehlerarten, die die Oberfläche in eigene Zustände übersetzt. */
export const ERROR_KINDS = {
  offline: 'Keine Internetverbindung',
  network: 'Netzwerk nicht erreichbar',
  timeout: 'Zeitüberschreitung',
  'rate-limit': 'Rate-Limit erreicht',
  'query-timeout': 'Abfrage der Datenquelle zu aufwendig',
  server: 'Datenquelle vorübergehend nicht verfügbar',
  client: 'Anfrage abgelehnt',
  auth: 'Zugang verweigert',
  'invalid-response': 'Ungültige Antwort der Datenquelle',
  aborted: 'Abgebrochen'
};

export class SourceError extends Error {
  constructor(kind, message, { status = null, retryAfterMs = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SourceError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  get retryable() {
    return ['network', 'timeout', 'rate-limit', 'server', 'query-timeout'].includes(this.kind);
  }
}

export function abortError() {
  return new SourceError('aborted', 'Die Suche wurde abgebrochen.');
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Verknüpft ein äußeres Abbruchsignal mit einem Timeout. */
function linkedController(outer, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    get timedOut() { return timedOut; },
    dispose() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  };
}

export function parseRetryAfter(headers, nowMs = Date.now()) {
  const get = (name) => headers?.get?.(name) ?? null;
  const reset = Number(get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.min(reset * 1000, 5 * 60000);
  const resetAt = Number(get('x-ratelimit-reset-at'));
  if (Number.isFinite(resetAt) && resetAt > nowMs) return Math.min(resetAt - nowMs, 5 * 60000);
  const retryAfter = get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 5 * 60000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - nowMs, 5 * 60000));
  }
  return null;
}

/**
 * Begrenzt gleichzeitige Anfragen, hält Mindestabstände ein, wiederholt
 * temporäre Fehler mit exponentiellem Backoff und pausiert global bei 429.
 */
export class RequestScheduler {
  constructor({ concurrency = 2, minIntervalMs = 300, timeoutMs = 30000, retries = 3, baseDelayMs = 800, fetchImpl, sleepImpl = sleep, now = () => Date.now(), isOnline = () => globalThis.navigator?.onLine !== false, onChange } = {}) {
    this.concurrency = concurrency;
    this.minIntervalMs = minIntervalMs;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.baseDelayMs = baseDelayMs;
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.sleep = sleepImpl;
    this.now = now;
    this.isOnline = isOnline;
    this.onChange = onChange;
    this.active = 0;
    this.waiting = [];
    this.lastStart = 0;
    this.pausedUntil = 0;
    this.stats = { requests: 0, retries: 0, rateLimited: 0, failures: 0 };
  }

  notify() {
    this.onChange?.({ active: this.active, queued: this.waiting.length, pausedUntil: this.pausedUntil, stats: { ...this.stats } });
  }

  async acquire(signal) {
    if (signal?.aborted) throw abortError();
    if (this.active < this.concurrency) {
      this.active += 1;
    } else {
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        this.waiting.push(entry);
        this.notify();
        signal?.addEventListener('abort', () => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) {
            this.waiting.splice(index, 1);
            reject(abortError());
          }
        }, { once: true });
      });
    }
    this.notify();
  }

  release() {
    const next = this.waiting.shift();
    if (next) next.resolve();
    else this.active -= 1;
    this.notify();
  }

  async pace(signal) {
    const now = this.now();
    const wait = Math.max(this.pausedUntil - now, this.lastStart + this.minIntervalMs - now, 0);
    this.lastStart = now + wait;
    if (wait > 0) await this.sleep(wait, signal);
  }

  /** Führt eine GET-Anfrage aus und liefert geparstes JSON. */
  async getJson(url, { signal, timeoutMs = this.timeoutMs, retries = this.retries, headers } = {}) {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      if (!this.isOnline()) throw new SourceError('offline', 'Keine Internetverbindung. Neue Recherchen benötigen eine Verbindung.');
      await this.acquire(signal);
      let error;
      try {
        await this.pace(signal);
        return await this.once(url, { signal, timeoutMs, headers });
      } catch (err) {
        error = err;
      } finally {
        this.release();
      }
      // Abfrage-Timeouts nur einmal wiederholen (Datenbank-Aufwärmphase); danach teilt der Adapter das Zeitfenster.
      const limit = error.kind === 'query-timeout' ? Math.min(retries, 1) : retries;
      if (error.kind === 'aborted' || !error.retryable || attempt >= limit) {
        if (error.kind !== 'aborted') this.stats.failures += 1;
        this.notify();
        throw error;
      }
      attempt += 1;
      this.stats.retries += 1;
      let delay = this.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      if (error.kind === 'rate-limit') {
        this.stats.rateLimited += 1;
        delay = Math.max(delay, error.retryAfterMs ?? 0);
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + delay);
      }
      this.notify();
      await this.sleep(delay, signal);
    }
  }

  async once(url, { signal, timeoutMs, headers }) {
    this.stats.requests += 1;
    const link = linkedController(signal, timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, { signal: link.signal, headers: { Accept: 'application/json', ...headers }, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (err) {
      link.dispose();
      if (signal?.aborted) throw abortError();
      if (link.timedOut) throw new SourceError('timeout', 'Die Datenquelle hat nicht rechtzeitig geantwortet.', { cause: err });
      throw new SourceError('network', 'Die Datenquelle ist nicht erreichbar (Netzwerkfehler oder vom Browser blockierter Zugriff).', { cause: err });
    }
    let body = null;
    let text = '';
    try {
      text = await response.text();
    } catch (err) {
      link.dispose();
      if (signal?.aborted) throw abortError();
      if (link.timedOut) throw new SourceError('timeout', 'Die Antwort wurde nicht rechtzeitig übertragen.', { cause: err });
      throw new SourceError('network', 'Die Antwort konnte nicht vollständig gelesen werden.', { cause: err });
    }
    link.dispose();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const apiError = body && typeof body.error === 'string' ? body.error : '';
    if (response.status === 429) {
      throw new SourceError('rate-limit', 'Das Rate-Limit der Datenquelle ist erreicht.', { status: 429, retryAfterMs: parseRetryAfter(response.headers, this.now()) });
    }
    if (/timed? ?out/i.test(apiError)) {
      throw new SourceError('query-timeout', 'Die Abfrage war für die Datenquelle zu aufwendig.', { status: response.status });
    }
    if (response.status === 401 || response.status === 403) {
      throw new SourceError('auth', apiError || 'Die Datenquelle verweigert den Zugriff.', { status: response.status });
    }
    if (response.status >= 500) {
      throw new SourceError('server', apiError || `Die Datenquelle meldet einen Serverfehler (${response.status}).`, { status: response.status });
    }
    if (!response.ok) {
      throw new SourceError('client', apiError || `Die Anfrage wurde abgelehnt (${response.status}).`, { status: response.status });
    }
    if (body === null) throw new SourceError('invalid-response', 'Die Datenquelle hat kein gültiges JSON geliefert.', { status: response.status });
    return { body, headers: response.headers, status: response.status };
  }
}
