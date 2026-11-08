import { h, icon, fmt, button, extLink, debounce, fill } from '../dom.js';
import { stateBlock } from './feedback.js';

export function mountFindings(container, ctx) {
  const { state, actions } = ctx;
  const local = { query: '', tag: '', collection: '', favorites: false, selected: new Set(), editing: null };

  const search = h('input', { type: 'search', placeholder: 'Notizen, Tags, Subreddits durchsuchen …', 'aria-label': 'Fundstellen durchsuchen' });
  search.addEventListener('input', debounce(() => { local.query = search.value.trim().toLowerCase(); renderList(); }, 150));
  const head = h('header', { class: 'view-head' });
  const tools = h('div', { class: 'findings-tools' });
  const list = h('div', { class: 'finding-list', role: 'list' });
  const root = h('div', { class: 'findings' }, head, tools, list);

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'fsel') { if (t.checked) local.selected.add(t.value); else local.selected.delete(t.value); renderTools(); }
    if (t.name === 'fcollection') { local.collection = t.value; renderList(); }
    if (t.name === 'ffav') { local.favorites = t.checked; renderList(); }
  });
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.closest('[data-fid]')?.dataset.fid;
    switch (el.dataset.action) {
      case 'ftag': local.tag = local.tag === el.dataset.tag ? '' : el.dataset.tag; renderTools(); renderList(); break;
      case 'fedit': local.editing = local.editing === id ? null : id; renderList(); root.querySelector(`[data-fid="${CSS.escape(id)}"] textarea`)?.focus(); break;
      case 'fremove': await actions.removeFinding(id); local.selected.delete(id); break;
      case 'ffav': { const f = state.findings.get(id); if (f) await actions.saveFindingRecord({ ...f, favorite: !f.favorite }); break; }
      case 'fselect-all': for (const f of filtered()) local.selected.add(f.id); renderTools(); renderList(); break;
      case 'fselect-none': local.selected.clear(); renderTools(); renderList(); break;
      case 'frefresh': actions.refreshFindings({ force: true }); break;
      case 'fexport': {
        const scope = el.dataset.scope;
        const items = scope === 'selected' ? [...state.findings.values()].filter((f) => local.selected.has(f.id)) : filtered();
        el.closest('details').open = false;
        actions.exportFindings(items, el.dataset.format);
        break;
      }
      case 'fclear-all': actions.clearFindings(); break;
      default: break;
    }
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-fid]');
    if (!form) return;
    e.preventDefault();
    const f = state.findings.get(form.dataset.fid);
    if (!f) return;
    await actions.saveFindingRecord({ ...f, note: form.elements.note.value, tags: form.elements.tags.value, collection: form.elements.collection.value });
    local.editing = null;
    renderList();
  });

  function all() {
    return [...state.findings.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  function filtered() {
    return all().filter((f) => {
      if (local.favorites && !f.favorite) return false;
      if (local.tag && !f.tags.includes(local.tag)) return false;
      if (local.collection && f.collection !== local.collection) return false;
      if (local.query) {
        const live = state.findingsLive.get(f.id);
        const hay = `${f.subreddit} ${f.note} ${f.tags.join(' ')} ${f.collection} ${live?.title ?? ''}`.toLowerCase();
        if (!hay.includes(local.query)) return false;
      }
      return true;
    });
  }

  function renderHead() {
    const n = state.findings.size;
    head.replaceChildren(
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Gespeicherte Fundstellen'),
        h('h1', null, `${fmt.num(n)} ${n === 1 ? 'Fundstelle' : 'Fundstellen'}`),
        h('p', { class: 'muted' }, 'Lokal gespeichert: Link, Post-ID, Subreddit, Datum, Notiz, Tags und Sammlung. Titel werden beim Öffnen live aus der Quelle geladen, nicht dauerhaft gespeichert.')),
      h('div', { class: 'head-actions' },
        button('Über Quelle aktualisieren', { cls: 'btn ghost', iconName: 'i-refresh', action: 'frefresh', attrs: { disabled: !state.online || !n } })));
  }

  function renderTools() {
    const tagCounts = new Map();
    const collections = new Set();
    for (const f of state.findings.values()) {
      for (const t of f.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      if (f.collection) collections.add(f.collection);
    }
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
    const exportMenu = h('details', { class: 'menu' },
      h('summary', { class: 'btn ghost' }, icon('i-download'), h('span', null, 'Exportieren'), icon('i-chevron-down', 'chev')),
      h('div', { class: 'menu-pop right' },
        h('p', { class: 'menu-label' }, `Gefilterte (${filtered().length})`),
        h('div', { class: 'menu-row' }, ['json', 'csv', 'md'].map((f) => button(f === 'md' ? 'Markdown' : f.toUpperCase(), { cls: 'menu-item', action: 'fexport', data: { format: f, scope: 'filtered' } }))),
        h('p', { class: 'menu-label' }, `Ausgewählte (${local.selected.size})`),
        h('div', { class: 'menu-row' }, ['json', 'csv', 'md'].map((f) => button(f === 'md' ? 'Markdown' : f.toUpperCase(), { cls: 'menu-item', action: 'fexport', data: { format: f, scope: 'selected' }, attrs: { disabled: !local.selected.size } })))));
    fill(tools,
      h('div', { class: 'tools-row' },
        h('label', { class: 'search-mini' }, icon('i-search'), search),
        collections.size ? h('label', { class: 'field inline' }, h('span', { class: 'field-label' }, 'Sammlung'),
          h('select', { name: 'fcollection' }, h('option', { value: '' }, 'Alle'), [...collections].sort().map((c) => h('option', { value: c, selected: c === local.collection }, c)))) : null,
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', name: 'ffav', role: 'switch', checked: local.favorites }), h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', null, 'Nur Favoriten')),
        h('span', { class: 'spacer' }),
        button('Alle auswählen', { cls: 'link-btn', action: 'fselect-all' }),
        local.selected.size ? button('Auswahl aufheben', { cls: 'link-btn', action: 'fselect-none' }) : null,
        exportMenu),
      tags.length ? h('div', { class: 'chip-group tags', role: 'group', 'aria-label': 'Nach Tag filtern' },
        tags.map(([t, c]) => h('button', { type: 'button', class: 'chip', 'data-action': 'ftag', 'data-tag': t, 'aria-pressed': String(local.tag === t) }, icon('i-tag'), h('span', null, t), h('span', { class: 'chip-count' }, String(c))))) : null);
  }

  function liveBadge(f) {
    const live = state.findingsLive.get(f.id);
    if (!live) return h('span', { class: 'status-badge muted' }, state.online ? 'nicht geprüft' : 'offline – nicht geprüft');
    if (live.status === 'ok') return h('span', { class: 'status-badge ok' }, 'verfügbar');
    if (live.status === 'removed') return h('span', { class: 'status-badge danger' }, 'nicht mehr verfügbar');
    return h('span', { class: 'status-badge warn' }, 'nicht in der Quelle gefunden');
  }

  function renderList() {
    const items = filtered();
    if (!state.findings.size) {
      list.replaceChildren(stateBlock('empty', { title: 'Noch keine Fundstellen', text: 'Markiere Beiträge in der Ergebnisliste mit dem Lesezeichen-Symbol, um sie hier mit Notizen und Tags zu sammeln.' }));
      return;
    }
    if (!items.length) {
      list.replaceChildren(h('p', { class: 'muted pad' }, 'Keine Fundstelle entspricht den Filtern.'));
      return;
    }
    list.replaceChildren(...items.map((f) => {
      const live = state.findingsLive.get(f.id);
      const title = live?.status === 'ok' ? live.title : live?.status === 'removed' ? 'Inhalt auf Reddit nicht mehr verfügbar – wird nicht angezeigt' : state.online ? 'Titel wird über die Quelle geladen …' : 'Titel offline nicht verfügbar';
      const editing = local.editing === f.id;
      return h('article', { class: `finding${f.favorite ? ' fav' : ''}${local.selected.has(f.id) ? ' selected' : ''}`, role: 'listitem', dataset: { fid: f.id } },
        h('label', { class: 'sub-check' }, h('input', { type: 'checkbox', name: 'fsel', value: f.id, checked: local.selected.has(f.id) }), h('span', { class: 'sr-only' }, 'Fundstelle auswählen')),
        h('div', { class: 'finding-main' },
          h('div', { class: 'finding-top' },
            h('span', { class: 'pc-sub static' }, `r/${f.subreddit}`),
            f.publishedUtc ? h('time', { datetime: fmt.iso(f.publishedUtc) }, fmt.date(f.publishedUtc)) : null,
            liveBadge(f),
            f.collection ? h('span', { class: 'flag-badge' }, f.collection) : null),
          h('p', { class: `finding-title${live?.status === 'ok' ? '' : ' muted'}` }, title),
          live?.status === 'ok' && live.author ? h('p', { class: 'small muted' }, `u/${live.author}`) : null,
          f.tags.length ? h('div', { class: 'tag-row' }, f.tags.map((t) => h('span', { class: 'tag' }, icon('i-tag'), t))) : null,
          f.note && !editing ? h('p', { class: 'finding-note' }, f.note) : null,
          editing ? h('form', { class: 'finding-edit', dataset: { fid: f.id } },
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notiz'), Object.assign(h('textarea', { name: 'note', rows: '3', maxlength: '5000' }), { value: f.note })),
            h('div', { class: 'field-row' },
              h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags (kommagetrennt)'), h('input', { name: 'tags', value: f.tags.join(', '), maxlength: '400' })),
              h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Sammlung'), h('input', { name: 'collection', value: f.collection, maxlength: '60' }))),
            h('div', { class: 'form-actions' }, button('Abbrechen', { cls: 'btn ghost sm', action: 'fedit' }), h('button', { type: 'submit', class: 'btn primary sm' }, 'Speichern'))) : null,
          h('p', { class: 'finding-foot mono' }, `ID ${f.id} · gemerkt ${new Date(f.savedAt).toLocaleDateString('de-DE')}`)),
        h('div', { class: 'finding-actions' },
          extLink(f.url, icon('i-external'), { class: 'icon-btn', title: 'Auf Reddit öffnen', 'aria-label': 'Auf Reddit öffnen' }),
          h('button', { type: 'button', class: `icon-btn fav${f.favorite ? ' active' : ''}`, 'data-action': 'ffav', 'aria-pressed': String(f.favorite), 'aria-label': 'Favorit', title: 'Favorit' }, icon(f.favorite ? 'i-star-fill' : 'i-star')),
          h('button', { type: 'button', class: 'icon-btn', 'data-action': 'fedit', 'aria-label': 'Notiz und Tags bearbeiten', title: 'Bearbeiten', 'aria-expanded': String(editing) }, icon('i-note')),
          h('button', { type: 'button', class: 'icon-btn danger', 'data-action': 'fremove', 'aria-label': 'Fundstelle entfernen', title: 'Entfernen' }, icon('i-trash'))));
    }));
  }

  function render() {
    if (!root.isConnected) container.replaceChildren(root);
    renderHead();
    renderTools();
    renderList();
  }

  render();
  actions.refreshFindings({ force: false });
  return {
    update(reason) {
      if (reason === 'findings' || reason === 'online' || reason === 'findings-live') {
        if (root.contains(document.activeElement) && document.activeElement.matches('textarea, input[name=tags], input[name=collection]')) return;
        for (const id of [...local.selected]) if (!state.findings.has(id)) local.selected.delete(id);
        renderHead();
        renderTools();
        renderList();
      }
    },
    destroy() {}
  };
}
