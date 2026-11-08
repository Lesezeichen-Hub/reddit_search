import { h, icon, fmt, button } from '../dom.js';

const FEATURES = [
  { icon: 'i-database', title: 'Archivbasierte Autorensuche', text: 'Sucht direkt nach Beiträgen des Autors über alle Subreddits – nicht nur in der begrenzten Profilauflistung.' },
  { icon: 'i-layers', title: 'Subreddit Explorer', text: 'Gruppiert alle gefundenen Communities mit Anzahl, ältestem und neuestem Fund.' },
  { icon: 'i-filter', title: 'Filter ohne Neuladen', text: 'Zeitraum, Suchbegriff, Beitragstyp und Subreddits werden lokal kombiniert.' },
  { icon: 'i-calendar', title: 'Zeitraum-Explorer', text: 'Zeitleiste nach Jahren oder Monaten – ein Klick filtert die Ergebnisse.' },
  { icon: 'i-bookmark', title: 'Fundstellen & Notizen', text: 'Beiträge merken, taggen, kommentieren und als JSON, CSV oder Markdown exportieren.' },
  { icon: 'i-users', title: 'Neutraler Vergleich', text: 'Zwei Autoren nebeneinander, mit Filter auf gemeinsame Subreddits.' }
];

function heroForm(state) {
  return h('form', { class: 'search-form big', role: 'search', autocomplete: 'off', novalidate: true },
    h('div', { class: 'hero-fields' },
      h('label', { class: 'search-field' }, icon('i-search'),
        h('span', { class: 'sr-only' }, 'Reddit-Benutzername'),
        h('input', { name: 'user1', type: 'text', spellcheck: 'false', autocapitalize: 'off', placeholder: 'Benutzername, u/Name oder reddit.com/user/Name', 'aria-describedby': 'hero-error hero-hint', autofocus: true })),
      h('label', { class: 'search-field second', hidden: !state.compareMode }, icon('i-users'),
        h('span', { class: 'sr-only' }, 'Zweiter Benutzername zum Vergleich'),
        h('input', { name: 'user2', type: 'text', spellcheck: 'false', autocapitalize: 'off', placeholder: 'Zweiter Benutzer zum Vergleich' })),
      h('button', { type: 'submit', class: 'btn primary lg search-submit' }, h('span', null, 'Suchen')),
      h('button', { type: 'button', class: 'btn danger lg search-cancel', 'data-action': 'cancel-search', hidden: true }, icon('i-stop'), h('span', null, 'Abbrechen'))),
    h('div', { class: 'hero-sub' },
      h('p', { class: 'hint', id: 'hero-hint' }, 'Akzeptiert: ', h('code', null, 'Name'), ' · ', h('code', null, 'u/Name'), ' · ', h('code', null, 'https://www.reddit.com/user/Name/')),
      h('button', { type: 'button', class: 'link-btn compare-toggle', 'data-action': 'toggle-compare', 'aria-pressed': String(state.compareMode) }, icon('i-users'), state.compareMode ? 'Vergleich ausblenden' : 'Zweiten Benutzer vergleichen')),
    h('p', { class: 'form-error', id: 'hero-error', role: 'alert' }));
}

function schema() {
  const subs = ['r/Subreddit A', 'r/Subreddit B', 'r/Subreddit C', 'r/Subreddit D'];
  return h('figure', { class: 'schema', 'aria-label': 'Schema: Die Suche erfasst Beiträge eines Autors in vielen Subreddits, Profilposts werden standardmäßig ausgeblendet.' },
    h('div', { class: 'schema-user' }, icon('i-user'), h('span', null, 'u/Autor')),
    h('div', { class: 'schema-lines', 'aria-hidden': 'true' }, subs.map(() => h('span'))),
    h('ul', { class: 'schema-subs' },
      subs.map((s) => h('li', null, h('span', { class: 'schema-dot' }), s)),
      h('li', { class: 'muted-item' }, h('span', { class: 'schema-dot off' }), 'u/Autor (Profil) – ausgeblendet')),
    h('figcaption', null, 'Schema – keine echten Daten'));
}

