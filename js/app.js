import { APP_VERSION, DEFAULT_SETTINGS, SOURCES } from './config.js';
import { normalizeUsername, sameUser } from './username.js';
import { RequestScheduler } from './net.js';
import { ArcticShiftAdapter } from './adapters/arctic-shift.js';
import { RedditLocalAdapter } from './adapters/reddit-local.js';
import { SearchSession } from './search-engine.js';
import { POST_TYPES, detectRemoval } from './posts.js';
import { decodeEntities } from './text.js';
import { applyFilters, sortPosts, groupBySubreddit, availableYears, defaultFilters, removeFilterChip } from './filters.js';
import { settingsStore, findingsStore, historyStore, savedSearchStore, findingFromPost, exportLocalData, clearAllLocalData } from './storage.js';
import { findingsToJson, findingsToCsv, findingsToMarkdown, resultsExport, subredditsExport, downloadText } from './export.js';
import { copyText, fmt } from './dom.js';
import { toast, confirmDialog, promptDialog } from './ui/feedback.js';
import { mountHome } from './ui/home.js';
import { mountOverview } from './ui/overview.js';
import { mountExplorer } from './ui/explorer.js';
import { mountPosts } from './ui/posts-view.js';
import { mountFindings } from './ui/findings.js';
import { mountHistory } from './ui/history.js';
import { mountDetail } from './ui/detail.js';
import { mountSettings } from './ui/settings.js';
import { renderStatusbar, liveSummary } from './ui/statusbar.js';

const $ = (sel) => document.querySelector(sel);
const appEl = $('#app');
const viewHost = $('#view');

const state = {
  settings: { ...DEFAULT_SETTINGS },
  view: 'home',
  session: null,
  authors: [],
  filters: defaultFilters(DEFAULT_SETTINGS),
  filterDefaults: defaultFilters(DEFAULT_SETTINGS),
  viewMode: DEFAULT_SETTINGS.defaultView,
  selectedId: null,
  detailOpen: false,
  findings: new Map(),
  findingsVersion: 0,
  findingsLive: new Map(),
  history: [],
  savedSearches: [],
  online: navigator.onLine !== false,
  compareMode: false,
  sourceStatus: { 'arctic-shift': { state: 'unknown' }, 'reddit-local': { state: 'unknown' } },
  diagnostics: [],
  requestStats: null
};

let filtersVersion = 0;
let derivedCache = { key: '', value: null };

function derived() {
  const coll = state.session?.collection;
  const key = `${coll ? coll.version : -1}|${coll ? coll.size : 0}|${filtersVersion}|${state.authors.join(',')}`;
  if (derivedCache.key === key && derivedCache.value) return derivedCache.value;
  const all = coll ? coll.all() : [];
  const f = state.filters;
  const authorSet = f.authors.length ? new Set(f.authors.map((a) => a.toLowerCase())) : null;
  const base = all.filter((p) => (f.profile || !p.isProfile) && (!authorSet || authorSet.has(p.author.toLowerCase())));
  const groups = groupBySubreddit(base);
  const labels = {};
  for (const g of groupBySubreddit(all)) labels[g.key] = g.name;
  for (const [k, m] of Object.entries(POST_TYPES)) labels[`type:${k}`] = m.label;
  const value = {
    all,
    base,
    baseSorted: sortPosts(base, 'newest'),
    groups,
    filtered: sortPosts(applyFilters(all, f, { authors: state.authors }), f.sort),
    years: availableYears(base),
    labels
  };
  derivedCache = { key, value };
  return value;
}

function diag(source, kind, message) {
  state.diagnostics.push({ at: Date.now(), source, kind, message });
  if (state.diagnostics.length > 50) state.diagnostics.splice(0, state.diagnostics.length - 50);
}

// ---------------------------------------------------------------- Views
const mounts = { home: mountHome, overview: mountOverview, explorer: mountExplorer, posts: mountPosts, findings: mountFindings, history: mountHistory };
let current = { name: null, ctrl: null };
let detail;
let settingsUi;

