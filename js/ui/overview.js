import { h, icon, fmt, button, extLink } from '../dom.js';
import { buildTimeline, sortGroups } from '../filters.js';
import { externalSearchLinks } from '../adapters/external-search.js';
import { barList, timelineChart } from './charts.js';
import { postCard } from './card.js';
import { stateBlock } from './feedback.js';

export function completenessCallout(session, derived) {
  const st = session.status;
  const items = [];
  let tone = 'info';
  let title;
  if (st.state === 'running') {
    title = 'Suche läuft – Ergebnisse werden laufend ergänzt.';
  } else if (st.state === 'cancelled') {
    tone = 'warn';
    title = 'Suche abgebrochen – die Ergebnisse sind unvollständig.';
  } else if (st.completeness === 'complete') {
    tone = 'ok';
    title = `Alle ${fmt.num(st.expectedTotal ?? 0)} laut Archivindex vorhandenen Beiträge wurden abgerufen.`;
  } else if (st.completeness === 'incomplete') {
    tone = 'warn';
    title = 'Nur unvollständige Daten verfügbar.';
  } else if (st.completeness === 'partial') {
    tone = 'warn';
    title = 'Nur die begrenzte Reddit-Suche wurde verwendet – Ergebnisse sind nie vollständig.';
  } else {
    title = 'Vollständigkeit nicht überprüfbar – der Archivindex war nicht verfügbar.';
  }
  for (const src of st.sources) {
    if (src.error) items.push(`${src.label}${session.authors.length > 1 ? ` (u/${src.author})` : ''}: ${src.error.message}`);
    for (const issue of src.issues ?? []) {
      if (issue.kind === 'index' && st.completeness !== 'unknown') continue;
      const range = issue.range ? ` (Zeitraum ${fmt.date(issue.range.from)} – ${fmt.date(issue.range.to)})` : '';
      items.push(`${issue.message}${range}`);
    }
  }
  const removed = session.collection.rejected.removed;
  if (removed) items.push(removed === 1 ? '1 Beitrag ist laut Datenquelle gelöscht oder entfernt und wird nicht angezeigt.' : `${fmt.num(removed)} Beiträge sind laut Datenquelle gelöscht oder entfernt und werden nicht angezeigt.`);
  const hiddenProfile = derived.all.length - derived.base.length;
  if (hiddenProfile > 0 && !derived.filtersProfile) items.push(`${fmt.plural(hiddenProfile, 'Profilpost', 'Profilposts')} (u/…) ausgeblendet – im Filter „Profilposts“ einblendbar.`);
  if (st.profileCheck) {
    items.push(st.profileCheck.error
      ? `Profilabgleich nicht möglich: ${st.profileCheck.error}`
      : `Begrenzter Profilabgleich: ${fmt.num(st.profileCheck.notListed)} von ${fmt.num(st.profileCheck.checked)} Beiträgen erscheinen nicht in der Profilauflistung${st.profileCheck.exhausted ? '' : ' (Auflistung von Reddit gekürzt)'}. Das bedeutet nicht, dass sie verborgen oder gelöscht sind.`);
  }
  if (st.liveCheck) {
    items.push(st.liveCheck.error ? `Reddit-Statusprüfung fehlgeschlagen: ${st.liveCheck.error}` : `Reddit-Statusprüfung: ${fmt.num(st.liveCheck.checked)} geprüft, ${fmt.num(st.liveCheck.removed)} inzwischen nicht mehr verfügbar und ausgeblendet.`);
  }
  return h('div', { class: `callout ${tone}` },
    icon(tone === 'ok' ? 'i-check' : tone === 'warn' ? 'i-alert' : 'i-info'),
    h('div', null, h('p', { class: 'callout-title' }, title), items.length ? h('ul', { class: 'callout-list' }, items.map((t) => h('li', null, t))) : null));
}

