import { h, icon, fmt, button, extLink, monogram, debounce, fill } from '../dom.js';
import { sortGroups } from '../filters.js';
import { barList } from './charts.js';
import { stateBlock } from './feedback.js';

export function mountExplorer(container, ctx) {
  const { state, actions } = ctx;
  const local = { query: '', sort: 'count' };

  const search = h('input', { type: 'search', placeholder: 'Subreddit-Namen durchsuchen …', 'aria-label': 'Subreddit-Namen durchsuchen', spellcheck: 'false' });
  const sortSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sortierung der Subreddits' },
    [['count', 'Anzahl'], ['name', 'A–Z'], ['recent', 'Jüngste Aktivität']].map(([v, l]) => h('button', { type: 'button', 'data-action': 'xsort', 'data-value': v, 'aria-pressed': 'false' }, l)));
  const exportMenu = h('details', { class: 'menu' },
    h('summary', { class: 'btn ghost' }, icon('i-download'), h('span', null, 'Liste exportieren'), icon('i-chevron-down', 'chev')),
    h('div', { class: 'menu-pop right' },
      h('p', { class: 'menu-note' }, 'Exportiert die aktuell angezeigte Subreddit-Liste mit Anzahl gefundener Beiträge.'),
      ['json', 'csv', 'md'].map((f) => button(f === 'md' ? 'Markdown' : f.toUpperCase(), { cls: 'menu-item', action: 'xexport', data: { format: f } }))));
  const head = h('header', { class: 'view-head' });
  const selectionBar = h('div', { class: 'selection-bar' });
  const list = h('div', { class: 'sub-list', role: 'list', 'aria-label': 'Gefundene Subreddits' });
  const chart = h('div', { class: 'panel chart-panel' });
  const body = h('div', { class: 'explorer-grid' },
    h('div', { class: 'explorer-main' },
      h('div', { class: 'explorer-toolbar' }, h('label', { class: 'search-mini' }, icon('i-search'), search), sortSeg, exportMenu),
      selectionBar,
      list),
    h('aside', { class: 'explorer-side' }, chart));
  const root = h('div', { class: 'explorer' }, head, body);

  search.addEventListener('input', debounce(() => { local.query = search.value.trim().toLowerCase(); renderList(); }, 150));
  root.addEventListener('change', (e) => {
    if (e.target.name !== 'xsel') return;
    const set = new Set(state.filters.subreddits);
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    actions.setFilters({ subreddits: [...set] });
  });
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'xsort') { local.sort = el.dataset.value; renderList(); }
    else if (a === 'xshow') actions.setFilters({ subreddits: [el.dataset.sub] }, { navigate: 'posts' });
    else if (a === 'filter-sub') actions.setFilters({ subreddits: [el.dataset.sub] }, { navigate: 'posts' });
    else if (a === 'xshow-selected') actions.navigate('posts');
    else if (a === 'xshow-all') actions.setFilters({ subreddits: [] }, { navigate: 'posts' });
    else if (a === 'xselect-visible') actions.setFilters({ subreddits: [...new Set([...state.filters.subreddits, ...visible().map((g) => g.key)])] });
    else if (a === 'xclear') actions.setFilters({ subreddits: [] });
    else if (a === 'xexport') { exportMenu.open = false; actions.exportSubreddits(visible(), el.dataset.format); }
  });

  function visible() {
    const { groups } = ctx.derived();
    const filtered = local.query ? groups.filter((g) => g.key.includes(local.query)) : groups;
    return sortGroups(filtered, local.sort);
  }

  function renderHead() {
    const { groups } = ctx.derived();
    const regular = groups.filter((g) => !g.isProfile).length;
    head.replaceChildren(
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Subreddit Explorer'),
        h('h1', null, `${fmt.num(regular)} ${regular === 1 ? 'Subreddit' : 'Subreddits'} mit gefundenen Beiträgen`),
        h('p', { class: 'muted' }, 'Alle Zahlen sind „Gefundene Beiträge“ aus den abgefragten Quellen – keine geprüfte, vollständige Veröffentlichungsstatistik.')),
      h('div', { class: 'head-actions' }, button('Alle Beiträge anzeigen', { cls: 'btn ghost', iconName: 'i-text', action: 'xshow-all' })));
  }

  function renderSelection() {
    const n = state.filters.subreddits.length;
    fill(selectionBar,
      h('span', null, n ? `${n} ausgewählt` : 'Keine Auswahl – alle Subreddits aktiv'),
      button('Sichtbare auswählen', { cls: 'link-btn', action: 'xselect-visible' }),
      n ? button('Auswahl aufheben', { cls: 'link-btn', action: 'xclear' }) : null,
      h('span', { class: 'spacer' }),
      n ? button(`Ausgewählte anzeigen (${n})`, { cls: 'btn primary sm', iconName: 'i-chevron-right', action: 'xshow-selected' }) : null);
  }

  function renderList() {
    for (const b of sortSeg.children) b.setAttribute('aria-pressed', String(b.dataset.value === local.sort));
    const groups = visible();
    const max = Math.max(1, ...groups.map((g) => g.count));
    const selected = new Set(state.filters.subreddits);
    const compare = state.authors.length > 1;
    if (!groups.length) {
      list.replaceChildren(h('p', { class: 'muted pad' }, local.query ? 'Kein Subreddit entspricht der Suche.' : 'Noch keine Subreddits gefunden.'));
    } else {
      list.replaceChildren(...groups.map((g) => {
        const expected = state.session?.expectedFor(g.key);
        const label = g.isProfile ? `u/${g.name.replace(/^u_/i, '')}` : `r/${g.name}`;
        const href = g.isProfile ? `https://www.reddit.com/user/${encodeURIComponent(g.name.replace(/^u_/i, ''))}/` : `https://www.reddit.com/r/${encodeURIComponent(g.name)}/`;
        return h('div', { class: `sub-row${selected.has(g.key) ? ' active' : ''}${g.isProfile ? ' profile' : ''}`, role: 'listitem' },
          h('label', { class: 'sub-check' }, h('input', { type: 'checkbox', name: 'xsel', value: g.key, checked: selected.has(g.key) }), h('span', { class: 'sr-only' }, `${label} auswählen`)),
          monogram(g.name, 'mono-avatar lg'),
          h('div', { class: 'sub-info' },
            h('div', { class: 'sub-title' },
              extLink(href, label, { class: 'sub-name', title: `${label} auf Reddit öffnen` }),
              g.isProfile ? h('span', { class: 'flag-badge' }, 'Profil') : null,
              g.crossposts ? h('span', { class: 'flag-badge muted' }, `${g.crossposts} Crosspost${g.crossposts === 1 ? '' : 's'}`) : null),
            h('div', { class: 'sub-dates' },
              h('span', null, h('span', { class: 'k' }, 'Ältester'), ' ', h('time', { datetime: fmt.iso(g.oldest) }, fmt.date(g.oldest))),
              h('span', null, h('span', { class: 'k' }, 'Neuester'), ' ', h('time', { datetime: fmt.iso(g.newest) }, fmt.date(g.newest))),
              compare ? h('span', { class: 'by-author' }, Object.entries(g.byAuthor).map(([a, c]) => h('span', { class: 'author-chip sm' }, `u/${a}: ${c}`))) : null),
            h('span', { class: 'sub-bar', 'aria-hidden': 'true' }, h('span', { style: { '--w': `${Math.max(2, (g.count / max) * 100).toFixed(1)}%` } }))),
          h('div', { class: 'sub-count' },
            h('strong', { class: 'mono' }, fmt.num(g.count)),
            h('span', null, 'Gefundene Beiträge'),
            expected !== null && expected !== undefined ? h('span', { class: `expected${expected > g.count ? ' warn' : ''}`, title: 'Anzahl laut Archivindex – kann gelöschte, entfernte oder Crossposts mit abweichender Zuordnung enthalten.' }, `Archivindex: ${fmt.num(expected)}`) : null),
          button('Beiträge', { cls: 'btn ghost sm', iconName: 'i-chevron-right', action: 'xshow', data: { sub: g.key }, attrs: { 'aria-label': `Alle Beiträge in ${label} anzeigen` } }));
      }));
    }
  }

  function renderChart() {
    const { groups } = ctx.derived();
    chart.replaceChildren(
      h('div', { class: 'panel-head' }, h('h2', null, 'Verteilung')),
      h('p', { class: 'panel-note' }, 'Gefundene Beiträge je Community (Top 15).'),
      groups.length ? barList(sortGroups(groups, 'count'), { limit: 15, selected: state.filters.subreddits }) : h('p', { class: 'muted' }, 'Keine Daten.'));
  }

  function render() {
    if (!state.session) {
      container.replaceChildren(stateBlock('empty', { title: 'Noch keine Subreddits', text: 'Nach einer Benutzersuche werden hier alle Communities mit gefundenen Beiträgen gruppiert.', actions: [{ label: 'Neue Suche', action: 'nav', data: { view: 'home' }, icon: 'i-search', primary: true }] }));
      return false;
    }
    if (!root.isConnected) container.replaceChildren(root);
    renderHead();
    renderSelection();
    renderList();
    renderChart();
    return true;
  }

  render();
  return { update(reason) { if (reason !== 'select' && reason !== 'findings') render(); }, destroy() {} };
}
