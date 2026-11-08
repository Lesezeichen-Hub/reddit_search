import { h, icon, button } from '../dom.js';

export function toast(message, { kind = 'info', timeout = 3200 } = {}) {
  const host = document.getElementById('toasts');
  const iconName = kind === 'ok' ? 'i-check' : kind === 'error' ? 'i-alert' : 'i-info';
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, icon(iconName), h('span', null, message));
  host.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

export function confirmDialog({ title, text, confirmLabel = 'Bestätigen' }) {
  const dialog = document.getElementById('confirm-dialog');
  dialog.querySelector('#confirm-title').textContent = title;
  dialog.querySelector('#confirm-text').textContent = text;
  dialog.querySelector('#confirm-ok').textContent = confirmLabel;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

export function promptDialog({ title, label, value = '' }) {
  const dialog = document.getElementById('prompt-dialog');
  dialog.querySelector('#prompt-title').textContent = title;
  dialog.querySelector('#prompt-label').textContent = label;
  const input = dialog.querySelector('#prompt-input');
  input.value = value;
  dialog.returnValue = '';
  dialog.showModal();
  input.select();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value.trim() : null), { once: true });
  });
}

const STATE_COPY = {
  invalid: { icon: 'i-alert', title: 'Benutzername ungültig', tone: 'warn' },
  empty: { icon: 'i-search', title: 'Keine Treffer gefunden', tone: 'neutral' },
  offline: { icon: 'i-wifi-off', title: 'Keine Internetverbindung', tone: 'warn', text: 'Neue Recherchen benötigen eine Verbindung. Gespeicherte Fundstellen und Notizen bleiben offline verfügbar.' },
  network: { icon: 'i-wifi-off', title: 'Netzwerk nicht erreichbar', tone: 'danger', text: 'Die Datenquelle konnte nicht erreicht werden. Prüfe die Verbindung oder ob eine Firewall bzw. Browsererweiterung den Zugriff blockiert.' },
  timeout: { icon: 'i-clock', title: 'Zeitüberschreitung', tone: 'warn', text: 'Die Datenquelle hat nicht rechtzeitig geantwortet. Ein erneuter Versuch hilft häufig.' },
  server: { icon: 'i-database', title: 'Datenquelle vorübergehend nicht verfügbar', tone: 'danger', text: 'Der Dienst meldet einen Fehler. Bitte später erneut versuchen.' },
  'query-timeout': { icon: 'i-database', title: 'Abfrage zu aufwendig', tone: 'warn', text: 'Die Datenquelle konnte die Abfrage nicht rechtzeitig beantworten, auch nicht in kleineren Zeitabschnitten.' },
  'rate-limit': { icon: 'i-clock', title: 'Rate-Limit erreicht', tone: 'warn', text: 'Die Datenquelle begrenzt gerade die Anzahl der Anfragen. Warte kurz und versuche es dann erneut.' },
  auth: { icon: 'i-alert', title: 'Zugriff verweigert', tone: 'danger', text: 'Die Datenquelle verweigert den Zugriff. Für die offizielle Reddit-API ist ein konfigurierter lokaler Adapter nötig.' },
  client: { icon: 'i-alert', title: 'Anfrage abgelehnt', tone: 'danger' },
  'invalid-response': { icon: 'i-alert', title: 'Unerwartete Antwort', tone: 'danger', text: 'Die Datenquelle hat Daten in einem unerwarteten Format geliefert.' },
  cancelled: { icon: 'i-stop', title: 'Suche abgebrochen', tone: 'neutral', text: 'Bereits gefundene Beiträge bleiben sichtbar, sind aber unvollständig.' },
  incomplete: { icon: 'i-alert', title: 'Nur unvollständige Daten verfügbar', tone: 'warn' }
};

/** Einheitlicher Zustandsblock für Leer- und Fehlerzustände. */
export function stateBlock(kind, { title, text, actions = [], details } = {}) {
  const copy = STATE_COPY[kind] ?? STATE_COPY.empty;
  return h('div', { class: `state-block tone-${copy.tone}`, role: copy.tone === 'danger' ? 'alert' : null },
    h('div', { class: 'state-icon' }, icon(copy.icon)),
    h('h2', null, title ?? copy.title),
    (text ?? copy.text) ? h('p', null, text ?? copy.text) : null,
    details ? h('p', { class: 'state-details mono' }, details) : null,
    actions.length ? h('div', { class: 'state-actions' }, actions.map((a) => button(a.label, { cls: `btn ${a.primary ? 'primary' : 'ghost'}`, iconName: a.icon, action: a.action, data: a.data ?? {} }))) : null
  );
}
