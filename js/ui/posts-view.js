import { h, icon, fmt, debounce, button, fill } from '../dom.js';
import { POST_TYPES } from '../posts.js';
import { TIME_PRESETS, SORTS, activeFilterChips } from '../filters.js';
import { postCard, tableRow, TABLE_COLUMNS, skeletonCards } from './card.js';
import { stateBlock } from './feedback.js';

const PAGE = 40;

function select(name, options, label) {
  return h('label', { class: 'field inline' }, h('span', { class: 'field-label' }, label),
    h('select', { name }, Object.entries(options).map(([value, text]) => h('option', { value }, text))));
}

function toggle(name, label, hint) {
  return h('label', { class: 'switch', title: hint ?? null },
    h('input', { type: 'checkbox', name, role: 'switch' }),
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    h('span', null, label));
}

export function mountPosts(container, ctx) {
  const { state, actions } = ctx;
  let page = 1;
  let lastFilterKey = '';
  const cache = new Map();
  const seenIds = new Set();
  let cacheStamp = '';

  // ---------- Filterleiste ----------
  const queryInput = h('input', { type: 'search', name: 'query', placeholder: 'Titel und Text durchsuchen …', 'aria-label': 'Suchbegriff', spellcheck: 'false' });
  const subMenuList = h('div', { class: 'menu-list', role: 'group', 'aria-label': 'Subreddits auswählen' });
  const subMenuFilter = h('input', { type: 'search', placeholder: 'Subreddit suchen …', 'aria-label': 'Subreddit-Liste durchsuchen' });
  const subSummary = h('summary', { class: 'btn ghost' }, icon('i-layers'), h('span', { class: 'sum-label' }, 'Alle Subreddits'), icon('i-chevron-down', 'chev'));
  const subMenu = h('details', { class: 'menu sub-menu' }, subSummary,
    h('div', { class: 'menu-pop' },
      subMenuFilter,
      h('div', { class: 'menu-tools' }, button('Auswahl aufheben (alle anzeigen)', { cls: 'link-btn', action: 'subs-none' })),
      subMenuList));

  const typeChips = h('div', { class: 'chip-group', role: 'group', 'aria-label': 'Beitragstyp' },
    Object.entries(POST_TYPES).map(([key, meta]) => h('button', { type: 'button', class: `chip type-${key}`, 'data-action': 'type', 'data-type': key, 'aria-pressed': 'false' }, icon(meta.icon), h('span', null, meta.label))));

  const yearSelect = h('select', { name: 'year', 'aria-label': 'Kalenderjahr' });
  const fromInput = h('input', { type: 'date', name: 'from', 'aria-label': 'Datum von' });
  const toInput = h('input', { type: 'date', name: 'to', 'aria-label': 'Datum bis' });
  const yearWrap = h('label', { class: 'field inline', hidden: true }, h('span', { class: 'field-label' }, 'Jahr'), yearSelect);
  const customWrap = h('div', { class: 'date-range', hidden: true }, fromInput, h('span', { 'aria-hidden': 'true' }, '–'), toInput);

  const compareWrap = h('div', { class: 'compare-filters', hidden: true });

  const exportMenu = h('details', { class: 'menu export-menu' },
    h('summary', { class: 'btn ghost' }, icon('i-download'), h('span', { class: 'label-wide' }, 'Export'), icon('i-chevron-down', 'chev')),
    h('div', { class: 'menu-pop right' },
      h('p', { class: 'menu-note' }, 'Gefilterte Ergebnisse als Metadaten (Link, ID, Subreddit, Datum, eigene Notizen) – ohne fremde Volltexte.'),
      button('JSON', { cls: 'menu-item', action: 'export-results', data: { format: 'json' } }),
      button('CSV', { cls: 'menu-item', action: 'export-results', data: { format: 'csv' } }),
      button('Markdown', { cls: 'menu-item', action: 'export-results', data: { format: 'md' } })));

  const panel = h('form', { class: 'filter-panel', id: 'filter-panel', 'aria-label': 'Filter', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'fp-head' }, h('h2', null, 'Filter'), button('', { cls: 'icon-btn fp-close', iconName: 'i-x', action: 'close-filters', attrs: { 'aria-label': 'Filter schließen' } })),
    h('div', { class: 'fp-row' },
      h('label', { class: 'search-mini' }, icon('i-search'), queryInput),
      select('scope', { both: 'Titel + Text', title: 'Nur Titel', body: 'Nur Text' }, 'Bereich'),
      select('time', TIME_PRESETS, 'Zeitraum'),
      yearWrap,
      customWrap,
      subMenu
    ),
    h('div', { class: 'fp-row' },
      typeChips,
      h('div', { class: 'switches' },
        toggle('crossposts', 'Crossposts'),
        toggle('onlyImages', 'Nur mit Bildern'),
        toggle('onlyText', 'Nur Text'),
        toggle('profile', 'Profilposts', 'Beiträge im eigenen Profil (u/…) einblenden')
      ),
      compareWrap
    )
  );

  const chipsRow = h('div', { class: 'chips-row', 'aria-label': 'Aktive Filter' });
  const countEl = h('p', { class: 'result-count', role: 'status' });
  const sortSelect = h('select', { name: 'sort', 'aria-label': 'Sortierung' }, Object.entries(SORTS).map(([v, t]) => h('option', { value: v }, t)));
  const viewToggle = h('div', { class: 'seg', role: 'group', 'aria-label': 'Darstellung' },
    h('button', { type: 'button', 'data-action': 'mode', 'data-mode': 'cards', 'aria-pressed': 'false', title: 'Kartenansicht' }, icon('i-grid'), h('span', { class: 'label-wide' }, 'Karten')),
    h('button', { type: 'button', 'data-action': 'mode', 'data-mode': 'table', 'aria-pressed': 'false', title: 'Kompakte Tabelle' }, icon('i-table'), h('span', { class: 'label-wide' }, 'Tabelle')));
  const toolbar = h('div', { class: 'results-toolbar' },
    button('Filter', { cls: 'btn ghost filter-open', iconName: 'i-filter', action: 'open-filters' }),
    countEl,
    h('span', { class: 'spacer' }),
    h('label', { class: 'sort-wrap' }, icon('i-sort'), sortSelect),
    viewToggle,
    button('', { cls: 'btn ghost', iconName: 'i-save', action: 'save-search', title: 'Suchkonfiguration speichern', attrs: { 'aria-label': 'Suchkonfiguration speichern' } }),
    exportMenu);

  const listHost = h('div', { class: 'list-host' });
  const root = h('div', { class: 'posts-view' }, panel, chipsRow, toolbar, listHost);
  container.replaceChildren(root);

  // ---------- Formular → Filter ----------
  const pushQuery = debounce(() => actions.setFilters({ query: queryInput.value.trim() }), 250);
  queryInput.addEventListener('input', pushQuery);
  queryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { pushQuery.cancel(); actions.setFilters({ query: queryInput.value.trim() }); } });
  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'scope') actions.setFilters({ scope: t.value });
    else if (t.name === 'time') actions.setFilters({ time: t.value, period: null, year: t.value === 'year' ? (state.filters.year ?? ctx.derived().years[0] ?? new Date().getFullYear()) : state.filters.year });
    else if (t.name === 'year') actions.setFilters({ year: Number(t.value) });
    else if (t.name === 'from' || t.name === 'to') actions.setFilters({ [t.name]: t.value });
    else if (['crossposts', 'onlyImages', 'onlyText', 'profile', 'commonOnly'].includes(t.name)) {
      const patch = { [t.name]: t.checked };
      if (t.name === 'onlyImages' && t.checked) patch.onlyText = false;
      if (t.name === 'onlyText' && t.checked) patch.onlyImages = false;
      actions.setFilters(patch);
    } else if (t.name === 'sub') {
      const set = new Set(state.filters.subreddits);
      if (t.checked) set.add(t.value); else set.delete(t.value);
      actions.setFilters({ subreddits: [...set] });
    } else if (t.name === 'author') {
      const set = new Set(state.filters.authors);
      if (t.checked) set.add(t.value); else set.delete(t.value);
      actions.setFilters({ authors: [...set] });
    }
  });
  subMenuFilter.addEventListener('input', () => renderSubMenu());
  sortSelect.addEventListener('change', () => actions.setFilters({ sort: sortSelect.value }));

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const action = el.dataset.action;
    switch (action) {
      case 'type': {
        const set = new Set(state.filters.types);
        const type = el.dataset.type;
        if (set.has(type)) set.delete(type); else set.add(type);
        actions.setFilters({ types: [...set] });
        break;
      }
      case 'subs-none': actions.setFilters({ subreddits: [] }); subMenu.open = false; break;
      case 'chip-remove': actions.removeChip(el.dataset.key); break;
      case 'reset-filters': actions.resetFilters(); break;
      case 'mode': actions.setViewMode(el.dataset.mode); break;
      case 'save-search': actions.saveSearch(); break;
      case 'export-results': exportMenu.open = false; actions.exportResults(el.dataset.format); break;
      case 'open-filters': panel.classList.add('open'); queryInput.focus(); break;
      case 'close-filters': panel.classList.remove('open'); break;
      case 'sort': actions.setFilters({ sort: state.filters.sort === el.dataset.sort && el.dataset.alt ? el.dataset.alt : el.dataset.sort }); break;
      default: return;
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('open')) panel.classList.remove('open');
  });

  // ---------- Synchronisation ----------
  function setValue(el, value) {
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value ?? '';
  }

  function syncForm() {
    const f = state.filters;
    setValue(queryInput, f.query);
    setValue(panel.elements.scope, f.scope);
    setValue(panel.elements.time, f.period ? 'all' : f.time);
    yearWrap.hidden = f.time !== 'year' || Boolean(f.period);
    customWrap.hidden = f.time !== 'custom' || Boolean(f.period);
    setValue(fromInput, f.from);
    setValue(toInput, f.to);
    for (const name of ['crossposts', 'onlyImages', 'onlyText', 'profile']) setValue(panel.elements[name], f[name]);
    for (const chip of typeChips.children) chip.setAttribute('aria-pressed', String(f.types.includes(chip.dataset.type)));
    setValue(sortSelect, f.sort);
    for (const b of viewToggle.children) b.setAttribute('aria-pressed', String(b.dataset.mode === state.viewMode));
    const n = f.subreddits.length;
    subSummary.querySelector('.sum-label').textContent = n ? `${n} Subreddit${n === 1 ? '' : 's'}` : 'Alle Subreddits';
    subSummary.classList.toggle('active', n > 0);
  }

  function renderYears() {
    const years = ctx.derived().years;
    const current = state.filters.year;
    const list = years.length ? years : [new Date().getFullYear()];
    yearSelect.replaceChildren(...list.map((y) => h('option', { value: String(y) }, String(y))));
    if (current) yearSelect.value = String(current);
  }

  function renderSubMenu() {
    const { groups } = ctx.derived();
    const q = subMenuFilter.value.trim().toLowerCase();
    const selected = new Set(state.filters.subreddits);
    const list = groups.filter((g) => !q || g.key.includes(q)).sort((a, b) => b.count - a.count).slice(0, 300);
    subMenuList.replaceChildren(...(list.length ? list.map((g) => h('label', { class: 'menu-check' },
      h('input', { type: 'checkbox', name: 'sub', value: g.key, checked: selected.has(g.key) }),
      h('span', { class: 'mc-name' }, g.isProfile ? `u/${g.name.replace(/^u_/i, '')}` : `r/${g.name}`),
      h('span', { class: 'mc-count mono' }, fmt.num(g.count)))) : [h('p', { class: 'menu-note' }, 'Keine Subreddits gefunden.')]));
  }

  function renderCompare() {
    const authors = state.authors;
    compareWrap.hidden = authors.length < 2;
    if (authors.length < 2) return;
    const selected = new Set(state.filters.authors);
    fill(compareWrap,
      h('span', { class: 'field-label' }, 'Autoren'),
      ...authors.map((a) => h('label', { class: 'menu-check pill' }, h('input', { type: 'checkbox', name: 'author', value: a, checked: selected.has(a) }), h('span', null, `u/${a}`))),
      toggle('commonOnly', 'Nur gemeinsame Subreddits'));
    setValue(compareWrap.querySelector('[name=commonOnly]'), state.filters.commonOnly);
  }

  function renderChips() {
    const { labels } = ctx.derived();
    const chips = activeFilterChips(state.filters, state.filterDefaults, labels);
    chipsRow.hidden = !chips.length;
    fill(chipsRow,
      ...chips.map((c) => h('button', { type: 'button', class: 'filter-chip', 'data-action': 'chip-remove', 'data-key': c.key, 'aria-label': `Filter entfernen: ${c.label}` }, h('span', null, c.label), icon('i-x'))),
      chips.length > 1 ? button('Alle zurücksetzen', { cls: 'link-btn', action: 'reset-filters' }) : null);
  }

  function renderCount() {
    const { filtered, base, all } = ctx.derived();
    const running = state.session?.status.state === 'running';
    if (!state.session) { countEl.textContent = ''; return; }
    const hiddenProfile = all.length - base.length;
    fill(countEl,
      h('strong', null, fmt.num(filtered.length)),
      ` von ${fmt.plural(base.length, 'gefundenem Beitrag', 'gefundenen Beiträgen')}`,
      running ? h('span', { class: 'live-pill' }, h('span', { class: 'pulse' }), 'Suche läuft') : null,
      hiddenProfile > 0 && !state.filters.profile ? h('span', { class: 'muted' }, ` · ${fmt.num(hiddenProfile)} Profilposts ausgeblendet`) : null);
  }

  // ---------- Liste ----------
  function emptyState() {
    const session = state.session;
    if (!session) {
      return stateBlock('empty', { title: 'Noch keine Recherche', text: 'Gib oben einen Reddit-Benutzernamen ein, um seine eigenständigen Subreddit-Beiträge zu finden.', actions: [{ label: 'Zur Startseite', action: 'nav', data: { view: 'home' }, icon: 'i-search' }] });
    }
    const { all, base } = ctx.derived();
    if (session.status.state === 'running') return h('div', { class: 'card-list' }, skeletonCards(3));
    if (!all.length || !base.length) {
      const removed = session.collection.rejected.removed;
      const parts = [];
      if (all.length && !base.length) parts.push(`${fmt.num(all.length)} Beiträge liegen nur im eigenen Profil (u/…) und sind ausgeblendet.`);
      if (removed) parts.push(`${fmt.num(removed)} gelöschte oder entfernte Beiträge werden bewusst nicht angezeigt.`);
      parts.push('Die Ergebnisse hängen von der Abdeckung der Datenquellen ab.');
      return stateBlock(session.status.state === 'error' ? (session.status.error?.kind ?? 'server') : 'empty', {
        title: session.status.state === 'error' ? undefined : 'Keine eigenständigen Subreddit-Beiträge gefunden',
        text: session.status.state === 'error' ? session.status.error?.message : parts.join(' '),
        actions: all.length && !base.length ? [{ label: 'Profilposts einblenden', action: 'show-profile', primary: true }] : [{ label: 'Erneut suchen', action: 'retry', icon: 'i-refresh' }]
      });
    }
    return stateBlock('empty', { title: 'Keine Beiträge entsprechen den Filtern', text: 'Passe die Filter an oder setze sie zurück.', actions: [{ label: 'Filter zurücksetzen', action: 'reset-filters', primary: true }] });
  }

  function stampFor() {
    const s = state.settings;
    return `${s.loadImages}|${s.blurNsfw}|${state.authors.length}|${state.findingsVersion}`;
  }

  function cardFor(post) {
    const finding = state.findings.get(post.id);
    const isNew = !seenIds.has(post.id) && state.session?.status.state === 'running';
    seenIds.add(post.id);
    const key = `${post.sources.length}|${post.score}|${finding ? `${finding.favorite}|${finding.note ? 1 : 0}` : 'x'}`;
    const cached = cache.get(post.id);
    if (cached && cached.key === key) return cached.el;
    const el = postCard(post, { settings: state.settings, finding, selected: state.selectedId === post.id, compare: state.authors.length > 1, isNew });
    cache.set(post.id, { key, el });
    return el;
  }

  let observer = null;
  const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });

  function renderCards(items) {
    const count = Math.min(items.length, page * PAGE);
    const list = listHost.querySelector('.card-list') ?? h('div', { class: 'card-list' });
    const els = items.slice(0, count).map(cardFor);
    for (const el of els) el.classList.toggle('selected', el.dataset.id === state.selectedId);
    list.replaceChildren(...els);
    if (!list.isConnected) listHost.replaceChildren(list);
    if (count < items.length) {
      sentinel.textContent = '';
      list.after(sentinel);
      sentinel.replaceChildren(h('span', null, `${fmt.num(count)} von ${fmt.num(items.length)} angezeigt`), button('Weitere laden', { cls: 'btn ghost sm', action: 'more' }));
      observer ??= new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { page += 1; renderList(); }
      }, { root: document.getElementById('view'), rootMargin: '600px' });
      observer.observe(sentinel);
    } else {
      sentinel.remove();
    }
  }

  // Virtualisierte Tabelle mit fester Zeilenhöhe.
  let vt = null;
  function renderTable(items) {
    const rowH = state.settings.density === 'compact' ? 38 : 46;
    if (!vt || !vt.root.isConnected) {
      const head = h('div', { class: 'vt-head', role: 'row', 'aria-rowindex': '1' },
        TABLE_COLUMNS.map((c) => h('div', { role: 'columnheader', class: `c-${c.key}` },
          c.sort ? h('button', { type: 'button', 'data-action': 'sort', 'data-sort': c.sort, 'data-alt': c.altSort ?? null }, c.label, icon('i-sort')) : c.label)));
      const body = h('div', { class: 'vt-body', role: 'rowgroup' });
      const rows = h('div', { class: 'vt-rows' });
      body.append(rows);
      const rootEl = h('div', { class: 'vtable', role: 'table', 'aria-label': 'Gefundene Beiträge' }, head, h('div', { role: 'rowgroup' }), body);
      vt = { root: rootEl, head, body, rows, items: [], rowH, start: -1, end: -1 };
      listHost.replaceChildren(rootEl);
    }
    vt.items = items;
    vt.rowH = rowH;
    vt.root.setAttribute('aria-rowcount', String(items.length + 1));
    vt.body.style.setProperty('height', `${items.length * rowH}px`);
    vt.root.style.setProperty('--row-h', `${rowH}px`);
    for (const btn of vt.head.querySelectorAll('[data-sort]')) {
      const active = state.filters.sort === btn.dataset.sort || state.filters.sort === btn.dataset.alt;
      btn.parentElement.setAttribute('aria-sort', active ? (state.filters.sort === 'oldest' ? 'ascending' : 'descending') : 'none');
    }
    vt.start = -1;
    paintTable();
  }

  function paintTable() {
    if (!vt || !vt.root.isConnected) return;
    const scroller = document.getElementById('view');
    const offset = scroller.getBoundingClientRect().top - vt.body.getBoundingClientRect().top;
    const visible = Math.ceil(scroller.clientHeight / vt.rowH);
    const start = Math.max(0, Math.floor(offset / vt.rowH) - 8);
    const end = Math.min(vt.items.length, start + visible + 16);
    if (start === vt.start && end === vt.end) return;
    vt.start = start;
    vt.end = end;
    const compare = state.authors.length > 1;
    vt.rows.style.setProperty('transform', `translateY(${start * vt.rowH}px)`);
    vt.rows.replaceChildren(...vt.items.slice(start, end).map((post, i) => tableRow(post, { finding: state.findings.get(post.id), selected: state.selectedId === post.id, index: start + i, compare })));
  }

  let scrollRaf = 0;
  const onScroll = () => {
    if (state.viewMode !== 'table' || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; paintTable(); });
  };
  const scroller = document.getElementById('view');
  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  function renderList() {
    const { filtered } = ctx.derived();
    if (!filtered.length) {
      vt = null;
      sentinel.remove();
      listHost.replaceChildren(emptyState());
      return;
    }
    if (state.viewMode === 'table') {
      sentinel.remove();
      renderTable(filtered);
    } else {
      if (vt) { vt = null; listHost.replaceChildren(); }
      renderCards(filtered);
    }
  }

  listHost.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'more') { page += 1; renderList(); }
    if (el.dataset.action === 'show-profile') actions.setFilters({ profile: true });
  });
  function update(reason) {
    const stamp = stampFor();
    if (stamp !== cacheStamp) { cache.clear(); cacheStamp = stamp; }
    const filterKey = JSON.stringify(state.filters) + state.viewMode;
    if (filterKey !== lastFilterKey) {
      if (lastFilterKey) {
        page = 1;
        const top = root.offsetTop - 8;
        if (scroller.scrollTop > top && reason === 'filters') scroller.scrollTop = Math.max(0, top);
      }
      lastFilterKey = filterKey;
    }
    if (reason === 'select') {
      for (const el of listHost.querySelectorAll('[data-id]')) el.classList.toggle('selected', el.dataset.id === state.selectedId);
      return;
    }
    syncForm();
    if (reason !== 'findings') {
      renderYears();
      renderSubMenu();
      renderCompare();
    }
    renderChips();
    renderCount();
    renderList();
  }

  update('init');
  return {
    update,
    destroy() {
      observer?.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    }
  };
}
