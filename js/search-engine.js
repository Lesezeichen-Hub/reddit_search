import { PostCollection, detectRemoval } from './posts.js';

/**
 * Orchestriert eine Recherche über mehrere Adapter und (optional) mehrere Autoren.
 * Ergebnisse werden laufend in einer PostCollection zusammengeführt.
 */
export class SearchSession extends EventTarget {
  constructor({ authors, adapters, maxResults = 5000, liveAdapter = null, profileCompare = false, schedulers = [] }) {
    super();
    this.authors = authors;
    this.adapters = adapters;
    this.maxResults = maxResults;
    this.liveAdapter = liveAdapter;
    this.profileCompare = profileCompare;
    this.collection = new PostCollection();
    this.controller = new AbortController();
    this.expectedBySubreddit = new Map();
    this.requests = { active: 0, queued: 0, pausedUntil: 0 };
    this.status = {
      state: 'idle',
      phase: '',
      activeSource: null,
      activeAuthor: null,
      currentWindows: [],
      sectionsDone: 0,
      sectionsTotal: 0,
      expectedTotal: null,
      sources: [],
      startedAt: null,
      finishedAt: null,
      error: null,
      completeness: 'unknown',
      profileCheck: null,
      liveCheck: null
    };
    for (const scheduler of schedulers) {
      scheduler.onChange = (info) => {
        this.requests = info;
        this.emit();
      };
    }
  }

  emit(type = 'update') {
    this.dispatchEvent(new Event(type));
  }

  get signal() {
    return this.controller.signal;
  }

  cancel() {
    if (this.status.state === 'running') this.controller.abort();
  }

  async run() {
    const s = this.status;
    s.state = 'running';
    s.startedAt = Date.now();
    this.emit();
    try {
      for (const author of this.authors) {
        for (const adapter of this.adapters) {
          await this.runAdapter(adapter, author);
        }
      }
      if (this.liveAdapter && this.profileCompare) await this.runProfileCheck();
      if (this.liveAdapter) await this.runLiveCheck();
      const ok = s.sources.filter((src) => src.state === 'done');
      if (!ok.length) {
        const first = s.sources.find((src) => src.error);
        s.state = 'error';
        s.error = first?.error ?? { kind: 'server', message: 'Keine Datenquelle konnte abgefragt werden.' };
      } else {
        s.state = 'done';
      }
      s.completeness = this.combineCompleteness();
    } catch (err) {
      if (err?.kind === 'aborted' || this.signal.aborted) {
        s.state = 'cancelled';
        s.completeness = 'incomplete';
        for (const src of s.sources) if (src.state === 'running' || src.state === 'pending') src.state = 'cancelled';
      } else {
        s.state = 'error';
        s.error = { kind: err?.kind ?? 'server', message: err?.message ?? 'Unbekannter Fehler' };
      }
    } finally {
      s.finishedAt = Date.now();
      s.activeSource = null;
      s.currentWindows = [];
      this.emit();
      this.emit('end');
    }
    return this;
  }

  combineCompleteness() {
    const archive = this.status.sources.filter((src) => src.kind === 'archive');
    if (!archive.length) return 'partial';
    if (archive.some((src) => src.state !== 'done' || src.completeness === 'incomplete')) return 'incomplete';
    if (archive.every((src) => src.completeness === 'complete')) return 'complete';
    return 'unknown';
  }