export function mountHome(container, ctx) {
  const { state } = ctx;

  function render() {
    const recent = state.history.slice(0, 5);
    const saved = state.savedSearches.slice(0, 5);
    container.replaceChildren(h('div', { class: 'home' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero-copy' },
          h('p', { class: 'eyebrow' }, 'Autorbezogene Subreddit-Post-Suche'),
          h('h1', null, 'Eigene Beiträge eines Reddit-Nutzers finden – über alle Subreddits hinweg.'),
          h('p', { class: 'lede' }, 'Reddit Investigator fragt das öffentliche Arctic-Shift-Archiv direkt nach Beiträgen des Autors ab, gruppiert die Funde nach Communities und trennt Subreddit-Beiträge von Profilposts. Kommentare werden nicht als Beiträge gezählt.'),
          heroForm(state)),
        schema()),
      state.online ? null : h('div', { class: 'callout warn' }, icon('i-wifi-off'), h('p', null, 'Du bist offline. Gespeicherte Fundstellen und Notizen sind verfügbar, neue Recherchen benötigen eine Internetverbindung.')),
      h('section', { class: 'feature-grid', 'aria-label': 'Funktionen' },
        FEATURES.map((f) => h('article', { class: 'feature' }, h('span', { class: 'feature-icon' }, icon(f.icon)), h('h3', null, f.title), h('p', null, f.text)))),
      (recent.length || saved.length) ? h('section', { class: 'home-lists' },
        recent.length ? h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Letzte Suchen'), button('Verlauf', { cls: 'link-btn', action: 'nav', data: { view: 'history' } })),
          h('ul', { class: 'mini-list' }, recent.map((r) => h('li', null,
            h('button', { type: 'button', class: 'mini-item', 'data-action': 'rerun-history', 'data-id': r.id, title: 'Suche erneut ausführen' },
              icon('i-history'), h('span', { class: 'mi-name' }, r.authors.map((a) => `u/${a}`).join(' + ')),
              h('span', { class: 'mi-meta mono' }, `${fmt.num(r.found ?? 0)} Beiträge · ${fmt.relative(Date.parse(r.searchedAt) / 1000)}`)))))) : null,
        saved.length ? h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Gespeicherte Suchen'), button('Alle', { cls: 'link-btn', action: 'nav', data: { view: 'history' } })),
          h('ul', { class: 'mini-list' }, saved.map((s) => h('li', null,
            h('button', { type: 'button', class: 'mini-item', 'data-action': 'run-saved', 'data-id': s.id, title: 'Gespeicherte Suche ausführen' },
              icon('i-save'), h('span', { class: 'mi-name' }, s.name), h('span', { class: 'mi-meta mono' }, s.authors.map((a) => `u/${a}`).join(' + ')))))) ) : null) : null,
      h('section', { class: 'sources-note' },
        h('h2', null, 'Datenquellen'),
        h('dl', { class: 'source-list' },
          h('dt', null, 'Arctic Shift'), h('dd', null, 'Primäre Quelle. Öffentliches Reddit-Archiv mit Autorensuche über alle Subreddits. Kein Login nötig.'),
          h('dt', null, 'Reddit (offiziell)'), h('dd', null, 'Optional über einen lokalen Adapter mit eigener, genehmigter API-Registrierung. Zugangsdaten bleiben außerhalb des Browsers.'),
          h('dt', null, 'Externe Suchmaschinen'), h('dd', null, 'Vorbereitete Suchlinks zur manuellen Recherche – keine automatische Abfrage.')),
        h('p', { class: 'muted small' }, 'Die gefundenen Ergebnisse hängen von der Verfügbarkeit und Abdeckung der jeweiligen Datenquellen ab. Gelöschte oder entfernte Beiträge werden nicht angezeigt.'))
    ));
  }

  render();
  return { update(reason) { if (reason === 'history' || reason === 'online') render(); }, destroy() {} };
}
