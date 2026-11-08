import { SOURCES } from '../config.js';
import { SourceError } from '../net.js';

/**
 * Adapter für die offizielle Reddit-API über den optionalen lokalen Go-Dienst
 * (Ordner server/). Der Browser erhält nie Reddit-Zugangsdaten; der Dienst
 * authentifiziert sich serverseitig per OAuth mit Daten aus Umgebungsvariablen.
 *
 * Endpunkte des lokalen Dienstes:
 *   GET /health
 *   GET /reddit/search?author=NAME&after=CURSOR     (Reddit-Suche author:NAME, type=link)
 *   GET /reddit/submitted?author=NAME&after=CURSOR  (Profil-Auflistung, von Reddit begrenzt)
 *   GET /reddit/info?ids=t3_a,t3_b                  (aktueller Status einzelner Beiträge)
 */
export class RedditLocalAdapter {
  constructor({ scheduler, baseUrl = SOURCES.redditLocal.defaultBaseUrl }) {
    this.id = SOURCES.redditLocal.id;
    this.label = SOURCES.redditLocal.label;
    this.kind = SOURCES.redditLocal.kind;
    this.scheduler = scheduler;
    this.baseUrl = RedditLocalAdapter.validateBaseUrl(baseUrl);
  }

  /** Nur lokale Adressen sind zulässig, damit keine Daten an fremde Dienste gehen. */
  static validateBaseUrl(value) {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      throw new SourceError('client', 'Die Adresse des lokalen Adapters ist ungültig.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new SourceError('client', 'Der Reddit-Adapter muss lokal laufen (127.0.0.1 oder localhost).');
    }
    return url.origin;
  }

  async get(path, params, signal) {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
    const { body } = await this.scheduler.getJson(url.href, { signal });
    if (!body || typeof body !== 'object') throw new SourceError('invalid-response', 'Der lokale Adapter lieferte eine unerwartete Antwort.');
    if (body.error) throw new SourceError(body.kind === 'auth' ? 'auth' : 'client', String(body.error));
    return body;
  }

  async health(signal) {
    const body = await this.get('/health', null, signal);
    return { ok: Boolean(body.ok), configured: Boolean(body.configured), message: String(body.message ?? '') };
  }

  async test(signal) {
    const started = Date.now();
    const health = await this.health(signal);
    if (!health.configured) {
      return { ok: false, latencyMs: Date.now() - started, message: 'Der lokale Adapter läuft, ist aber nicht mit Reddit-API-Zugangsdaten konfiguriert.' };
    }
    return { ok: true, latencyMs: Date.now() - started, message: health.message || 'Lokaler Reddit-Adapter ist bereit.' };
  }

  async listing(path, author, { signal, maxResults, onPage, maxPages = 10 }) {
    let after = '';
    let loaded = 0;
    let pages = 0;
    for (;;) {
      const body = await this.get(path, { author, after }, signal);
      if (!Array.isArray(body.data)) throw new SourceError('invalid-response', 'Der lokale Adapter lieferte keine Ergebnisliste.');
      pages += 1;
      loaded += body.data.length;
      onPage?.(body.data);
      after = typeof body.after === 'string' && /^t3_[a-z0-9]+$/i.test(body.after) ? body.after : '';
      if (!after || loaded >= maxResults || pages >= maxPages) break;
    }
    return { loaded, exhausted: !after };
  }

  async search({ author, signal, maxResults = Infinity, onPage, onProgress }) {
    onProgress?.({ phase: 'posts', message: 'Reddit-Suche läuft …' });
    const { loaded } = await this.listing('/reddit/search', author, { signal, maxResults, onPage });
    return {
      completeness: 'partial-by-design',
      issues: [{ kind: 'reddit-cap', severity: 'info', message: 'Die offizielle Reddit-Suche liefert nur eine begrenzte Auswahl (meist höchstens einige hundert Treffer) und ist daher nie vollständig.' }],
      expectedTotal: null,
      expectedBySubreddit: null,
      loaded
    };
  }

  /** Begrenzter Profilabgleich: liefert die IDs der aktuell im Profil gelisteten Beiträge. */
  async profileIds(author, signal) {
    const ids = new Set();
    const { exhausted } = await this.listing('/reddit/submitted', author, {
      signal,
      maxResults: 1000,
      onPage: (list) => list.forEach((p) => typeof p?.id === 'string' && ids.add(p.id))
    });
    return { ids, exhausted };
  }

  async info(ids, signal) {
    const result = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).map((id) => `t3_${String(id).replace(/^t3_/, '')}`).join(',');
      const body = await this.get('/reddit/info', { ids: chunk }, signal);
      if (Array.isArray(body.data)) result.push(...body.data);
    }
    return result;
  }
}
