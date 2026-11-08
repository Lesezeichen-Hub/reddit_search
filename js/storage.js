import { db } from './db.js';
import { DEFAULT_SETTINGS } from './config.js';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export function cleanTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  return [...new Set(list.map((t) => String(t).trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean))].slice(0, 20);
}

/** Nur Metadaten – keine fremden Volltexte werden dauerhaft gespeichert. */
export function findingFromPost(post, extra = {}) {
  return {
    id: post.id,
    url: post.permalink,
    subreddit: post.subreddit,
    publishedUtc: post.createdUtc,
    savedAt: new Date().toISOString(),
    note: '',
    tags: [],
    collection: '',
    favorite: false,
    ...extra
  };
}

export const settingsStore = {
  async load() {
    try {
      const row = await db.get('settings', 'app');
      return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  async save(settings) {
    const clean = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) clean[key] = settings[key];
    try { localStorage.setItem('ri-theme', clean.theme); } catch { /* privater Modus */ }
    await db.put('settings', { key: 'app', value: clean });
  }
};

export const findingsStore = {
  all: () => db.all('findings'),
  get: (id) => db.get('findings', id),
  async save(finding) {
    const record = {
      id: String(finding.id),
      url: String(finding.url ?? ''),
      subreddit: String(finding.subreddit ?? ''),
      publishedUtc: Number.isFinite(finding.publishedUtc) ? finding.publishedUtc : null,
      savedAt: finding.savedAt ?? new Date().toISOString(),
      note: String(finding.note ?? '').slice(0, 5000),
      tags: cleanTags(finding.tags),
      collection: String(finding.collection ?? '').trim().slice(0, 60),
      favorite: Boolean(finding.favorite)
    };
    await db.put('findings', record);
    return record;
  },
  remove: (id) => db.delete('findings', id),
  clear: () => db.clear('findings')
};

export const historyStore = {
  async all() {
    const rows = await db.all('history');
    return rows.sort((a, b) => b.searchedAt.localeCompare(a.searchedAt));
  },
  async add(entry) {
    const record = { id: uid(), searchedAt: new Date().toISOString(), ...entry };
    await db.put('history', record);
    const rows = await this.all();
    for (const old of rows.slice(100)) await db.delete('history', old.id);
    return record;
  },
  remove: (id) => db.delete('history', id),
  clear: () => db.clear('history')
};

export const savedSearchStore = {
  async all() {
    const rows = await db.all('savedSearches');
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async add({ name, authors, filters }) {
    const record = {
      id: uid(),
      name: String(name).trim().slice(0, 80) || authors.map((a) => `u/${a}`).join(' + '),
      authors,
      filters: {
        query: filters.query,
        scope: filters.scope,
        time: filters.time,
        from: filters.from,
        to: filters.to,
        year: filters.year,
        subreddits: [...filters.subreddits],
        types: [...filters.types],
        sort: filters.sort
      },
      createdAt: new Date().toISOString()
    };
    await db.put('savedSearches', record);
    return record;
  },
  remove: (id) => db.delete('savedSearches', id),
  clear: () => db.clear('savedSearches')
};

export async function exportLocalData() {
  return {
    format: 'reddit-investigator-local-data',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: (await db.get('settings', 'app'))?.value ?? null,
    findings: await db.all('findings'),
    history: await db.all('history'),
    savedSearches: await db.all('savedSearches')
  };
}

export async function clearAllLocalData() {
  await db.clearAll();
  try { localStorage.removeItem('ri-theme'); } catch { /* ignorieren */ }
}
