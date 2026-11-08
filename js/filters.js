import { foldText } from './text.js';

const DAY = 86400;

export const TIME_PRESETS = {
  all: 'Gesamter verfügbarer Zeitraum',
  '7d': 'Letzte 7 Tage',
  '30d': 'Letzte 30 Tage',
  '90d': 'Letzte 90 Tage',
  '1y': 'Letztes Jahr',
  custom: 'Datum von/bis',
  year: 'Kalenderjahr'
};

export const SORTS = {
  newest: 'Neueste zuerst',
  oldest: 'Älteste zuerst',
  title: 'Titel (A–Z)',
  subreddit: 'Nach Subreddit',
  score: 'Nach Score'
};

export function defaultFilters(settings = {}) {
  return {
    query: '',
    scope: 'both',
    time: settings.defaultTimeRange ?? 'all',
    from: '',
    to: '',
    year: null,
    period: null,
    subreddits: [],
    types: [],
    crossposts: settings.showCrossposts ?? true,
    onlyImages: false,
    onlyText: false,
    profile: settings.showProfilePosts ?? false,
    authors: [],
    commonOnly: false,
    sort: settings.defaultSort ?? 'newest'
  };
}

function localDayStart(dateString) {
  const [y, m, d] = String(dateString).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime() / 1000;
}

/** Liefert { from, to } in Unix-Sekunden (inklusive from, exklusive to) oder null-Grenzen. */
export function resolveTimeRange(filters, nowSeconds = Date.now() / 1000) {
  if (filters.period && Number.isFinite(filters.period.from)) {
    return { from: filters.period.from, to: filters.period.to };
  }
  switch (filters.time) {
    case '7d': return { from: nowSeconds - 7 * DAY, to: null };
    case '30d': return { from: nowSeconds - 30 * DAY, to: null };
    case '90d': return { from: nowSeconds - 90 * DAY, to: null };
    case '1y': return { from: nowSeconds - 365 * DAY, to: null };
    case 'year': {
      const year = Number(filters.year);
      if (!Number.isInteger(year)) return { from: null, to: null };
      return { from: new Date(year, 0, 1).getTime() / 1000, to: new Date(year + 1, 0, 1).getTime() / 1000 };
    }
    case 'custom': {
      const from = filters.from ? localDayStart(filters.from) : null;
      const toStart = filters.to ? localDayStart(filters.to) : null;
      return { from, to: toStart === null ? null : toStart + DAY };
    }
    default: return { from: null, to: null };
  }
}

/** Zerlegt eine Suchanfrage in Begriffe; Anführungszeichen bilden Phrasen, "-wort" schließt aus. */
export function parseQuery(query) {
  const include = [];
  const exclude = [];
  const pattern = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let match;
  while ((match = pattern.exec(String(query ?? '')))) {
    const negative = (match[1] || match[3]) === '-';
    const term = foldText(match[2] ?? match[4]).trim();
    if (!term) continue;
    (negative ? exclude : include).push(term);
  }
  return { include, exclude };
}

function haystack(post, scope) {
  if (scope === 'title') return foldText(post.title);
  if (scope === 'body') return foldText(post.text);
  return `${foldText(post.title)}\n${foldText(post.text)}`;
}

export function commonSubreddits(posts, authors) {
  if (!authors || authors.length < 2) return null;
  const owners = new Map();
  for (const post of posts) {
    if (!owners.has(post.subredditKey)) owners.set(post.subredditKey, new Set());
    owners.get(post.subredditKey).add(post.author.toLowerCase());
  }
  const wanted = authors.map((a) => a.toLowerCase());
  const result = new Set();
  for (const [key, set] of owners) if (wanted.every((a) => set.has(a))) result.add(key);
  return result;
}