function navigate(view, { focus = true } = {}) {
  if (!mounts[view]) view = 'home';
  current.ctrl?.destroy?.();
  for (const d of viewHost.querySelectorAll('details[open]')) d.open = false;
  const container = document.createElement('div');
  container.className = 'view-inner view-enter';
  viewHost.replaceChildren(container);
  state.view = view;
  current = { name: view, ctrl: mounts[view](container, ctx) };
  viewHost.scrollTop = 0;
  closeMenu();
  try { history.replaceState(null, '', `#${view}`); } catch { /* file:// o. Ä. */ }
  updateChrome();
  if (focus) {
    const target = view === 'home' ? container.querySelector('input[name=user1]') : viewHost;
    target?.focus({ preventScroll: true });
  }
}

function notify(reason) {
  current.ctrl?.update(reason);
  if (['data', 'findings', 'settings', 'end', 'filters'].includes(reason) && state.detailOpen) detail.update(reason);
  if (reason === 'settings') settingsUi.update();
  updateChrome();
}

function updateChrome() {
  appEl.dataset.view = state.view;
  const hasSession = Boolean(state.session);
  const running = state.session?.status.state === 'running';
  for (const el of document.querySelectorAll('.nav-item[data-view], .tab[data-view]')) {
    const active = el.dataset.view === state.view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  }
  const d = hasSession ? derived() : null;
  const counts = {
    posts: d ? d.base.length : null,
    subreddits: d ? d.groups.filter((g) => !g.isProfile).length : null,
    findings: state.findings.size || null
  };
  for (const el of document.querySelectorAll('.nav-count')) {
    const value = counts[el.dataset.count];
    el.textContent = value ? fmt.num(value) : '';
  }
  $('#tabs').hidden = !hasSession || !['overview', 'explorer', 'posts', 'findings'].includes(state.view);
  for (const btn of document.querySelectorAll('.search-cancel')) btn.hidden = !running;
  for (const btn of document.querySelectorAll('.search-submit span')) btn.textContent = running ? 'Neu starten' : 'Suchen';
  const detailVisible = state.detailOpen && ['overview', 'explorer', 'posts'].includes(state.view);
  appEl.dataset.detail = detailVisible ? 'open' : 'closed';
  const detailBtn = $('[data-action="toggle-detail"]');
  detailBtn.setAttribute('aria-pressed', String(state.detailOpen));
  detailBtn.hidden = !['overview', 'explorer', 'posts'].includes(state.view);
  renderStatusbar($('#statusbar'), ctx);
  if (state.view === 'home' && !hasSession) $('#statusbar').hidden = true;
  const conn = $('#conn-state');
  conn.classList.toggle('offline', !state.online);
  conn.querySelector('.conn-label').textContent = state.online ? 'Online' : 'Offline – nur lokale Daten';
}

// ---------------------------------------------------------------- Theme
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const mode = state.settings.theme;
  const dark = mode === 'dark' || (mode === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.density = state.settings.density;
  const use = document.querySelector('.theme-icon use');
  use?.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  document.querySelector('[data-action="toggle-theme"]')?.setAttribute('aria-label', dark ? 'Zum hellen Farbschema wechseln' : 'Zum dunklen Farbschema wechseln');
}
darkQuery.addEventListener('change', () => { if (state.settings.theme === 'system') applyAppearance(); });

// ---------------------------------------------------------------- Suche
function buildSources() {
  const s = state.settings;
  const arcticScheduler = new RequestScheduler({ ...SOURCES.arcticShift });
  const arctic = new ArcticShiftAdapter({ scheduler: arcticScheduler });
  const adapters = [];
  const schedulers = [arcticScheduler];
  let reddit = null;
  if (s.redditAdapterEnabled) {
    try {
      const redditScheduler = new RequestScheduler({ ...SOURCES.redditLocal });
      reddit = new RedditLocalAdapter({ scheduler: redditScheduler, baseUrl: s.redditAdapterUrl });
      schedulers.push(redditScheduler);
    } catch (err) {
      toast(err.message, { kind: 'error' });
      diag('Reddit-Adapter', err.kind ?? 'client', err.message);
    }
  }
  if (s.preferredSource === 'reddit-local' && !reddit) {
    toast('Der Reddit-Adapter ist nicht aktiviert – es wird Arctic Shift verwendet.', { kind: 'info' });
  }
  if (s.preferredSource !== 'reddit-local' || !reddit) adapters.push(arctic);
  if (reddit && (s.preferredSource === 'both' || s.preferredSource === 'reddit-local')) adapters.push(reddit);
  return { adapters, schedulers, liveAdapter: reddit, arctic };
}