export function mountOverview(container, ctx) {
  const { state, actions } = ctx;
  let granularity = 'year';

  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    const a = el.dataset.action;
    if (a === 'granularity') { granularity = el.dataset.value; render(); }
    else if (a === 'period') {
      actions.setFilters({ period: { from: Number(el.dataset.from), to: Number(el.dataset.to), label: el.dataset.label } }, { navigate: 'posts' });
    } else if (a === 'filter-sub' && !el.closest('.post-card')) {
      actions.setFilters({ subreddits: [el.dataset.sub] }, { navigate: 'posts' });
    }
  });

  function render() {
    const session = state.session;
    if (!session) {
      container.replaceChildren(stateBlock('empty', { title: 'Noch keine Benutzerrecherche', text: 'Starte eine Suche, um hier die Übersicht der gefundenen Subreddit-Beiträge zu sehen.', actions: [{ label: 'Neue Suche', action: 'nav', data: { view: 'home' }, icon: 'i-search', primary: true }] }));
      return;
    }
    const d = ctx.derived();
    const st = session.status;
    if (st.state === 'error' && !d.all.length) {
      container.replaceChildren(stateBlock(st.error?.kind ?? 'server', { details: st.error?.message, actions: [{ label: 'Erneut versuchen', action: 'retry', icon: 'i-refresh', primary: true }, { label: 'Datenquellen prüfen', action: 'open-settings', icon: 'i-settings' }] }));
      return;
    }
    const groups = sortGroups(d.groups, 'count');
    const subCount = groups.filter((g) => !g.isProfile).length;
    const oldest = d.base.length ? Math.min(...d.base.map((p) => p.createdUtc)) : null;
    const newest = d.base.length ? Math.max(...d.base.map((p) => p.createdUtc)) : null;
    const sources = [...new Set(st.sources.map((s) => s.label))];
    const latest = d.baseSorted.slice(0, 4);
    const timeline = buildTimeline(d.base, granularity);

    container.replaceChildren(h('div', { class: 'overview' },
      h('header', { class: 'view-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Benutzerrecherche'),
          h('h1', null, session.authors.map((a, i) => [i ? h('span', { class: 'vs' }, ' + ') : null, h('span', null, `u/${a}`)])),
          h('p', { class: 'muted' }, `Gestartet ${fmt.relative(st.startedAt / 1000)} · ${st.state === 'running' ? 'läuft' : st.state === 'done' ? 'abgeschlossen' : st.state === 'cancelled' ? 'abgebrochen' : 'fehlgeschlagen'}`)),
        h('div', { class: 'head-actions' },
          button('Beiträge anzeigen', { cls: 'btn primary', iconName: 'i-text', action: 'nav', data: { view: 'posts' } }),
          button('Subreddit Explorer', { cls: 'btn ghost', iconName: 'i-layers', action: 'nav', data: { view: 'explorer' } }))),
      h('section', { class: 'stats', 'aria-label': 'Kennzahlen' },
        stat('Gefundene Beiträge', fmt.num(d.base.length), st.expectedTotal !== null ? `Archivindex: ${fmt.num(st.expectedTotal)} insgesamt (inkl. Profil/gelöscht)` : 'eigenständige Beiträge'),
        stat('Gefundene Subreddits', fmt.num(subCount), groups.some((g) => g.isProfile) ? 'ohne Profil-Community' : 'reguläre Communities'),
        stat('Zeitraum der Funde', oldest ? `${fmt.date(oldest)} – ${fmt.date(newest)}` : '–', oldest ? `${new Date(newest * 1000).getFullYear() - new Date(oldest * 1000).getFullYear() + 1} Jahre` : 'noch keine Funde', true),
        stat('Datenquelle', sources.join(' + ') || '–', st.sources.map((s) => sourceState(s)).join(' · '), true)),
      completenessCallout(session, { ...d, filtersProfile: state.filters.profile }),
      h('div', { class: 'overview-grid' },
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Zeitraum-Explorer'),
            h('div', { class: 'seg sm', role: 'group', 'aria-label': 'Zeiteinteilung' },
              ['year', 'month'].map((g) => h('button', { type: 'button', 'data-action': 'granularity', 'data-value': g, 'aria-pressed': String(granularity === g) }, g === 'year' ? 'Jahre' : 'Monate')))),
          h('p', { class: 'panel-note' }, 'Gefundene Beiträge je Zeitraum. Klick auf eine Säule filtert die Beitragsliste.'),
          timelineChart(timeline, { activePeriod: state.filters.period, granularity })),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Communities'), button('Alle im Explorer', { cls: 'link-btn', action: 'nav', data: { view: 'explorer' } })),
          h('p', { class: 'panel-note' }, 'Gefundene Beiträge je Subreddit (Top 8).'),
          groups.length ? barList(groups, { limit: 8 }) : h('p', { class: 'muted' }, st.state === 'running' ? 'Wird geladen …' : 'Keine Subreddits gefunden.'))),
      latest.length ? h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Neueste Funde'), button('Alle Beiträge', { cls: 'link-btn', action: 'nav', data: { view: 'posts' } })),
        h('div', { class: 'card-list compact-cards', 'data-delegate': 'posts' }, latest.map((p) => postCard(p, { settings: state.settings, finding: state.findings.get(p.id), selected: state.selectedId === p.id, compare: session.authors.length > 1 })))) : null,
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Externe Recherchehilfen')),
        h('p', { class: 'panel-note' }, 'Öffnet vorbereitete Suchanfragen in einem neuen Tab. Es erfolgt keine automatische Abfrage oder Auswertung – die Ergebnisse sind nicht Teil der Statistik.'),
        session.authors.map((author) => h('div', { class: 'ext-links' },
          session.authors.length > 1 ? h('p', { class: 'ext-author' }, `u/${author}`) : null,
          externalSearchLinks(author).map((l) => extLink(l.url, [icon('i-external'), h('span', { class: 'ext-engine' }, l.engine), h('code', null, l.query)], { class: 'ext-link' })))))
    ));
  }

  function stat(label, value, hint, small = false) {
    return h('div', { class: 'stat' }, h('p', { class: 'stat-label' }, label), h('p', { class: `stat-value${small ? ' sm' : ''}` }, value), hint ? h('p', { class: 'stat-hint' }, hint) : null);
  }

  function sourceState(s) {
    const map = { running: 'läuft', done: 'fertig', error: 'Fehler', cancelled: 'abgebrochen', pending: 'wartet' };
    return `${s.label}: ${map[s.state] ?? s.state}`;
  }

  render();
  return { update(reason) { if (reason !== 'select') render(); }, destroy() {} };
}
