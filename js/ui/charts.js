import { h, fmt, monogram } from '../dom.js';

/** Horizontale Balken: Verteilung gefundener Beiträge auf Communities. */
export function barList(groups, { limit = 10, selected = [], action = 'filter-sub' } = {}) {
  const top = groups.slice(0, limit);
  const max = Math.max(1, ...top.map((g) => g.count));
  const sel = new Set(selected);
  return h('ol', { class: 'bars', 'aria-label': 'Gefundene Beiträge je Subreddit' },
    top.map((g) => h('li', { class: `bar-row${sel.has(g.key) ? ' active' : ''}` },
      h('button', { type: 'button', class: 'bar-btn', 'data-action': action, 'data-sub': g.key, 'aria-label': `${g.isProfile ? 'Profil' : `r/${g.name}`}: ${g.count} gefundene Beiträge – Beiträge anzeigen` },
        h('span', { class: 'bar-label' }, monogram(g.name), h('span', { class: 'bar-name' }, g.isProfile ? `u/${g.name.replace(/^u_/i, '')}` : `r/${g.name}`)),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { '--w': `${Math.max(2, (g.count / max) * 100).toFixed(1)}%` } })),
        h('span', { class: 'bar-count mono' }, fmt.num(g.count))))));
}

/** Zeitleiste: Säulen je Jahr oder Monat; Klick filtert die Ergebnisliste. */
export function timelineChart(buckets, { activePeriod = null, granularity = 'year' } = {}) {
  if (!buckets.length) return h('p', { class: 'muted' }, 'Keine Daten für die Zeitleiste.');
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const every = Math.max(1, Math.ceil(buckets.length / (granularity === 'month' ? 12 : 16)));
  return h('div', { class: `timeline g-${granularity}`, role: 'group', 'aria-label': `Gefundene Beiträge je ${granularity === 'month' ? 'Monat' : 'Jahr'}` },
    h('div', { class: 'tl-cols' },
      buckets.map((b, i) => {
        const active = activePeriod && activePeriod.from === b.from && activePeriod.to === b.to;
        return h('button', {
          type: 'button',
          class: `tl-col${b.count ? '' : ' empty'}${active ? ' active' : ''}`,
          'data-action': 'period',
          'data-from': String(b.from),
          'data-to': String(b.to),
          'data-label': b.label,
          disabled: b.count === 0,
          'aria-pressed': active ? 'true' : 'false',
          'aria-label': `${b.label}: ${b.count} gefundene Beiträge`,
          title: `${b.label}: ${fmt.plural(b.count, 'gefundener Beitrag', 'gefundene Beiträge')}`
        },
          h('span', { class: 'tl-bar', style: { '--h': `${b.count ? Math.max(4, (b.count / max) * 100) : 0}%` } }),
          h('span', { class: `tl-label${i % every === 0 ? '' : ' hidden'}` }, b.label));
      })));
}
