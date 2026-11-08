import { h, icon, fmt, button, fill } from '../dom.js';

const STATE_LABEL = { running: 'Suche läuft', done: 'Abgeschlossen', cancelled: 'Abgebrochen', error: 'Fehlgeschlagen', idle: 'Bereit' };

function windowLabel(windows) {
  if (!windows?.length) return '–';
  const from = Math.min(...windows.map((w) => w.from));
  const to = Math.max(...windows.map((w) => w.to));
  return `${fmt.date(from)} – ${fmt.date(Math.min(to, Date.now() / 1000))}`;
}

export function renderStatusbar(host, ctx) {
  const { state } = ctx;
  const session = state.session;
  if (!session) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  const st = session.status;
  const d = ctx.derived();
  const running = st.state === 'running';
  const req = session.requests ?? {};
  const pause = req.pausedUntil && req.pausedUntil > Date.now() ? Math.ceil((req.pausedUntil - Date.now()) / 1000) : 0;
  const loadedRaw = st.sources.filter((s) => s.kind === 'archive').reduce((sum, s) => sum + s.loaded, 0);
  const determinate = running && st.expectedTotal && st.phase === 'posts';
  const pct = determinate ? Math.min(100, (loadedRaw / st.expectedTotal) * 100) : 0;

  const progress = running
    ? h('div', { class: `progress${determinate ? '' : ' indeterminate'}`, role: 'progressbar', 'aria-label': 'Suchfortschritt', 'aria-valuemin': determinate ? '0' : null, 'aria-valuemax': determinate ? String(st.expectedTotal) : null, 'aria-valuenow': determinate ? String(loadedRaw) : null, 'aria-valuetext': determinate ? `${loadedRaw} von ${st.expectedTotal} laut Archivindex` : 'Gesamtumfang unbekannt' },
      h('span', { class: 'progress-fill', style: determinate ? { '--p': `${pct.toFixed(1)}%` } : null }))
    : null;

  host.className = `statusbar state-${st.state}`;
  fill(host,
    progress,
    h('div', { class: 'status-row' },
      h('span', { class: `state-pill ${st.state}` }, running ? h('span', { class: 'pulse' }) : icon(st.state === 'done' ? 'i-check' : st.state === 'error' ? 'i-alert' : 'i-stop'), STATE_LABEL[st.state] ?? st.state),
      h('dl', { class: 'status-metrics' },
        metric('Quelle', running ? `${st.activeSource ?? '–'}${session.authors.length > 1 && st.activeAuthor ? ` · u/${st.activeAuthor}` : ''}` : [...new Set(st.sources.map((s) => s.label))].join(' + ') || '–', false, !running),
        metric('Gefundene Beiträge', fmt.num(d.base.length), true),
        metric('Subreddits', fmt.num(d.groups.filter((g) => !g.isProfile).length), true),
        running ? metric('Zeitraum', st.phase === 'index' ? 'Archivindex' : st.phase === 'live' ? 'Statusprüfung' : st.phase === 'profile' ? 'Profilabgleich' : windowLabel(st.currentWindows)) : null,
        st.sectionsTotal ? metric('Abschnitte', `${fmt.num(st.sectionsDone)} / ${fmt.num(st.sectionsTotal)}`, true, !running) : null,
        running ? metric('Anfragen', `${req.active ?? 0} aktiv${req.queued ? ` · ${req.queued} wartend` : ''}${pause ? ` · Pause ${pause}s (Rate-Limit)` : ''}`) : null,
        determinate ? metric('Archivindex', `${fmt.num(loadedRaw)} / ${fmt.num(st.expectedTotal)}`, true) : null,
        !running && st.completeness ? metric('Vollständigkeit', { complete: 'vollständig laut Index', incomplete: 'unvollständig', unknown: 'nicht überprüfbar', partial: 'begrenzt' }[st.completeness] ?? '–', false, st.completeness === 'complete') : null),
      running
        ? button('Abbrechen', { cls: 'btn danger sm', iconName: 'i-stop', action: 'cancel-search' })
        : button('Erneut suchen', { cls: 'btn ghost sm', iconName: 'i-refresh', action: 'retry' })));
}

function metric(label, value, mono = false, optional = false) {
  return h('div', { class: `metric-item${optional ? ' opt' : ''}` }, h('dt', null, label), h('dd', { class: mono ? 'mono' : null }, value));
}

/** Kurzer Text für Screenreader; nur bei Zustandswechseln aktualisiert. */
export function liveSummary(ctx) {
  const session = ctx.state.session;
  if (!session) return '';
  const st = session.status;
  const d = ctx.derived();
  if (st.state === 'running') return `Suche läuft. ${d.base.length} Beiträge gefunden.`;
  if (st.state === 'done') return `Suche abgeschlossen. ${d.base.length} Beiträge in ${d.groups.filter((g) => !g.isProfile).length} Subreddits gefunden.`;
  if (st.state === 'cancelled') return `Suche abgebrochen. ${d.base.length} Beiträge bisher gefunden.`;
  if (st.state === 'error') return `Suche fehlgeschlagen: ${st.error?.message ?? ''}`;
  return '';
}
