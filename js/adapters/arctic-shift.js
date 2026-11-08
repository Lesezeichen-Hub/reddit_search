import { SOURCES } from '../config.js';
import { SourceError } from '../net.js';

/**
 * Adapter für die dokumentierte Arctic-Shift-API
 * (https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md).
 *
 * Verwendete Endpunkte:
 *   GET /api/posts/search            author, after, before, limit (1–100), sort
 *   GET /api/posts/search/aggregate  aggregate=created_utc|subreddit, frequency
 *   GET /api/posts/ids               ids (kommagetrennt, max. 500)
 *
 * Strategie: Über das Aggregat werden Jahresfenster mit Treffern ermittelt.
 * Jedes Fenster wird absteigend nach created_utc mit before-Cursor
 * durchblättert. Läuft eine Abfrage in ein Timeout, wird das Fenster halbiert.
 */
/**
 * Lückenlose Zeitfenster aus den Index-Buckets. Aufeinanderfolgende Buckets werden
 * zusammengefasst, solange sie zusammen höchstens maxPerWindow Treffer erwarten lassen.
 * Buckets ohne Treffer werden nie übersprungen – so bleibt die Suche auch bei einem
 * fehlerhaften Index vollständig.
 */
export function coverWindows(buckets, fullRange, maxPerWindow = 300) {
  if (!buckets.length) return [{ ...fullRange }];
  const windows = [];
  const first = Math.min(buckets[0].from, fullRange.from);
  for (const [i, b] of buckets.entries()) {
    const from = i === 0 ? first : b.from;
    const to = i === buckets.length - 1 ? Math.max(b.to, fullRange.to) : b.to;
    const prev = windows[windows.length - 1];
    if (prev && prev.expected + b.expected <= maxPerWindow) {
      prev.to = to;
      prev.expected += b.expected;
    } else {
      windows.push({ from, to, expected: b.expected });
    }
  }
  return windows;
}

export class ArcticShiftAdapter {
  constructor({ scheduler, config = SOURCES.arcticShift, now = () => Date.now() }) {
    this.id = config.id;
    this.label = config.label;
    this.kind = config.kind;
    this.config = config;
    this.scheduler = scheduler;
    this.now = now;
  }

  url(path, params) {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.href;
  }

  async request(path, params, signal, { retries } = {}) {
    const { body } = await this.scheduler.getJson(this.url(path, params), { signal, ...(retries === undefined ? {} : { retries }) });
    if (!body || typeof body !== 'object') throw new SourceError('invalid-response', 'Arctic Shift lieferte eine unerwartete Antwort.');
    if (body.error) throw new SourceError('client', String(body.error));
    if (!Array.isArray(body.data)) throw new SourceError('invalid-response', 'Arctic Shift lieferte keine Ergebnisliste.');
    return body.data;
  }

  searchPage({ author, after, before, signal }) {
    return this.request('/api/posts/search', {
      author,
      after: Math.floor(after),
      before: Math.floor(before),
      limit: this.config.pageSize,
      sort: 'desc'
    }, signal);
  }

  /** Jahresfenster mit Beitragsanzahl laut Archivindex. */
  async aggregateYears(author, signal) {
    // Die Buckets sind nur korrekt, wenn "after" auf einem Jahresanfang liegt (verifiziert).
    const data = await this.request('/api/posts/search/aggregate', {
      aggregate: 'created_utc',
      frequency: 'year',
      author,
      after: this.config.indexAfter
    }, signal, { retries: 1 });
    const buckets = data
      .map((row) => ({ from: Date.parse(row?.created_utc) / 1000, count: Number(row?.count) }))
      .filter((b) => Number.isFinite(b.from) && Number.isFinite(b.count))
      .sort((a, b) => a.from - b.from);
    const end = Math.floor(this.now() / 1000) + 86400;
    return buckets.map((bucket, i) => ({
      from: Math.max(Math.floor(bucket.from), 0),
      to: i + 1 < buckets.length ? Math.floor(buckets[i + 1].from) : end,
      expected: bucket.count
    }));
  }