  async runAdapter(adapter, author) {
    const s = this.status;
    const entry = { id: adapter.id, label: adapter.label, kind: adapter.kind, author, state: 'running', loaded: 0, expectedTotal: null, completeness: 'unknown', issues: [], error: null };
    s.sources.push(entry);
    s.activeSource = adapter.label;
    s.activeAuthor = author;
    s.sectionsDone = 0;
    s.sectionsTotal = 0;
    this.emit();
    try {
      const result = await adapter.search({
        author,
        signal: this.signal,
        maxResults: this.maxResults,
        onPage: (raw) => {
          entry.loaded += raw.length;
          this.collection.addRaw(raw, { source: adapter.id, searchedAuthor: author });
          this.emit();
        },
        onProgress: (info) => {
          s.phase = info.phase ?? s.phase;
          if (info.sectionsTotal !== undefined) {
            s.sectionsDone = info.sectionsDone;
            s.sectionsTotal = info.sectionsTotal;
          }
          if (info.activeWindows) s.currentWindows = info.activeWindows;
          if (info.expectedTotal !== undefined && info.expectedTotal !== null) {
            entry.expectedTotal = info.expectedTotal;
            s.expectedTotal = this.sumExpected();
          }
          this.emit();
        }
      });
      entry.state = 'done';
      entry.completeness = result.completeness;
      entry.issues = result.issues;
      entry.expectedTotal = result.expectedTotal;
      s.expectedTotal = this.sumExpected();
      if (result.expectedBySubreddit) {
        for (const [key, count] of result.expectedBySubreddit) {
          this.expectedBySubreddit.set(`${author.toLowerCase()}|${key}`, count);
        }
      }
    } catch (err) {
      if (err?.kind === 'aborted' || this.signal.aborted) {
        entry.state = 'cancelled';
        throw err;
      }
      entry.state = 'error';
      entry.error = { kind: err?.kind ?? 'server', message: err?.message ?? 'Unbekannter Fehler' };
    }
    this.emit();
  }

  sumExpected() {
    const values = this.status.sources.filter((src) => src.kind === 'archive' && src.expectedTotal !== null).map((src) => src.expectedTotal);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  }

  /** Erwartete Anzahl je Subreddit (Summe über alle Autoren) laut Archivindex. */
  expectedFor(subredditKey) {
    let total = null;
    for (const author of this.authors) {
      const value = this.expectedBySubreddit.get(`${author.toLowerCase()}|${subredditKey}`);
      if (value !== undefined) total = (total ?? 0) + value;
    }
    return total;
  }

  async runProfileCheck() {
    const s = this.status;
    s.phase = 'profile';
    s.activeSource = 'Reddit-Profilabgleich';
    this.emit();
    const summary = { checked: 0, notListed: 0, exhausted: true, error: null };
    try {
      for (const author of this.authors) {
        const { ids, exhausted } = await this.liveAdapter.profileIds(author, this.signal);
        summary.exhausted &&= exhausted;
        for (const post of this.collection.byId.values()) {
          if (post.author.toLowerCase() !== author.toLowerCase()) continue;
          post.profileListed = ids.has(post.id);
          summary.checked += 1;
          if (!post.profileListed) summary.notListed += 1;
        }
      }
    } catch (err) {
      if (err?.kind === 'aborted') throw err;
      summary.error = err?.message ?? 'Profilabgleich fehlgeschlagen';
    }
    s.profileCheck = summary;
    this.emit();
  }

  /** Prüft den aktuellen Reddit-Status und entfernt dort gelöschte/entfernte Beiträge. */
  async runLiveCheck() {
    const s = this.status;
    s.phase = 'live';
    s.activeSource = 'Reddit-Statusprüfung';
    this.emit();
    const summary = { checked: 0, removed: 0, error: null };
    try {
      const ids = [...this.collection.byId.keys()];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const live = await this.liveAdapter.info(chunk, this.signal);
        const byId = new Map(live.filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
        for (const id of chunk) {
          const raw = byId.get(id);
          summary.checked += 1;
          if (!raw || detectRemoval(raw)) {
            if (this.collection.markRemoved(id)) summary.removed += 1;
          } else {
            const post = this.collection.byId.get(id);
            if (post) {
              post.liveChecked = true;
              if (Number.isFinite(raw.score)) post.score = raw.score;
              if (Number.isFinite(raw.num_comments)) post.numComments = raw.num_comments;
              post.metricsReliable = true;
            }
          }
        }
        this.emit();
      }
    } catch (err) {
      if (err?.kind === 'aborted') throw err;
      summary.error = err?.message ?? 'Statusprüfung fehlgeschlagen';
    }
    s.liveCheck = summary;
    this.emit();
  }
}
