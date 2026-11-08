import { h, icon, button, extLink, fmt } from '../dom.js';
import { SOURCES, APP_VERSION } from '../config.js';
import { TIME_PRESETS, SORTS } from '../filters.js';

const TABS = [['appearance', 'Erscheinungsbild'], ['search', 'Suche'], ['storage', 'Speicherung'], ['sources', 'Datenquellen']];

function radioGroup(name, options, value, legend) {
  return h('fieldset', { class: 'radio-cards' }, h('legend', null, legend),
    options.map(([v, label, iconName]) => h('label', { class: 'radio-card' },
      h('input', { type: 'radio', name, value: v, checked: value === v, 'data-setting': name }),
      iconName ? icon(iconName) : null, h('span', null, label))));
}

function switchRow(name, label, hint, value) {
  return h('label', { class: 'setting-row' },
    h('span', { class: 'sr-text' }, h('span', { class: 'sr-label' }, label), hint ? h('span', { class: 'sr-hint' }, hint) : null),
    h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', name, checked: value, 'data-setting': name }), h('span', { class: 'switch-track', 'aria-hidden': 'true' })));
}

function selectRow(name, label, options, value, hint) {
  return h('label', { class: 'setting-row' },
    h('span', { class: 'sr-text' }, h('span', { class: 'sr-label' }, label), hint ? h('span', { class: 'sr-hint' }, hint) : null),
    h('select', { name, 'data-setting': name }, Object.entries(options).map(([v, t]) => h('option', { value: v, selected: String(value) === v }, t))));
}

export function mountSettings(dialog, ctx) {
  const { state, actions } = ctx;
  let tab = 'appearance';

  dialog.addEventListener('change', (e) => {
    const t = e.target;
    const key = t.dataset.setting;
    if (!key) return;
    let value = t.type === 'checkbox' ? t.checked : t.value;
    if (key === 'maxResults') value = Number(value);
    if (key === 'redditAdapterUrl') value = t.value.trim();
    actions.updateSettings({ [key]: value });
  });
  dialog.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'stab') { tab = el.dataset.tab; render(); dialog.querySelector(`[data-tab="${tab}"]`)?.focus(); }
    if (a === 'close-settings') dialog.close();
    if (a === 'test-source') { el.disabled = true; await actions.testSource(el.dataset.source); }
    if (a === 'export-local') actions.exportLocalData();
    if (a === 'clear-history') actions.clearHistory();
    if (a === 'clear-all') actions.clearAllData();
    if (a === 'clear-diag') { state.diagnostics.length = 0; render(); }
    if (a === 'goto-findings') { dialog.close(); actions.navigate('findings'); }
  });
  dialog.addEventListener('keydown', (e) => {
    if (!e.target.matches('[role=tab]')) return;
    const i = TABS.findIndex(([k]) => k === tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      tab = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      render();
      dialog.querySelector(`[data-tab="${tab}"]`)?.focus();
    }
  });

  function statusLine(id) {
    const s = state.sourceStatus[id];
    if (!s || s.state === 'unknown') return h('span', { class: 'status-badge muted' }, 'nicht geprüft');
    if (s.state === 'testing') return h('span', { class: 'status-badge muted' }, 'wird geprüft …');
    return h('span', { class: `status-badge ${s.state === 'ok' ? 'ok' : s.state === 'warn' ? 'warn' : 'danger'}` },
      s.state === 'ok' ? `erreichbar${s.latencyMs ? ` · ${s.latencyMs} ms` : ''}` : s.state === 'warn' ? 'eingeschränkt' : 'nicht erreichbar');
  }

  function panel() {
    const s = state.settings;
    if (tab === 'appearance') {
      return [
        radioGroup('theme', [['system', 'System', 'i-monitor'], ['dark', 'Dunkel', 'i-moon'], ['light', 'Hell', 'i-sun']], s.theme, 'Farbschema'),
        radioGroup('defaultView', [['cards', 'Karten', 'i-grid'], ['table', 'Tabelle', 'i-table']], s.defaultView, 'Standardansicht der Beiträge'),
        radioGroup('density', [['comfortable', 'Komfortabel'], ['compact', 'Kompakt']], s.density, 'Darstellungsdichte'),
        switchRow('loadImages', 'Vorschaubilder laden', 'Bilder werden direkt von Reddits Bildservern (preview.redd.it, i.redd.it) geladen.', s.loadImages),
        switchRow('blurNsfw', 'NSFW- und Spoiler-Bilder unscharf', null, s.blurNsfw)
      ];
    }
    if (tab === 'search') {
      return [
        selectRow('preferredSource', 'Bevorzugte Datenquelle', { 'arctic-shift': 'Arctic Shift (Archiv)', both: 'Arctic Shift + Reddit (lokaler Adapter)', 'reddit-local': 'Nur Reddit (lokaler Adapter)' }, s.preferredSource, 'Reddit-Optionen erfordern den lokalen Adapter.'),
        selectRow('maxResults', 'Maximale Anzahl zu ladender Beiträge', { 1000: '1.000', 2500: '2.500', 5000: '5.000', 10000: '10.000', 25000: '25.000' }, s.maxResults, 'Wird das Limit erreicht, kennzeichnet die Anwendung das Ergebnis als unvollständig.'),
        selectRow('defaultTimeRange', 'Standardzeitraum', Object.fromEntries(Object.entries(TIME_PRESETS).filter(([k]) => !['custom', 'year'].includes(k))), s.defaultTimeRange),
        selectRow('defaultSort', 'Standardsortierung', SORTS, s.defaultSort),
        switchRow('showProfilePosts', 'Profilposts standardmäßig einblenden', 'Beiträge im eigenen Profil (u/Name) sind keine Subreddit-Beiträge und standardmäßig ausgeblendet.', s.showProfilePosts),
        switchRow('showCrossposts', 'Crossposts standardmäßig einblenden', null, s.showCrossposts),
        h('p', { class: 'small muted' }, 'Kommentare werden bewusst nicht durchsucht: Die Anwendung sucht ausschließlich eigenständige Beiträge.')
      ];
    }
    if (tab === 'storage') {
      return [
        switchRow('historyEnabled', 'Lokalen Suchverlauf führen', 'Speichert nur Benutzername, Zeitpunkt und Trefferzahlen.', s.historyEnabled),
        h('div', { class: 'setting-actions' },
          button(`Fundstellen verwalten (${state.findings.size})`, { cls: 'btn ghost', iconName: 'i-bookmark', action: 'goto-findings' }),
          button('Lokale Daten exportieren (JSON)', { cls: 'btn ghost', iconName: 'i-download', action: 'export-local' }),
          button('Suchverlauf löschen', { cls: 'btn ghost', iconName: 'i-history', action: 'clear-history' }),
          button('Alle lokalen Daten löschen', { cls: 'btn danger', iconName: 'i-trash', action: 'clear-all' })),
        h('p', { class: 'small muted' }, 'Suchergebnisse werden nur im Arbeitsspeicher gehalten und beim Schließen verworfen. Dauerhaft gespeichert (IndexedDB) werden Einstellungen, Fundstellen-Metadaten mit deinen Notizen, der Suchverlauf und gespeicherte Suchkonfigurationen.')
      ];
    }
    const diag = state.diagnostics.slice(-12).reverse();
    return [
      h('section', { class: 'source-card' },
        h('div', { class: 'sc-head' }, icon('i-database'), h('h3', null, 'Arctic Shift'), statusLine('arctic-shift'),
          button('Verbindung testen', { cls: 'btn ghost sm', iconName: 'i-refresh', action: 'test-source', data: { source: 'arctic-shift' } })),
        h('p', null, 'Primäre Quelle. Durchsucht das öffentliche Reddit-Archiv über ', h('code', null, '/api/posts/search'), ' mit ', h('code', null, 'author'), ', ', h('code', null, 'after'), ', ', h('code', null, 'before'), ', ', h('code', null, 'limit'), ' und ', h('code', null, 'sort'), '. Die Gesamtzahl je Jahr und Subreddit liefert ', h('code', null, '/api/posts/search/aggregate'), '.'),
        h('ul', { class: 'limits' },
          h('li', null, 'Kostenloser Dienst ohne Verfügbarkeitsgarantie; Rate-Limits werden dynamisch vergeben und respektiert.'),
          h('li', null, 'Je Anfrage liefert die API 100 bis 1.000 Beiträge (limit=auto) – die Anwendung blättert automatisch über Zeitfenster und teilt zu aufwendige Fenster auf.'),
          h('li', null, 'Score und Kommentarzahl werden erst etwa 36 Stunden nach Veröffentlichung aktualisiert.'),
          h('li', null, 'Später auf Reddit gelöschte Beiträge können im Archiv noch enthalten sein. Als entfernt markierte Beiträge werden ausgeblendet; eine aktuelle Prüfung ist nur über den Reddit-Adapter möglich.')),
        h('p', { class: 'links' }, extLink(SOURCES.arcticShift.docsUrl, 'API-Dokumentation'), ' · ', extLink(SOURCES.arcticShift.statusUrl, 'Statusseite'))),
      h('section', { class: 'source-card' },
        h('div', { class: 'sc-head' }, icon('i-globe'), h('h3', null, 'Reddit (lokaler Adapter)'), statusLine('reddit-local'),
          button('Verbindung testen', { cls: 'btn ghost sm', iconName: 'i-refresh', action: 'test-source', data: { source: 'reddit-local' } })),
        h('p', null, 'Reddit beantwortet nicht angemeldete Browseranfragen an seine JSON-Schnittstellen mit HTTP 403. Die offizielle API ist daher nur über den mitgelieferten Go-Dienst (', h('code', null, 'server/'), ') mit eigener, von Reddit genehmigter App-Registrierung nutzbar. Zugangsdaten werden als Umgebungsvariablen gesetzt und nie an den Browser übertragen.'),
        switchRow('redditAdapterEnabled', 'Lokalen Reddit-Adapter verwenden', 'Aktiviert Reddit-Suche, Statusprüfung gefundener Beiträge und optionalen Profilabgleich.', s.redditAdapterEnabled),
        h('label', { class: 'setting-row' }, h('span', { class: 'sr-text' }, h('span', { class: 'sr-label' }, 'Adresse des Adapters'), h('span', { class: 'sr-hint' }, 'Nur 127.0.0.1 oder localhost.')),
          h('input', { type: 'url', name: 'redditAdapterUrl', value: s.redditAdapterUrl, 'data-setting': 'redditAdapterUrl', spellcheck: 'false' })),
        switchRow('profileCompare', 'Begrenzten Profilabgleich durchführen', 'Vergleicht Funde mit der (von Reddit auf ca. 1.000 Einträge begrenzten) Profilauflistung.', s.profileCompare),
        h('ul', { class: 'limits' },
          h('li', null, 'Die Reddit-Suche (author:Name) liefert nur eine begrenzte Auswahl und ist nie vollständig.'),
          h('li', null, 'Fehlt ein Beitrag in der Profilauflistung, folgt daraus nicht, dass er verborgen oder gelöscht wurde.')),
        h('p', { class: 'links' }, extLink(SOURCES.redditLocal.docsUrl, 'Reddit-API-Dokumentation'), ' · ', extLink('https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki', 'Data API Wiki'))),
      h('section', { class: 'source-card' },
        h('div', { class: 'sc-head' }, icon('i-alert'), h('h3', null, 'Fehlerdiagnose'), diag.length ? button('Leeren', { cls: 'link-btn', action: 'clear-diag' }) : null),
        diag.length ? h('ol', { class: 'diag mono' }, diag.map((d) => h('li', null, h('span', { class: 'd-time' }, new Date(d.at).toLocaleTimeString('de-DE')), h('span', { class: 'd-src' }, d.source), h('span', { class: 'd-kind' }, d.kind), h('span', { class: 'd-msg' }, d.message))))
          : h('p', { class: 'muted small' }, 'Keine Fehler protokolliert.'),
        state.requestStats ? h('p', { class: 'small muted mono' }, `Anfragen: ${fmt.num(state.requestStats.requests)} · Wiederholungen: ${fmt.num(state.requestStats.retries)} · Rate-Limits: ${fmt.num(state.requestStats.rateLimited)} · Fehler: ${fmt.num(state.requestStats.failures)}`) : null)
    ];
  }

  function render() {
    dialog.replaceChildren(h('div', { class: 'settings' },
      h('header', { class: 'dialog-head' }, h('h2', { id: 'settings-title' }, 'Einstellungen'), h('span', { class: 'mono muted small' }, `v${APP_VERSION}`), h('span', { class: 'spacer' }),
        button('', { cls: 'icon-btn', iconName: 'i-x', action: 'close-settings', attrs: { 'aria-label': 'Einstellungen schließen' } })),
      h('div', { class: 'settings-body' },
        h('div', { class: 'settings-tabs', role: 'tablist', 'aria-orientation': 'vertical' },
          TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', id: `stab-${k}`, 'aria-controls': 'settings-panel', 'aria-selected': String(tab === k), tabindex: tab === k ? '0' : '-1', 'data-action': 'stab', 'data-tab': k }, l))),
        h('div', { class: 'settings-panel', id: 'settings-panel', role: 'tabpanel', 'aria-labelledby': `stab-${tab}` }, panel()))));
  }

  return {
    open(initialTab) {
      if (initialTab) tab = initialTab;
      render();
      if (!dialog.open) dialog.showModal();
    },
    update() {
      if (!dialog.open) return;
      const active = document.activeElement;
      if (active && dialog.contains(active) && active.matches('input[type=url], input[type=text]')) return;
      const name = active?.dataset?.setting ?? active?.dataset?.tab;
      render();
      if (name) dialog.querySelector(`[data-setting="${name}"], [data-tab="${name}"]`)?.focus();
    }
  };
}