function startSearch(authors, { filters = null, view = 'overview' } = {}) {
  if (!state.online) {
    toast('Keine Internetverbindung – neue Recherchen sind offline nicht möglich.', { kind: 'error' });
    return;
  }
  state.session?.cancel();
  const { adapters, schedulers, liveAdapter } = buildSources();
  const session = new SearchSession({ authors, adapters, schedulers, liveAdapter, profileCompare: state.settings.profileCompare, maxResults: state.settings.maxResults });
  state.session = session;
  state.authors = authors;
  state.filterDefaults = defaultFilters(state.settings);
  state.filters = { ...state.filterDefaults, ...(filters ?? {}), period: null, authors: [] };
  filtersVersion += 1;
  state.selectedId = null;
  setFormValues(authors);
  let timer = 0;
  let last = 0;
  session.addEventListener('update', () => {
    if (state.session !== session || timer) return;
    const wait = Math.max(0, 300 - (Date.now() - last));
    timer = setTimeout(() => {
      timer = 0;
      last = Date.now();
      if (state.session === session) notify('data');
    }, wait);
  });
  session.addEventListener('end', () => onSessionEnd(session));
  navigate(view, { focus: false });
  $('#live-status').textContent = `Suche nach Beiträgen von ${authors.map((a) => `u/${a}`).join(' und ')} gestartet.`;
  session.run();
}

async function onSessionEnd(session) {
  if (state.session !== session) return;
  const st = session.status;
  state.requestStats = session.requests?.stats ?? null;
  for (const src of st.sources) {
    if (src.error) diag(src.label, src.error.kind, src.error.message);
    for (const issue of src.issues ?? []) if (issue.severity === 'gap') diag(src.label, issue.kind, issue.message);
    state.sourceStatus[src.id] = src.state === 'done' ? { state: 'ok', checkedAt: Date.now() } : src.state === 'error' ? { state: 'error', message: src.error?.message, checkedAt: Date.now() } : state.sourceStatus[src.id];
  }
  notify('end');
  $('#live-status').textContent = liveSummary(ctx);
  const d = derived();
  if (st.state === 'done') toast(`${fmt.plural(d.base.length, 'Beitrag', 'Beiträge')} in ${fmt.plural(d.groups.filter((g) => !g.isProfile).length, 'Subreddit', 'Subreddits')} gefunden.`, { kind: 'ok' });
  if (st.state === 'error') toast(st.error?.message ?? 'Suche fehlgeschlagen.', { kind: 'error', timeout: 6000 });
  if (st.state !== 'cancelled' && state.settings.historyEnabled && st.state !== 'error') {
    try {
      await historyStore.add({ authors: session.authors, found: d.base.length, subreddits: d.groups.filter((g) => !g.isProfile).length, completeness: st.completeness });
      state.history = await historyStore.all();
      notify('history');
    } catch (err) {
      diag('Speicher', 'storage', err.message);
    }
  }
}

function setFormValues(authors) {
  for (const form of document.querySelectorAll('.search-form')) {
    form.elements.user1.value = authors[0] ?? '';
    form.elements.user2.value = authors[1] ?? '';
    for (const input of form.querySelectorAll('input')) input.removeAttribute('aria-invalid');
    form.querySelector('.form-error').textContent = '';
  }
  if (authors.length > 1 && !state.compareMode) toggleCompare(true);
}

function toggleCompare(force) {
  state.compareMode = force ?? !state.compareMode;
  for (const form of document.querySelectorAll('.search-form')) {
    form.querySelector('.search-field.second').hidden = !state.compareMode;
    for (const btn of form.querySelectorAll('.compare-toggle')) {
      btn.setAttribute('aria-pressed', String(state.compareMode));
      if (btn.classList.contains('link-btn')) btn.lastChild.textContent = state.compareMode ? 'Vergleich ausblenden' : 'Zweiten Benutzer vergleichen';
    }
    if (!state.compareMode) form.elements.user2.value = '';
  }
}