/** Filtert lokal geladene Beiträge. Reine Funktion – keine Netzwerkzugriffe. */
export function applyFilters(posts, filters, { nowSeconds = Date.now() / 1000, authors = [] } = {}) {
  const { from, to } = resolveTimeRange(filters, nowSeconds);
  const query = parseQuery(filters.query);
  const subs = filters.subreddits?.length ? new Set(filters.subreddits) : null;
  const types = filters.types?.length ? new Set(filters.types) : null;
  const authorSet = filters.authors?.length ? new Set(filters.authors.map((a) => a.toLowerCase())) : null;
  const common = filters.commonOnly ? commonSubreddits(posts, authors) : null;

  return posts.filter((post) => {
    if (!filters.profile && post.isProfile) return false;
    if (!filters.crossposts && post.isCrosspost) return false;
    if (from !== null && post.createdUtc < from) return false;
    if (to !== null && post.createdUtc >= to) return false;
    if (subs && !subs.has(post.subredditKey)) return false;
    if (types && !types.has(post.type)) return false;
    if (filters.onlyImages && !(post.image && (post.type === 'image' || post.type === 'gallery' || post.type === 'crosspost'))) return false;
    if (filters.onlyText && post.type !== 'text') return false;
    if (authorSet && !authorSet.has(post.author.toLowerCase())) return false;
    if (common && !common.has(post.subredditKey)) return false;
    if (query.include.length || query.exclude.length) {
      const text = haystack(post, filters.scope);
      if (!query.include.every((t) => text.includes(t))) return false;
      if (query.exclude.some((t) => text.includes(t))) return false;
    }
    return true;
  });
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

export function sortPosts(posts, sort) {
  const list = [...posts];
  const byNewest = (a, b) => b.createdUtc - a.createdUtc || (a.id < b.id ? 1 : -1);
  switch (sort) {
    case 'oldest': return list.sort((a, b) => a.createdUtc - b.createdUtc || (a.id < b.id ? -1 : 1));
    case 'title': return list.sort((a, b) => collator.compare(a.title, b.title) || byNewest(a, b));
    case 'subreddit': return list.sort((a, b) => collator.compare(a.subreddit, b.subreddit) || byNewest(a, b));
    case 'score':
      // Beiträge ohne verlässliche Kennzahlen werden ans Ende gestellt.
      return list.sort((a, b) => {
        const sa = a.metricsReliable && a.score !== null ? a.score : -Infinity;
        const sb = b.metricsReliable && b.score !== null ? b.score : -Infinity;
        return sb - sa || byNewest(a, b);
      });
    default: return list.sort(byNewest);
  }
}

export function groupBySubreddit(posts) {
  const groups = new Map();
  for (const post of posts) {
    let group = groups.get(post.subredditKey);
    if (!group) {
      group = { key: post.subredditKey, name: post.subreddit, count: 0, oldest: post.createdUtc, newest: post.createdUtc, isProfile: post.isProfile, byAuthor: {}, crossposts: 0 };
      groups.set(post.subredditKey, group);
    }
    group.count += 1;
    if (post.isCrosspost) group.crossposts += 1;
    group.oldest = Math.min(group.oldest, post.createdUtc);
    group.newest = Math.max(group.newest, post.createdUtc);
    const author = post.author.toLowerCase();
    group.byAuthor[author] = (group.byAuthor[author] ?? 0) + 1;
  }
  return [...groups.values()];
}

export function sortGroups(groups, sort) {
  const list = [...groups];
  if (sort === 'name') return list.sort((a, b) => collator.compare(a.name, b.name));
  if (sort === 'recent') return list.sort((a, b) => b.newest - a.newest);
  return list.sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
}

/** Zeitleiste lückenlos zwischen ältestem und neuestem Beitrag (lokale Zeitzone). */
export function buildTimeline(posts, granularity = 'year') {
  if (!posts.length) return [];
  const counts = new Map();
  let min = Infinity;
  let max = -Infinity;
  for (const post of posts) {
    const d = new Date(post.createdUtc * 1000);
    const index = granularity === 'month' ? d.getFullYear() * 12 + d.getMonth() : d.getFullYear();
    counts.set(index, (counts.get(index) ?? 0) + 1);
    min = Math.min(min, index);
    max = Math.max(max, index);
  }
  const buckets = [];
  for (let i = min; i <= max; i += 1) {
    const year = granularity === 'month' ? Math.floor(i / 12) : i;
    const month = granularity === 'month' ? i % 12 : 0;
    const start = new Date(year, month, 1);
    const end = granularity === 'month' ? new Date(year, month + 1, 1) : new Date(year + 1, 0, 1);
    buckets.push({
      label: granularity === 'month' ? start.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }) : String(year),
      from: start.getTime() / 1000,
      to: end.getTime() / 1000,
      count: counts.get(i) ?? 0
    });
  }
  return buckets;
}

export function availableYears(posts) {
  return [...new Set(posts.map((p) => new Date(p.createdUtc * 1000).getFullYear()))].sort((a, b) => b - a);
}

/** Beschreibt aktive Filter für Chips (ohne Sortierung). */
export function activeFilterChips(filters, defaults, labels = {}) {
  const chips = [];
  if (filters.query) chips.push({ key: 'query', label: `Suche: „${filters.query}“${filters.scope === 'title' ? ' (Titel)' : filters.scope === 'body' ? ' (Text)' : ''}` });
  if (filters.period) chips.push({ key: 'period', label: `Zeitraum: ${filters.period.label}` });
  else if (filters.time !== 'all') {
    let label = TIME_PRESETS[filters.time];
    if (filters.time === 'year' && filters.year) label = `Jahr ${filters.year}`;
    if (filters.time === 'custom') label = `${filters.from || '…'} bis ${filters.to || '…'}`;
    chips.push({ key: 'time', label: `Zeit: ${label}` });
  }
  for (const key of filters.subreddits) chips.push({ key: `sub:${key}`, label: `r/${labels[key] ?? key}` });
  for (const type of filters.types) chips.push({ key: `type:${type}`, label: `Typ: ${labels[`type:${type}`] ?? type}` });
  if (filters.crossposts !== defaults.crossposts) chips.push({ key: 'crossposts', label: filters.crossposts ? 'Crossposts sichtbar' : 'Ohne Crossposts' });
  if (filters.profile !== defaults.profile) chips.push({ key: 'profile', label: filters.profile ? 'Mit Profilposts' : 'Ohne Profilposts' });
  if (filters.onlyImages) chips.push({ key: 'onlyImages', label: 'Nur mit Bildern' });
  if (filters.onlyText) chips.push({ key: 'onlyText', label: 'Nur Textbeiträge' });
  for (const author of filters.authors) chips.push({ key: `author:${author}`, label: `u/${author}` });
  if (filters.commonOnly) chips.push({ key: 'commonOnly', label: 'Nur gemeinsame Subreddits' });
  return chips;
}

export function removeFilterChip(filters, key, defaults) {
  const next = { ...filters };
  if (key === 'query') next.query = '';
  else if (key === 'period') next.period = null;
  else if (key === 'time') { next.time = 'all'; next.from = ''; next.to = ''; next.year = null; }
  else if (key.startsWith('sub:')) next.subreddits = filters.subreddits.filter((s) => s !== key.slice(4));
  else if (key.startsWith('type:')) next.types = filters.types.filter((t) => t !== key.slice(5));
  else if (key.startsWith('author:')) next.authors = filters.authors.filter((a) => a !== key.slice(7));
  else if (key in defaults) next[key] = defaults[key];
  return next;
}
