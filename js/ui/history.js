import { h, icon, fmt, button } from '../dom.js';
import { stateBlock } from './feedback.js';
import { TIME_PRESETS, SORTS } from '../filters.js';

function describeFilters(f) {
  const parts = [];
  if (f.time && f.time !== 'all') parts.push(f.time === 'year' ? `Jahr ${f.year}` : f.time === 'custom' ? `${f.from || '…'} – ${f.to || '…'}` : TIME_PRESETS[f.time]);
  if (f.subreddits?.length) parts.push(f.subreddits.map((s) => `r/${s}`).join(', '));
  if (f.query) parts.push(`„${f.query}“`);
  if (f.types?.length) parts.push(`Typen: ${f.types.join(', ')}`);
  parts.push(SORTS[f.sort] ?? SORTS.newest);
  return parts.join(' · ');
}

export function mountHistory(container, ctx) {
  const { state, actions } = ctx;

  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    const id = el.dataset.id;
    if (el.dataset.action === 'hdelete') actions.deleteHistory(id);
    if (el.dataset.action === 'hclear') actions.clearHistory();
    if (el.dataset.action === 'sdelete') actions.deleteSavedSearch(id);
  });

  function render() {
    const completenessLabel = { complete: 'vollständig laut Index', incomplete: 'unvollständig', unknown: 'nicht überprüfbar', partial: 'begrenzt' };
    container.replaceChildren(h('div', { class: 'history' },
      h('header', { class: 'view-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Suchverlauf'),
          h('h1', null, 'Verlauf & gespeicherte Suchen'),
          h('p', { class: 'muted' }, state.settings.historyEnabled
            ? 'Gespeichert werden nur Benutzername(n), Zeitpunkt und Trefferzahlen – keine Inhalte. Suchen werden nur auf deinen ausdrücklichen Klick erneut ausgeführt.'
            : 'Der lokale Suchverlauf ist in den Einstellungen deaktiviert. Neue Suchen werden nicht protokolliert.')),
        h('div', { class: 'head-actions' }, state.history.length ? button('Verlauf löschen', { cls: 'btn ghost danger-text', iconName: 'i-trash', action: 'hclear' }) : null)),
      h('div', { class: 'history-grid' },
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Gespeicherte Suchkonfigurationen')),
          state.savedSearches.length ? h('ul', { class: 'row-list' }, state.savedSearches.map((s) => h('li', { class: 'row-item' },
            h('div', { class: 'ri-main' },
              h('p', { class: 'ri-title' }, s.name),
              h('p', { class: 'ri-meta' }, `${s.authors.map((a) => `u/${a}`).join(' + ')} · ${describeFilters(s.filters)}`)),
            button('Ausführen', { cls: 'btn primary sm', iconName: 'i-search', action: 'run-saved', data: { id: s.id } }),
            button('', { cls: 'icon-btn danger', iconName: 'i-trash', action: 'sdelete', data: { id: s.id }, attrs: { 'aria-label': `Gespeicherte Suche „${s.name}“ löschen`, title: 'Löschen' } }))))
            : h('p', { class: 'muted pad' }, 'Noch keine gespeicherten Suchen. In der Beitragsansicht speichert das Disketten-Symbol Benutzer, Zeitraum, Subreddits, Suchbegriff und Sortierung.')),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Letzte Suchen')),
          state.history.length ? h('ul', { class: 'row-list' }, state.history.map((r) => h('li', { class: 'row-item' },
            icon('i-history', 'ri-icon'),
            h('div', { class: 'ri-main' },
              h('p', { class: 'ri-title' }, r.authors.map((a) => `u/${a}`).join(' + ')),
              h('p', { class: 'ri-meta' }, `${new Date(r.searchedAt).toLocaleString('de-DE')} · ${fmt.num(r.found ?? 0)} Beiträge in ${fmt.num(r.subreddits ?? 0)} Subreddits · ${completenessLabel[r.completeness] ?? r.completeness ?? ''}`)),
            button('Erneut suchen', { cls: 'btn ghost sm', iconName: 'i-refresh', action: 'rerun-history', data: { id: r.id } }),
            button('', { cls: 'icon-btn danger', iconName: 'i-trash', action: 'hdelete', data: { id: r.id }, attrs: { 'aria-label': 'Eintrag löschen', title: 'Eintrag löschen' } }))))
            : stateBlock('empty', { title: 'Kein Verlauf', text: state.settings.historyEnabled ? 'Abgeschlossene Suchen erscheinen hier.' : 'Der Suchverlauf ist deaktiviert.' })))));
  }

  render();
  return { update(reason) { if (reason === 'history' || reason === 'settings') render(); }, destroy() {} };
}