function handleSearchSubmit(form) {
  const errorEl = form.querySelector('.form-error');
  const input1 = form.elements.user1;
  const input2 = form.elements.user2;
  const fail = (input, message) => {
    errorEl.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  for (const input of [input1, input2]) input.removeAttribute('aria-invalid');
  const first = normalizeUsername(input1.value);
  if (!first.ok) return fail(input1, first.error);
  const authors = [first.username];
  const secondVisible = !form.querySelector('.search-field.second').hidden;
  if (secondVisible && input2.value.trim()) {
    const second = normalizeUsername(input2.value);
    if (!second.ok) return fail(input2, second.error);
    if (sameUser(second.username, first.username)) return fail(input2, 'Bitte zwei verschiedene Benutzernamen eingeben.');
    authors.push(second.username);
  }
  errorEl.textContent = '';
  startSearch(authors);
}

// ---------------------------------------------------------------- Fundstellen
async function persistFinding(record, message) {
  try {
    const saved = await findingsStore.save(record);
    state.findings.set(saved.id, saved);
    state.findingsVersion += 1;
    if (message) toast(message, { kind: 'ok' });
    notify('findings');
    return saved;
  } catch (err) {
    toast('Fundstelle konnte nicht gespeichert werden.', { kind: 'error' });
    diag('Speicher', 'storage', err.message);
    return null;
  }
}

async function removeFinding(id) {
  try {
    await findingsStore.remove(id);
    state.findings.delete(id);
    state.findingsVersion += 1;
    toast('Fundstelle entfernt.');
    notify('findings');
  } catch (err) {
    toast('Fundstelle konnte nicht entfernt werden.', { kind: 'error' });
  }
}

let refreshing = false;
async function refreshFindings({ force = false } = {}) {
  if (!state.online || refreshing || !state.findings.size) return;
  const ids = [...state.findings.keys()].filter((id) => force || !state.findingsLive.has(id));
  if (!ids.length) return;
  refreshing = true;
  const coll = state.session?.collection;
  const remaining = [];
  for (const id of ids) {
    const post = coll?.byId.get(id);
    if (post && !force) state.findingsLive.set(id, { status: 'ok', title: post.title, author: post.author });
    else remaining.push(id);
  }
  try {
    if (remaining.length) {
      const { arctic, liveAdapter } = buildSources();
      const rows = await arctic.fetchByIds(remaining);
      const byId = new Map(rows.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
      for (const id of remaining) {
        const raw = byId.get(id);
        if (!raw) state.findingsLive.set(id, { status: 'missing' });
        else if (detectRemoval(raw)) state.findingsLive.set(id, { status: 'removed' });
        else state.findingsLive.set(id, { status: 'ok', title: decodeEntities(raw.title ?? ''), author: String(raw.author ?? '') });
      }
      if (liveAdapter) {
        try {
          const live = await liveAdapter.info(remaining);
          const liveIds = new Map(live.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
          for (const id of remaining) {
            const raw = liveIds.get(id);
            if (!raw || detectRemoval(raw)) state.findingsLive.set(id, { status: 'removed' });
          }
        } catch (err) {
          diag('Reddit-Adapter', err.kind ?? 'client', err.message);
        }
      }
    }
    if (force) toast('Fundstellen wurden über die Quelle aktualisiert.', { kind: 'ok' });
  } catch (err) {
    diag('Arctic Shift', err.kind ?? 'client', err.message);
    toast(`Fundstellen konnten nicht aktualisiert werden: ${err.message}`, { kind: 'error' });
  } finally {
    refreshing = false;
    notify('findings-live');
  }
}

function exportFilename(prefix, ext) {
  const date = new Date().toISOString().slice(0, 10);
  const who = state.authors.length ? `-${state.authors.join('-')}` : '';
  return `${prefix}${who}-${date}.${ext}`.replace(/[^\w.-]+/g, '_');
}

// ---------------------------------------------------------------- Aktionen
const actions = {
  navigate,
  retry() {
    if (state.authors.length) startSearch(state.authors, { filters: state.filters, view: state.view === 'home' ? 'overview' : state.view });
  },
  cancel() { state.session?.cancel(); },
  setFilters(patch, { navigate: target } = {}) {
    state.filters = { ...state.filters, ...patch };
    if ('time' in patch || 'year' in patch || 'from' in patch || 'to' in patch) {
      if (!('period' in patch)) state.filters.period = null;
    }
    filtersVersion += 1;
    if (target && target !== state.view) navigate(target, { focus: false });
    notify('filters');
  },
  resetFilters() {
    state.filters = { ...state.filterDefaults, sort: state.filters.sort };
    filtersVersion += 1;
    notify('filters');
  },
  removeChip(key) {
    state.filters = removeFilterChip(state.filters, key, state.filterDefaults);
    filtersVersion += 1;
    notify('filters');
  },
  selectPost(id, { open = false } = {}) {
    state.selectedId = id;
    if (open) state.detailOpen = true;
    updateChrome();
    detail.show(id);
    notify('select');
  },
  toggleDetail(force) {
    state.detailOpen = force ?? !state.detailOpen;
    if (state.detailOpen) detail.show(state.selectedId);
    actions.updateSettings({ detailPanel: state.detailOpen }, { silent: true });
    updateChrome();
    if (!state.detailOpen) document.querySelector(`[data-id="${CSS.escape(state.selectedId ?? '')}"] [data-action="details"]`)?.focus({ preventScroll: true });
  },
  setViewMode(mode) {
    state.viewMode = mode === 'table' ? 'table' : 'cards';
    actions.updateSettings({ defaultView: state.viewMode }, { silent: true });
    notify('filters');
  },
  async toggleFinding(post) {
    if (state.findings.has(post.id)) return removeFinding(post.id);
    return persistFinding(findingFromPost(post), 'Als Fundstelle gemerkt.');
  },
  async toggleFavorite(post) {
    const existing = state.findings.get(post.id);
    if (existing) return persistFinding({ ...existing, favorite: !existing.favorite });
    return persistFinding(findingFromPost(post, { favorite: true }), 'Als Favorit gemerkt.');
  },
  async updateFinding(post, patch) {
    const existing = state.findings.get(post.id) ?? findingFromPost(post);
    return persistFinding({ ...existing, ...patch });
  },
  saveFindingRecord: (record) => persistFinding(record),
  removeFinding,
  async clearFindings() {
    if (!await confirmDialog({ title: 'Alle Fundstellen löschen?', text: 'Alle gespeicherten Fundstellen mit Notizen und Tags werden aus diesem Browser entfernt.', confirmLabel: 'Löschen' })) return;
    await findingsStore.clear();
    state.findings.clear();
    state.findingsVersion += 1;
    notify('findings');
  },
  refreshFindings,
  async copyLink(url) {
    if (!url) return;
    toast(await copyText(url) ? 'Link kopiert.' : 'Kopieren nicht möglich.', { kind: 'ok' });
  },
  exportFindings(list, format) {
    if (!list.length) { toast('Keine Fundstellen für den Export ausgewählt.'); return; }
    const content = format === 'csv' ? findingsToCsv(list) : format === 'md' ? findingsToMarkdown(list) : findingsToJson(list);
    downloadText(exportFilename('fundstellen', format), content, format);
  },
  exportResults(format) {
    const { filtered } = derived();
    if (!filtered.length) { toast('Keine Ergebnisse zum Exportieren.'); return; }
    downloadText(exportFilename('ergebnisse', format), resultsExport(filtered, format, state.findings), format);
  },
  exportSubreddits(groups, format) {
    if (!groups.length) { toast('Keine Subreddits zum Exportieren.'); return; }
    downloadText(exportFilename('subreddits', format), subredditsExport(groups, format), format);
  },
  async exportLocalData() {
    downloadText(exportFilename('reddit-investigator-lokal', 'json'), JSON.stringify(await exportLocalData(), null, 2), 'json');
  },
  async saveSearch() {
    if (!state.authors.length) return;
    const name = await promptDialog({ title: 'Suchkonfiguration speichern', label: 'Name', value: state.authors.map((a) => `u/${a}`).join(' + ') });
    if (name === null) return;
    await savedSearchStore.add({ name, authors: state.authors, filters: state.filters });
    state.savedSearches = await savedSearchStore.all();
    toast('Suchkonfiguration gespeichert.', { kind: 'ok' });
    notify('history');
  },
  async deleteSavedSearch(id) {
    await savedSearchStore.remove(id);
    state.savedSearches = await savedSearchStore.all();
    notify('history');
  },
  async deleteHistory(id) {
    await historyStore.remove(id);
    state.history = await historyStore.all();
    notify('history');
  },
  async clearHistory() {
    if (!await confirmDialog({ title: 'Suchverlauf löschen?', text: 'Alle Einträge des lokalen Suchverlaufs werden entfernt.', confirmLabel: 'Löschen' })) return;
    await historyStore.clear();
    state.history = [];
    notify('history');
    toast('Suchverlauf gelöscht.');
  },
  async clearAllData() {
    if (!await confirmDialog({ title: 'Alle lokalen Daten löschen?', text: 'Einstellungen, Fundstellen, Notizen, Suchverlauf und gespeicherte Suchen werden unwiderruflich aus diesem Browser entfernt.', confirmLabel: 'Alles löschen' })) return;
    await clearAllLocalData();
    state.settings = { ...DEFAULT_SETTINGS };
    state.findings.clear();
    state.findingsLive.clear();
    state.findingsVersion += 1;
    state.history = [];
    state.savedSearches = [];
    state.viewMode = state.settings.defaultView;
    applyAppearance();
    toast('Alle lokalen Daten wurden gelöscht.', { kind: 'ok' });
    notify('settings');
    notify('findings');
    notify('history');
  },
  async updateSettings(patch, { silent = false } = {}) {
    if ('redditAdapterUrl' in patch) {
      try {
        RedditLocalAdapter.validateBaseUrl(patch.redditAdapterUrl);
      } catch (err) {
        toast(err.message, { kind: 'error' });
        return;
      }
    }
    state.settings = { ...state.settings, ...patch };
    if ('defaultView' in patch && !silent) state.viewMode = patch.defaultView;
    if ('density' in patch || 'theme' in patch) applyAppearance();
    if ('redditAdapterEnabled' in patch || 'redditAdapterUrl' in patch) state.sourceStatus['reddit-local'] = { state: 'unknown' };
    try {
      await settingsStore.save(state.settings);
    } catch (err) {
      diag('Speicher', 'storage', err.message);
    }
    if (!silent) notify('settings');
  },
  async testSource(id) {
    state.sourceStatus[id] = { state: 'testing' };
    settingsUi.update();
    try {
      let adapter;
      if (id === 'reddit-local') {
        adapter = new RedditLocalAdapter({ scheduler: new RequestScheduler({ ...SOURCES.redditLocal, retries: 0 }), baseUrl: state.settings.redditAdapterUrl });
      } else {
        adapter = new ArcticShiftAdapter({ scheduler: new RequestScheduler({ ...SOURCES.arcticShift, retries: 1 }) });
      }
      const result = await adapter.test();
      state.sourceStatus[id] = { state: result.ok ? 'ok' : 'warn', latencyMs: result.latencyMs, message: result.message, checkedAt: Date.now() };
      toast(result.message, { kind: result.ok ? 'ok' : 'info' });
      if (!result.ok) diag(adapter.label, 'config', result.message);
    } catch (err) {
      const label = id === 'reddit-local' ? 'Reddit-Adapter' : 'Arctic Shift';
      const message = id === 'reddit-local' && err.kind === 'network'
        ? 'Der lokale Reddit-Adapter ist nicht erreichbar. Läuft der Dienst aus dem Ordner server/?'
        : err.message;
      state.sourceStatus[id] = { state: 'error', message, checkedAt: Date.now() };
      diag(label, err.kind ?? 'client', message);
      toast(message, { kind: 'error', timeout: 6000 });
    }
    settingsUi.update();
  }
};

const ctx = { state, actions, derived };

// ---------------------------------------------------------------- Ereignisse
function openMenu() {
  appEl.classList.add('menu-open');
  $('#scrim').hidden = false;
  $('#sidebar .nav-item')?.focus();
}
function closeMenu() {
  appEl.classList.remove('menu-open');
  $('#scrim').hidden = true;
}

document.addEventListener('submit', (e) => {
  const form = e.target.closest('.search-form');
  if (!form) return;
  e.preventDefault();
  handleSearchSubmit(form);
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    const nav = e.target.closest('.nav-item[data-view], .tab[data-view]');
    if (nav) navigate(nav.dataset.view);
    return;
  }
  const a = el.dataset.action;
  const inPost = el.closest('.post-card, .vt-row, #detail');
  const id = el.closest('[data-id]')?.dataset.id;
  const post = id ? state.session?.collection.byId.get(id) : null;
  switch (a) {
    case 'open-menu': openMenu(); break;
    case 'close-menu': closeMenu(); break;
    case 'open-settings': settingsUi.open(); break;
    case 'toggle-theme': {
      const dark = document.documentElement.dataset.theme === 'dark';
      actions.updateSettings({ theme: dark ? 'light' : 'dark' });
      break;
    }
    case 'toggle-detail': actions.toggleDetail(); break;
    case 'toggle-compare': toggleCompare(); el.closest('form')?.elements.user2?.focus(); break;
    case 'cancel-search': actions.cancel(); break;
    case 'retry': actions.retry(); break;
    case 'unblur-nsfw':
      await actions.updateSettings({ blurNsfw: false });
      toast('NSFW- und Spoiler-Bilder werden dauerhaft ohne Unschärfe angezeigt. Änderbar in den Einstellungen.', { kind: 'ok' });
      break;
    case 'nav': navigate(el.dataset.view); break;
    case 'rerun-history': {
      const rec = state.history.find((r) => r.id === el.dataset.id);
      if (rec) startSearch(rec.authors);
      break;
    }
    case 'run-saved': {
      const rec = state.savedSearches.find((r) => r.id === el.dataset.id);
      if (rec) startSearch(rec.authors, { filters: rec.filters, view: 'posts' });
      break;
    }
    default:
      if (!inPost) return;
      if (a === 'details' && post) actions.selectPost(post.id, { open: true });
      else if (a === 'filter-sub') actions.setFilters({ subreddits: [el.dataset.sub] }, { navigate: 'posts' });
      else if (a === 'copy' && post) actions.copyLink(post.permalink);
      else if (a === 'save' && post) actions.toggleFinding(post);
      else if (a === 'favorite' && post) actions.toggleFavorite(post);
      else if (a === 'expand') {
        const p = el.previousElementSibling;
        const open = !p.classList.toggle('clamped');
        el.textContent = open ? 'Weniger anzeigen' : 'Mehr anzeigen';
        el.setAttribute('aria-expanded', String(open));
      }
  }
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    (state.view === 'home' ? viewHost.querySelector('input[name=user1]') : $('#top-search input[name=user1]'))?.focus();
  }
  if (e.key === 'Escape') {
    if (appEl.classList.contains('menu-open')) { closeMenu(); $('.menu-btn').focus(); return; }
    const openMenuEl = document.querySelector('details.menu[open]');
    if (openMenuEl) { openMenuEl.open = false; openMenuEl.querySelector('summary').focus(); return; }
    if (state.detailOpen && window.matchMedia('(max-width: 1279px)').matches && !document.querySelector('dialog[open]')) actions.toggleDetail(false);
  }
});

// Offene Dropdown-Menüs beim Klick außerhalb schließen.
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('details.menu[open]')) if (!d.contains(e.target)) d.open = false;
});

