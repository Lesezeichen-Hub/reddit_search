// Zentrale Konfiguration der Datenquellen. Werte hier sind Voreinstellungen;
// die lokale Adapter-Adresse lässt sich zusätzlich in den Einstellungen ändern.
export const APP_NAME = 'Reddit Investigator';
export const APP_VERSION = '1.0.0';

export const SOURCES = {
  arcticShift: {
    id: 'arctic-shift',
    label: 'Arctic Shift',
    kind: 'archive',
    baseUrl: 'https://arctic-shift.photon-reddit.com',
    docsUrl: 'https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md',
    statusUrl: 'https://status.arctic-shift.photon-reddit.com',
    // Dokumentiert: limit 1–100 oder "auto" (100–1000 je nach Serverauslastung).
    // "auto" spart Anfragen; eine Seite mit weniger als 100 Treffern ist die letzte.
    pageSize: 'auto',
    minFullPage: 100,
    // Frühester sinnvoller Zeitpunkt (Reddit-Start Juni 2005).
    epochStart: Date.UTC(2005, 5, 1) / 1000,
    // Startpunkt des Jahresaggregats; muss auf einem Jahresanfang liegen.
    indexAfter: '2005-01-01',
    concurrency: 2,
    minIntervalMs: 500,
    timeoutMs: 30000,
    retries: 4,
    // Ab dieser Fensterbreite (Sekunden) wird bei Abfrage-Timeouts nicht weiter halbiert.
    minSplitSeconds: 6 * 3600
  },
  redditLocal: {
    id: 'reddit-local',
    label: 'Reddit (lokaler Adapter)',
    kind: 'live',
    defaultBaseUrl: 'http://127.0.0.1:8791',
    docsUrl: 'https://www.reddit.com/wiki/api',
    concurrency: 1,
    minIntervalMs: 1100,
    timeoutMs: 30000,
    retries: 2
  }
};

export const EXTERNAL_SEARCH_ENGINES = [
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=' }
];

// Hosts, von denen Vorschaubilder geladen werden dürfen.
export const IMAGE_HOSTS = [
  'preview.redd.it',
  'external-preview.redd.it',
  'i.redd.it',
  'a.thumbs.redditmedia.com',
  'b.thumbs.redditmedia.com'
];

export const DEFAULT_SETTINGS = {
  theme: 'system',
  defaultView: 'cards',
  density: 'comfortable',
  preferredSource: 'arctic-shift',
  maxResults: 5000,
  defaultTimeRange: 'all',
  defaultSort: 'newest',
  showProfilePosts: false,
  showCrossposts: true,
  historyEnabled: true,
  loadImages: true,
  blurNsfw: true,
  redditAdapterEnabled: false,
  redditAdapterUrl: SOURCES.redditLocal.defaultBaseUrl,
  profileCompare: false,
  detailPanel: false
};
