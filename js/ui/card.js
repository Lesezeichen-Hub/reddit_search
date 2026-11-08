import { h, icon, extLink, fmt, monogram } from '../dom.js';
import { POST_TYPES } from '../posts.js';
import { excerpt } from '../text.js';

const SOURCE_LABELS = { 'arctic-shift': 'Archiv', 'reddit-local': 'Reddit-Suche' };

export function typeBadge(post) {
  const meta = POST_TYPES[post.type] ?? POST_TYPES.link;
  return h('span', { class: `type-badge type-${post.type}`, title: meta.label }, icon(meta.icon), h('span', null, meta.label));
}

export function sourceBadges(post) {
  return post.sources.map((s) => h('span', { class: `src-badge src-${s}`, title: s === 'arctic-shift' ? 'Im Arctic-Shift-Archiv enthalten' : 'In aktuellen Reddit-Suchergebnissen gefunden' }, SOURCE_LABELS[s] ?? s));
}

function thumb(post, settings) {
  if (!settings.loadImages || !post.image) return null;
  const blurred = settings.blurNsfw && (post.over18 || post.spoiler);
  const img = h('img', {
    src: post.image.url,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
    width: post.image.width ?? null,
    height: post.image.height ?? null
  });
  img.addEventListener('error', () => img.closest('.pc-thumb')?.classList.add('broken'), { once: true });
  return h('figure', { class: `pc-thumb${blurred ? ' blurred' : ''}` },
    img,
    post.type === 'video' ? h('span', { class: 'thumb-overlay' }, icon('i-play')) : null,
    post.type === 'gallery' ? h('span', { class: 'thumb-overlay' }, icon('i-gallery')) : null,
    blurred ? h('span', { class: 'thumb-flag' }, post.over18 ? 'NSFW' : 'Spoiler') : null
  );
}

function metrics(post) {
  if (!post.metricsReliable) return null;
  const items = [];
  if (post.score !== null) items.push(h('span', { class: 'metric', title: 'Score (Datenstand der Quelle)' }, icon('i-arrow-up'), fmt.num(post.score)));
  if (post.numComments !== null) items.push(h('span', { class: 'metric', title: 'Kommentare (Datenstand der Quelle)' }, icon('i-message'), fmt.num(post.numComments)));
  return items;
}

export function crosspostLine(post) {
  if (!post.isCrosspost) return null;
  const parts = ['Crosspost'];
  if (post.crosspostParentSubreddit) parts.push(`von r/${post.crosspostParentSubreddit}`);
  if (post.crosspostParentAuthor && post.crosspostParentAuthor.toLowerCase() === post.author.toLowerCase()) parts.push('(eigenes Original)');
  else if (post.crosspostParentAuthor) parts.push(`(Original von u/${post.crosspostParentAuthor})`);
  return h('p', { class: 'pc-xpost' }, icon('i-crosspost'), parts.join(' '));
}