window.addEventListener('online', () => { state.online = true; notify('online'); toast('Wieder online.', { kind: 'ok' }); });
window.addEventListener('offline', () => { state.online = false; notify('online'); toast('Offline – neue Recherchen sind nicht möglich.', { kind: 'error' }); });

// ---------------------------------------------------------------- Start
async function init() {
  $('#app-version').textContent = `Subreddit-Post-Recherche · v${APP_VERSION}`;
  detail = mountDetail($('#detail'), ctx);
  settingsUi = mountSettings($('#settings-dialog'), ctx);
  try {
    state.settings = await settingsStore.load();
    const [findings, historyRows, saved] = await Promise.all([findingsStore.all(), historyStore.all(), savedSearchStore.all()]);
    for (const f of findings) state.findings.set(f.id, f);
    state.history = historyRows;
    state.savedSearches = saved;
  } catch (err) {
    diag('Speicher', 'storage', err.message);
    toast('Lokaler Speicher nicht verfügbar – Fundstellen können nicht gesichert werden.', { kind: 'error', timeout: 6000 });
  }
  state.viewMode = state.settings.defaultView;
  state.detailOpen = state.settings.detailPanel && window.matchMedia('(min-width: 1280px)').matches;
  state.filterDefaults = defaultFilters(state.settings);
  state.filters = { ...state.filterDefaults };
  applyAppearance();
  detail.show(null);
  const hashView = location.hash.slice(1);
  navigate(['findings', 'history'].includes(hashView) ? hashView : 'home', { focus: false });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch((err) => diag('Offline-Cache', 'sw', err.message));
  }
}

init();

// Für Browsertests und Diagnose.
window.__redditInvestigator = { state, actions, derived };
