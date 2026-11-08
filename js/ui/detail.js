import { h, icon, fmt, extLink, monogram, debounce, button } from '../dom.js';
import { typeBadge, crosspostLine } from './card.js';

export function mountDetail(host, ctx) {
  const { state, actions } = ctx;
  let currentId = null;

  const saveNote = debounce((post, patch) => actions.updateFinding(post, patch), 400);

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'close-detail') actions.toggleDetail(false);
    if (el.dataset.action === 'expand-full') {
      const text = host.querySelector('.detail-text');
      text.classList.toggle('clamped');
      el.textContent = text.classList.contains('clamped') ? 'Gesamten Text anzeigen' : 'Text einklappen';
    }
  });
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.target.closest('textarea, input')) actions.toggleDetail(false);
  });

  function placeholder() {
    return h('div', { class: 'detail-inner empty' },
      h('div', { class: 'detail-top' }, h('h2', null, 'Details'), button('', { cls: 'icon-btn', iconName: 'i-x', action: 'close-detail', attrs: { 'aria-label': 'Detailspalte schließen' } })),
      h('div', { class: 'detail-empty' }, icon('i-panel'), h('p', null, 'Wähle einen Beitrag aus, um Details, Quellen und deine Notiz zu sehen.')));
  }

  function render() {
    const post = currentId ? state.session?.collection.byId.get(currentId) : null;
    if (!post) {
      host.replaceChildren(placeholder());
      return;
    }
    const finding = state.findings.get(post.id);
    const long = post.text.length > 1400;
    const showImage = state.settings.loadImages && post.image;
    const blurred = state.settings.blurNsfw && (post.over18 || post.spoiler);
    const note = h('textarea', { id: 'detail-note', rows: '4', maxlength: '5000', placeholder: 'Eigene Notiz zu dieser Fundstelle …' });
    note.value = finding?.note ?? '';
    note.addEventListener('input', () => saveNote(post, { note: note.value }));
    const tags = h('input', { id: 'detail-tags', type: 'text', placeholder: 'z. B. wichtig, quelle', maxlength: '400' });
    tags.value = (finding?.tags ?? []).join(', ');
    tags.addEventListener('change', () => actions.updateFinding(post, { tags: tags.value }));
    const collection = h('input', { id: 'detail-collection', type: 'text', placeholder: 'Optional', maxlength: '60' });
    collection.value = finding?.collection ?? '';
    collection.addEventListener('change', () => actions.updateFinding(post, { collection: collection.value }));

    const sources = [];
    if (post.sources.includes('arctic-shift')) sources.push(h('li', null, h('strong', null, 'Arctic-Shift-Archiv'), ' – im Archiv enthalten', post.retrievedOn ? `, archiviert am ${fmt.dateTime(post.retrievedOn)}` : ''));
    if (post.sources.includes('reddit-local')) sources.push(h('li', null, h('strong', null, 'Reddit-Suche'), ' – in aktuellen Reddit-Suchergebnissen gefunden'));
    if (post.liveChecked) sources.push(h('li', null, h('strong', null, 'Reddit-Status'), ' – aktuell auf Reddit verfügbar (geprüft)'));
    if (post.profileListed === true) sources.push(h('li', null, 'In der begrenzten Profilauflistung enthalten'));
    if (post.profileListed === false) sources.push(h('li', null, 'Nicht in der begrenzten Profilauflistung gefunden – daraus folgt nicht, dass der Beitrag verborgen oder gelöscht ist.'));

    host.replaceChildren(h('div', { class: 'detail-inner', 'aria-live': 'off' },
      h('div', { class: 'detail-top' },
        h('div', { class: 'detail-sub' }, monogram(post.subreddit), h('span', null, post.isProfile ? `u/${post.subreddit.replace(/^u_/i, '')} (Profil)` : `r/${post.subreddit}`)),
        button('', { cls: 'icon-btn', iconName: 'i-x', action: 'close-detail', attrs: { 'aria-label': 'Detailspalte schließen' } })),
      h('h2', { class: 'detail-title', tabindex: '-1' }, extLink(post.permalink, post.title, { title: 'Auf Reddit in neuem Tab öffnen' })),
      h('div', { class: 'detail-meta' },
        typeBadge(post),
        h('time', { datetime: fmt.iso(post.createdUtc) }, `${fmt.long(post.createdUtc)}, ${fmt.time(post.createdUtc)} Uhr`),
        h('span', { class: 'muted' }, fmt.relative(post.createdUtc))),
      h('p', { class: 'detail-author' }, icon('i-user'), `u/${post.author}`),
      crosspostLine(post),
      showImage ? h('figure', { class: `detail-image${blurred ? ' blurred' : ''}` },
        h('img', { src: post.image.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
        blurred ? h('button', { type: 'button', class: 'thumb-flag unblur', 'data-action': 'unblur-nsfw', title: 'Unschärfe dauerhaft aufheben' }, `${post.over18 ? 'NSFW' : 'Spoiler'} · anzeigen`) : null) : null,
      post.text ? h('div', { class: `detail-text${long ? ' clamped' : ''}` }, post.text) : null,
      long ? h('button', { type: 'button', class: 'link-btn', 'data-action': 'expand-full' }, 'Gesamten Text anzeigen') : null,
      post.externalUrl ? h('p', { class: 'detail-ext' }, icon('i-link'), extLink(post.externalUrl, post.externalUrl.length > 70 ? `${post.externalUrl.slice(0, 70)}…` : post.externalUrl)) : null,
      h('div', { class: 'detail-metrics' },
        post.metricsReliable
          ? [post.score !== null ? h('span', null, icon('i-arrow-up'), `${fmt.num(post.score)} Score`) : null, post.numComments !== null ? h('span', null, icon('i-message'), `${fmt.num(post.numComments)} Kommentare`) : null]
          : h('span', { class: 'muted' }, 'Score und Kommentare sind für sehr neue Archivdaten noch nicht verlässlich.')),
      h('div', { class: 'detail-actions' },
        extLink(post.permalink, [icon('i-external'), h('span', null, 'Auf Reddit öffnen')], { class: 'btn primary' }),
        h('button', { type: 'button', class: 'btn ghost icon-only', 'data-action': 'copy', 'data-id': post.id, 'aria-label': 'Link kopieren', title: 'Link kopieren' }, icon('i-copy')),
        h('button', { type: 'button', class: `btn ghost icon-only${finding ? ' active' : ''}`, 'data-action': 'save', 'data-id': post.id, 'aria-pressed': String(Boolean(finding)), 'aria-label': finding ? 'Fundstelle entfernen' : 'Als Fundstelle merken', title: finding ? 'Fundstelle entfernen' : 'Als Fundstelle merken' }, icon(finding ? 'i-bookmark-fill' : 'i-bookmark')),
        h('button', { type: 'button', class: `btn ghost icon-only fav${finding?.favorite ? ' active' : ''}`, 'data-action': 'favorite', 'data-id': post.id, 'aria-pressed': String(Boolean(finding?.favorite)), 'aria-label': 'Als Favorit markieren', title: 'Als Favorit markieren' }, icon(finding?.favorite ? 'i-star-fill' : 'i-star'))),
      h('section', { class: 'detail-section' },
        h('h3', null, icon('i-note'), 'Persönliche Notiz'),
        h('label', { class: 'field' }, h('span', { class: 'sr-only' }, 'Notiz'), note),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags (kommagetrennt)'), tags),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Sammlung'), collection)),
        h('p', { class: 'small muted' }, finding ? `Gemerkt am ${new Date(finding.savedAt).toLocaleString('de-DE')}. Notizen bleiben lokal in diesem Browser.` : 'Eine Notiz merkt den Beitrag automatisch als Fundstelle. Gespeichert werden nur Link, ID, Subreddit, Datum und deine Angaben.')),
      h('section', { class: 'detail-section' },
        h('h3', null, icon('i-database'), 'Quellen'),
        h('ul', { class: 'source-items' }, sources)),
      h('section', { class: 'detail-section tech' },
        h('h3', null, 'Technische Metadaten'),
        h('dl', { class: 'kv mono' },
          h('dt', null, 'Post-ID'), h('dd', null, post.id),
          h('dt', null, 'Fullname'), h('dd', null, post.fullname),
          h('dt', null, 'created_utc'), h('dd', null, String(post.createdUtc)),
          post.crosspostParentId ? [h('dt', null, 'crosspost_parent'), h('dd', null, `t3_${post.crosspostParentId}`)] : null,
          post.domain ? [h('dt', null, 'Domain'), h('dd', null, post.domain)] : null))
    ));
  }

  return {
    show(id) {
      currentId = id;
      render();
      host.querySelector('.detail-title')?.focus({ preventScroll: true });
    },
    update(reason) {
      if (reason === 'findings' && document.activeElement && host.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
      render();
    },
    get currentId() { return currentId; }
  };
}