export function postCard(post, { settings, finding, selected, compare, isNew }) {
  const text = post.text ? excerpt(post.text, 900) : '';
  const long = text.length > 320;
  const card = h('article', {
    class: `post-card${post.image && settings.loadImages ? ' has-image' : ''}${selected ? ' selected' : ''}${isNew ? ' is-new' : ''}`,
    dataset: { id: post.id },
    'aria-labelledby': `t-${post.id}`
  },
    h('header', { class: 'pc-head' },
      monogram(post.subreddit),
      h('button', { type: 'button', class: 'pc-sub', 'data-action': 'filter-sub', 'data-sub': post.subredditKey, title: `Nur r/${post.subreddit} anzeigen` }, post.isProfile ? `u/${post.subreddit.replace(/^u_/i, '')} (Profil)` : `r/${post.subreddit}`),
      h('span', { class: 'dot-sep', 'aria-hidden': 'true' }),
      h('time', { datetime: fmt.iso(post.createdUtc), title: fmt.relative(post.createdUtc) }, fmt.date(post.createdUtc), h('span', { class: 'pc-time' }, fmt.time(post.createdUtc))),
      h('span', { class: 'pc-badges' },
        typeBadge(post),
        post.over18 ? h('span', { class: 'flag-badge' }, 'NSFW') : null,
        post.isProfile ? h('span', { class: 'flag-badge' }, 'Profilpost') : null,
        post.profileListed === false ? h('span', { class: 'flag-badge muted', title: 'Im begrenzten Profilabruf nicht enthalten. Daraus lässt sich nicht schließen, dass der Beitrag verborgen oder gelöscht ist.' }, 'nicht im Profilabruf') : null
      )
    ),
    h('div', { class: 'pc-body' },
      h('div', { class: 'pc-main' },
        h('h3', { class: 'pc-title', id: `t-${post.id}` }, h('button', { type: 'button', 'data-action': 'details' }, post.title)),
        crosspostLine(post),
        text ? h('p', { class: `pc-excerpt${long ? ' clamped' : ''}` }, text) : null,
        long ? h('button', { type: 'button', class: 'link-btn', 'data-action': 'expand', 'aria-expanded': 'false' }, 'Mehr anzeigen') : null,
        post.externalUrl && post.type !== 'text' ? h('p', { class: 'pc-domain mono' }, icon('i-link'), post.domain || new URL(post.externalUrl).hostname) : null,
        h('div', { class: 'pc-meta' },
          compare ? h('span', { class: 'author-chip' }, `u/${post.author}`) : h('span', { class: 'pc-author' }, `u/${post.author}`),
          metrics(post),
          post.flair ? h('span', { class: 'flair' }, post.flair) : null,
          h('span', { class: 'pc-sources' }, sourceBadges(post))
        )
      ),
      thumb(post, settings)
    ),
    h('footer', { class: 'pc-actions' },
      extLink(post.permalink, [icon('i-external'), h('span', null, 'Auf Reddit öffnen')], { class: 'btn ghost sm' }),
      h('button', { type: 'button', class: 'btn ghost sm icon-only', 'data-action': 'copy', title: 'Link kopieren', 'aria-label': 'Link kopieren' }, icon('i-copy')),
      h('button', { type: 'button', class: `btn ghost sm icon-only${finding ? ' active' : ''}`, 'data-action': 'save', 'aria-pressed': String(Boolean(finding)), title: finding ? 'Fundstelle entfernen' : 'Als Fundstelle merken', 'aria-label': finding ? 'Fundstelle entfernen' : 'Als Fundstelle merken' }, icon(finding ? 'i-bookmark-fill' : 'i-bookmark')),
      h('button', { type: 'button', class: `btn ghost sm icon-only fav${finding?.favorite ? ' active' : ''}`, 'data-action': 'favorite', 'aria-pressed': String(Boolean(finding?.favorite)), title: 'Als Favorit markieren', 'aria-label': 'Als Favorit markieren' }, icon(finding?.favorite ? 'i-star-fill' : 'i-star')),
      finding?.note ? h('span', { class: 'note-flag', title: finding.note }, icon('i-note'), 'Notiz') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'details' }, h('span', null, 'Details'), icon('i-chevron-right'))
    )
  );
  return card;
}

export const TABLE_COLUMNS = [
  { key: 'date', label: 'Datum', sort: 'newest', altSort: 'oldest' },
  { key: 'subreddit', label: 'Subreddit', sort: 'subreddit' },
  { key: 'title', label: 'Titel', sort: 'title' },
  { key: 'type', label: 'Typ' },
  { key: 'score', label: 'Score', sort: 'score' },
  { key: 'actions', label: 'Aktionen' }
];

export function tableRow(post, { finding, selected, index, compare }) {
  const meta = POST_TYPES[post.type] ?? POST_TYPES.link;
  return h('div', { class: `vt-row${selected ? ' selected' : ''}`, role: 'row', 'aria-rowindex': String(index + 2), dataset: { id: post.id } },
    h('div', { role: 'cell', class: 'c-date mono' }, fmt.date(post.createdUtc), h('span', { class: 'c-time' }, fmt.time(post.createdUtc))),
    h('div', { role: 'cell', class: 'c-sub' }, h('button', { type: 'button', class: 'pc-sub', 'data-action': 'filter-sub', 'data-sub': post.subredditKey }, post.isProfile ? `u/${post.subreddit.replace(/^u_/i, '')}` : `r/${post.subreddit}`)),
    h('div', { role: 'cell', class: 'c-title' },
      h('button', { type: 'button', 'data-action': 'details', title: post.title }, post.title),
      compare ? h('span', { class: 'author-chip sm' }, `u/${post.author}`) : null),
    h('div', { role: 'cell', class: `c-type type-${post.type}`, title: meta.label }, icon(meta.icon), h('span', null, meta.label)),
    h('div', { role: 'cell', class: 'c-score mono' }, post.metricsReliable && post.score !== null ? fmt.num(post.score) : '–'),
    h('div', { role: 'cell', class: 'c-actions' },
      extLink(post.permalink, icon('i-external'), { class: 'icon-btn sm', title: 'Auf Reddit öffnen', 'aria-label': 'Auf Reddit öffnen' }),
      h('button', { type: 'button', class: `icon-btn sm${finding ? ' active' : ''}`, 'data-action': 'save', 'aria-pressed': String(Boolean(finding)), 'aria-label': finding ? 'Fundstelle entfernen' : 'Als Fundstelle merken', title: finding ? 'Fundstelle entfernen' : 'Merken' }, icon(finding ? 'i-bookmark-fill' : 'i-bookmark'))
    )
  );
}

export function skeletonCards(count = 3) {
  return Array.from({ length: count }, () => h('div', { class: 'post-card skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'sk-line w30' }), h('div', { class: 'sk-line w80 lg' }), h('div', { class: 'sk-line w95' }), h('div', { class: 'sk-line w60' })));
}