  async aggregateSubreddits(author, signal) {
    const data = await this.request('/api/posts/search/aggregate', { aggregate: 'subreddit', author }, signal, { retries: 1 });
    const map = new Map();
    for (const row of data) {
      const count = Number(row?.count);
      if (typeof row?.key === 'string' && Number.isFinite(count)) map.set(row.key.toLowerCase(), count);
    }
    return map;
  }

  async fetchByIds(ids, signal) {
    const clean = [...new Set(ids.map((id) => String(id).replace(/^t3_/, '')).filter((id) => /^[a-z0-9]{1,13}$/i.test(id)))];
    const result = [];
    for (let i = 0; i < clean.length; i += 100) {
      result.push(...await this.request('/api/posts/ids', { ids: clean.slice(i, i + 100).join(',') }, signal));
    }
    return result;
  }

  async test(signal) {
    const started = this.now();
    const data = await this.request('/api/posts/search', { subreddit: 'announcements', limit: 1, sort: 'desc' }, signal);
    return { ok: true, latencyMs: this.now() - started, message: data.length ? 'Arctic Shift antwortet und liefert Daten.' : 'Arctic Shift antwortet, lieferte aber keine Testdaten.' };
  }

  /**
   * Durchsucht das Archiv vollständig nach Beiträgen eines Autors.
   * onPage(rawPosts) erhält neue Rohdaten, onProgress(info) Statusangaben.
   */
  async search({ author, signal, maxResults = Infinity, onPage, onProgress }) {
    const issues = [];
    const nowSec = Math.floor(this.now() / 1000);
    const fullRange = { from: this.config.epochStart, to: nowSec + 86400, expected: null };
    let expectedTotal = null;
    let expectedBySubreddit = null;
    let windows;

    onProgress?.({ phase: 'index', message: 'Archivindex wird abgefragt …' });
    try {
      const years = await this.aggregateYears(author, signal);
      expectedTotal = years.reduce((sum, y) => sum + y.expected, 0);
      windows = coverWindows(years, fullRange);
    } catch (err) {
      if (err.kind === 'aborted') throw err;
      issues.push({ kind: 'index', severity: 'info', message: `Archivindex nicht verfügbar (${err.message}). Vollständigkeit kann nicht abgeglichen werden.` });
      windows = [];
    }
    try {
      expectedBySubreddit = await this.aggregateSubreddits(author, signal);
    } catch (err) {
      if (err.kind === 'aborted') throw err;
    }
    // Auch bei leerem Index einmal den Gesamtzeitraum prüfen.
    if (!windows.length) windows = [fullRange];
    windows.sort((a, b) => b.from - a.from);

    const queue = windows.map((w) => ({ ...w }));
    const seen = new Set();
    let loaded = 0;
    let sectionsDone = 0;
    let sectionsTotal = queue.length;
    let stopReason = null;
    let fatal = null;
    let failed = 0;
    let pagesOk = 0;
    const active = new Set();

    const report = (extra = {}) => onProgress?.({
      phase: 'posts',
      sectionsDone,
      sectionsTotal,
      loaded,
      expectedTotal,
      activeWindows: [...active].map((w) => ({ from: w.from, to: w.cursor ?? w.to })),
      ...extra
    });

    const processWindow = async (win) => {
      active.add(win);
      win.cursor = win.to;
      win.loaded = 0;
      report();
      for (;;) {
        let page;
        try {
          page = await this.searchPage({ author, after: win.from, before: win.cursor, signal });
        } catch (err) {
          if (err.kind === 'aborted') throw err;
          const span = win.cursor - win.from;
          // Zu aufwendige Abfragen: Zeitfenster halbieren und getrennt abfragen.
          if (['query-timeout', 'timeout'].includes(err.kind) && span > this.config.minSplitSeconds) {
            const mid = Math.floor(win.from + span / 2);
            queue.unshift({ from: mid, to: win.cursor, expected: null }, { from: win.from, to: mid, expected: null });
            sectionsTotal += 2;
            win.splitted = true;
            break;
          }
          failed += 1;
          issues.push({ kind: err.kind, severity: 'gap', message: err.message, range: { from: win.from, to: win.cursor } });
          // Systemische Fehler (nach allen Wiederholungen): weitere Fenster wären ebenfalls betroffen.
          if (FATAL_KINDS.includes(err.kind)) {
            fatal ??= err;
            stopReason ??= 'fatal';
          }
          break;
        }
        pagesOk += 1;
        const fresh = page.filter((p) => p && typeof p.id === 'string' && !seen.has(p.id));
        for (const p of fresh) seen.add(p.id);
        if (fresh.length) {
          loaded += fresh.length;
          win.loaded += fresh.length;
          onPage?.(fresh);
        }
        if (loaded >= maxResults) {
          stopReason ??= 'limit';
          break;
        }
        if (!page.length) break;
        // Mit limit=auto liefert die API mindestens 100 Treffer, solange weitere existieren.
        if (page.length < this.config.minFullPage) {
          const indexSaysMore = win.expected !== null && win.loaded < win.expected && fresh.length > 0;
          if (!indexSaysMore) break;
        }
        const times = page.map((p) => Number(p?.created_utc)).filter(Number.isFinite);
        if (!times.length) {
          issues.push({ kind: 'invalid-response', severity: 'gap', message: 'Antwort ohne Zeitstempel – Fenster konnte nicht fortgesetzt werden.', range: { from: win.from, to: win.cursor } });
          failed += 1;
          break;
        }
        const minTs = Math.min(...times);
        // before ist exklusiv: +1 erfasst weitere Beiträge derselben Sekunde (Dubletten werden verworfen).
        let next = fresh.length ? minTs + 1 : minTs;
        if (next >= win.cursor) next = minTs;
        if (next >= win.cursor || next <= win.from) break;
        win.cursor = next;
        report();
        if (stopReason || signal?.aborted) break;
      }
      active.delete(win);
      if (!win.splitted) sectionsDone += 1;
      else sectionsTotal -= 1;
      report();
    };

    const worker = async () => {
      while (queue.length && !stopReason) {
        if (signal?.aborted) throw new SourceError('aborted', 'Die Suche wurde abgebrochen.');
        await processWindow(queue.shift());
      }
    };
    await Promise.all(Array.from({ length: this.config.concurrency }, worker));
    if (signal?.aborted) throw new SourceError('aborted', 'Die Suche wurde abgebrochen.');

    // Keine einzige Seite erfolgreich: die Quelle gilt als nicht verfügbar.
    if (!pagesOk && fatal) throw fatal;

    if (stopReason === 'limit') {
      issues.push({ kind: 'max-results', severity: 'gap', message: `Die eingestellte Höchstzahl von ${maxResults} Beiträgen wurde erreicht. Ältere Beiträge wurden nicht geladen.` });
    }
    if (stopReason === 'fatal') {
      issues.push({ kind: fatal.kind, severity: 'gap', message: `Suche vorzeitig beendet: ${fatal.message}` });
    }
    let completeness = 'unknown';
    if (stopReason || failed) completeness = 'incomplete';
    else if (expectedTotal !== null) completeness = loaded >= expectedTotal ? 'complete' : 'incomplete';
    if (expectedTotal !== null && !stopReason && loaded < expectedTotal) {
      issues.push({ kind: 'mismatch', severity: 'gap', message: `Laut Archivindex existieren ${expectedTotal} Beiträge, geladen wurden ${loaded}.` });
    }
    return { completeness, issues, expectedTotal, expectedBySubreddit, loaded };
  }
}

const FATAL_KINDS = ['network', 'offline', 'auth', 'rate-limit', 'server'];
