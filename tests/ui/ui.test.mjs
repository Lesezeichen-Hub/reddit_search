// Browser-/UI-Tests mit Playwright.
// ACHTUNG: Alle Arctic-Shift-Antworten in diesem Test sind MOCK-DATEN, die per
// page.route() eingespeist werden. Sie stammen nicht aus einem echten API-Abruf.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';

const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const PORT = 8798;
// Gleiche URL-Struktur wie im Lesezeichen-Hub (/modules/<id>/index.html) – prüft relative Asset-Pfade.
const BASE = `http://127.0.0.1:${PORT}/modules/7/index.html`;
const Y = (y, m = 0, d = 1) => Date.UTC(y, m, d) / 1000;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// ---------- Mock-Archiv ----------
function buildMockPosts() {
  const posts = [];
  const subs = Array.from({ length: 120 }, (_, i) => `mocksub${String(i).padStart(3, '0')}`);
  for (let i = 0; i < 3000; i += 1) {
    const sub = subs[Math.floor(Math.pow(i / 3000, 2) * subs.length)];
    const image = i % 7 === 0;
    posts.push({
      id: `m${i.toString(36)}`,
      author: 'MockAutor',
      subreddit: sub,
      subreddit_type: 'public',
      created_utc: Y(2026, 9, 1) - i * 43200,
      title: `Mock-Beitrag Nummer ${i} in r/${sub}`,
      selftext: image ? '' : `Mock-Text ${i}. `.repeat(i % 5 === 0 ? 60 : 3),
      is_self: !image,
      post_hint: image ? 'image' : 'self',
      url: image ? `https://i.redd.it/mock${i}.jpg` : `https://www.reddit.com/r/${sub}/comments/m${i}/`,
      preview: image ? { images: [{ source: { url: `https://preview.redd.it/mock${i}.jpg?width=640`, width: 640, height: 480 }, resolutions: [] }] } : undefined,
      permalink: `/r/${sub}/comments/m${i.toString(36)}/mock/`,
      score: 3000 - i,
      num_comments: i % 40,
      retrieved_on: Y(2026, 9, 2),
      _meta: { retrieved_2nd_on: Y(2026, 9, 3) }
    });
  }
  for (let i = 0; i < 10; i += 1) {
    posts.push({ id: `prof${i}`, author: 'MockAutor', subreddit: 'u_MockAutor', subreddit_type: 'user', created_utc: Y(2025, 1, 1) + i, title: `Profilpost ${i}`, selftext: 'Nur im Profil', is_self: true, permalink: `/user/MockAutor/comments/prof${i}/x/`, score: 1, num_comments: 0 });
  }
  posts.push({ id: 'xss1', author: 'MockAutor', subreddit: 'mocksub000', created_utc: Y(2026, 9, 2), title: '<img src=x onerror="window.__xss=1">Gefährlicher Titel', selftext: '<script>window.__xss=2</script> **fett** [link](javascript:alert(1))', is_self: true, permalink: '/r/mocksub000/comments/xss1/x/', score: 1, num_comments: 0, _meta: {} });
  posts.push({ id: 'long1', author: 'MockAutor', subreddit: 'mocksub001', created_utc: Y(2026, 9, 2) - 10, title: `Sehr langer Titel ${'ohne Leerzeichen'.repeat(3)}${'X'.repeat(160)} Ende`, selftext: 'kurz', is_self: true, permalink: '/r/mocksub001/comments/long1/x/', score: 2, num_comments: 1, _meta: {} });
  posts.push({ id: 'xp1', author: 'MockAutor', subreddit: 'mocksub002', created_utc: Y(2026, 9, 2) - 20, title: 'Crosspost-Mock', is_self: false, crosspost_parent: 't3_m0', crosspost_parent_list: [{ id: 'm0', subreddit: 'mocksub000', author: 'MockAutor', title: 'Original' }], permalink: '/r/mocksub002/comments/xp1/x/', score: 3, num_comments: 0, _meta: {} });
  posts.push({ id: 'del1', author: 'MockAutor', subreddit: 'mocksub003', created_utc: Y(2026, 9, 2) - 30, title: 'Entfernt', selftext: '[removed]', removed_by_category: 'moderator', is_self: true, permalink: '/r/mocksub003/comments/del1/x/' });
  return posts;
}

const ARCHIVE = buildMockPosts();
const POSTS_SHOWN = 3000 + 3; // ohne Profil- und entfernte Beiträge
let apiMode = 'ok';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
}

async function arcticRoute(route) {
  const url = new URL(route.request().url());
  const p = url.searchParams;
  const author = (p.get('author') ?? '').toLowerCase();
  if (apiMode === 'down' || author === 'kaputt') return json(route, { error: 'Service Unavailable (Mock)' }, 503);
  if (apiMode === 'slow' || author === 'langsam') await new Promise((r) => setTimeout(r, 1500));
  const own = author === 'mockautor' ? ARCHIVE : [];
  if (url.pathname === '/api/posts/search/aggregate') {
    if (p.get('aggregate') === 'subreddit') {
      const counts = {};
      for (const x of own) counts[x.subreddit] = (counts[x.subreddit] ?? 0) + 1;
      return json(route, { data: Object.entries(counts).map(([key, count]) => ({ key, count: String(count) })) });
    }
    const data = [];
    for (let y = 2005; y <= 2026; y += 1) data.push({ created_utc: new Date((Y(y) - 3600) * 1000).toISOString(), count: String(own.filter((x) => x.created_utc >= Y(y) && x.created_utc < Y(y + 1)).length) });
    return json(route, { data });
  }
  if (url.pathname === '/api/posts/search') {
    const after = Number(p.get('after'));
    const before = Number(p.get('before'));
    const limit = p.get('limit') === 'auto' ? 300 : Number(p.get('limit'));
    const hits = own.filter((x) => x.created_utc >= after && x.created_utc < before).sort((a, b) => b.created_utc - a.created_utc).slice(0, limit);
    return json(route, { data: hits });
  }
  if (url.pathname === '/api/posts/ids') {
    const ids = new Set((p.get('ids') ?? '').split(','));
    return json(route, { data: ARCHIVE.filter((x) => ids.has(x.id)) });
  }
  return json(route, { error: 'unbekannt' }, 404);
}

// ---------- Testablauf ----------
const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`✔ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`✘ ${name}\n  ${err.stack?.split('\n').slice(0, 4).join('\n  ')}`);
  }
}

const server = await startServer(PORT);
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function newPage(options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, timezoneId: 'Europe/Berlin', locale: 'de-DE', colorScheme: 'dark', reducedMotion: 'reduce', ...options });
  await context.route('https://arctic-shift.photon-reddit.com/**', arcticRoute);
  await context.route(/https:\/\/(preview|i)\.redd\.it\/.*/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (503|404)/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.home .search-form.big');
  return page;
}

async function search(page, name) {
  const form = (await page.locator('.search-form.big').count()) ? '.search-form.big' : '#top-search';
  await page.fill(`${form} input[name=user1]`, name);
  await page.press(`${form} input[name=user1]`, 'Enter');
}

const waitDone = (page, timeout = 60000) => page.waitForFunction(() => {
  const s = window.__redditInvestigator.state.session;
  return s && s.status.state !== 'running';
}, null, { timeout });

const desktop = await newPage({ viewport: { width: 1440, height: 900 } });

await step('Startansicht ist gefüllt und erklärt die Suche', async () => {
  await desktop.screenshot({ path: `${OUT}01-start-dark.png` });
  assert.ok(await desktop.getByRole('heading', { level: 1 }).isVisible());
  assert.equal(await desktop.locator('.feature').count(), 6);
  assert.ok(await desktop.locator('.schema figcaption').innerText().then((t) => t.includes('keine echten Daten')));
});

await step('Ungültiger Benutzername zeigt Fehler', async () => {
  await search(desktop, 'kein gültiger name!');
  await desktop.waitForSelector('#hero-error:not(:empty)');
  assert.match(await desktop.locator('#hero-error').innerText(), /Ungültiger Benutzername/);
  assert.equal(await desktop.locator('.search-form.big input[name=user1]').getAttribute('aria-invalid'), 'true');
});

await step('Große Suche (Mock: 3.000+ Beiträge, 120 Subreddits) läuft vollständig', async () => {
  const started = Date.now();
  await search(desktop, 'https://www.reddit.com/user/MockAutor/');
  await desktop.waitForSelector('.statusbar .state-pill.running', { timeout: 10000 });
  await desktop.screenshot({ path: `${OUT}02-suche-laeuft.png` });
  await waitDone(desktop);
  const info = await desktop.evaluate(() => {
    const { state, derived } = window.__redditInvestigator;
    const d = derived();
    return { status: state.session.status.state, completeness: state.session.status.completeness, base: d.base.length, all: d.all.length, subs: d.groups.length, removed: state.session.collection.rejected.removed };
  });
  assert.equal(info.status, 'done');
  assert.equal(info.completeness, 'complete');
  assert.equal(info.base, POSTS_SHOWN);
  assert.equal(info.all, POSTS_SHOWN + 10);
  assert.equal(info.removed, 1);
  assert.equal(info.subs, 120);
  console.log(`  Suche + Verarbeitung: ${Date.now() - started} ms`);
  await desktop.waitForTimeout(400);
  await desktop.screenshot({ path: `${OUT}03-uebersicht.png` });
  assert.match(await desktop.locator('.callout.ok').innerText(), /3\.014 laut Archivindex/);
});

await step('Subreddit Explorer: Gruppierung, Sortierung, Suche, Auswahl', async () => {
  await desktop.click('.tab[data-view=explorer]');
  await desktop.waitForSelector('.sub-row');
  assert.equal(await desktop.locator('.sub-row').count(), 120);
  const first = await desktop.locator('.sub-row .sub-name').first().textContent();
  assert.equal(first, 'r/mocksub000');
  await desktop.click('[data-action=xsort][data-value=name]');
  assert.equal(await desktop.locator('.sub-row .sub-name').first().textContent(), 'r/mocksub000');
  await desktop.click('[data-action=xsort][data-value=recent]');
  await desktop.fill('.explorer-toolbar input[type=search]', 'mocksub11');
  await desktop.waitForFunction(() => document.querySelectorAll('.sub-row').length === 10);
  await desktop.check('.sub-row input[name=xsel] >> nth=0');
  await desktop.check('.sub-row input[name=xsel] >> nth=1');
  const selected = await desktop.evaluate(() => window.__redditInvestigator.state.filters.subreddits.length);
  assert.equal(selected, 2);
  await desktop.fill('.explorer-toolbar input[type=search]', '');
  await desktop.waitForTimeout(250);
  await desktop.screenshot({ path: `${OUT}04-explorer.png` });
  const download = desktop.waitForEvent('download');
  await desktop.click('.explorer-toolbar summary');
  await desktop.click('[data-action=xexport][data-format=csv]');
  const file = await download;
  assert.match(file.suggestedFilename(), /^subreddits-MockAutor-.*\.csv$/);
  await desktop.click('[data-action=xshow-selected]');
  await desktop.waitForSelector('.posts-view');
  const visibleSubs = await desktop.evaluate(() => new Set(window.__redditInvestigator.derived().filtered.map((p) => p.subredditKey)).size);
  assert.ok(visibleSubs <= 2);
});

await step('Filter kombinieren, Chips einzeln und gesammelt zurücksetzen', async () => {
  await desktop.evaluate(() => window.__redditInvestigator.actions.resetFilters());
  await desktop.fill('.filter-panel input[name=query]', '"Nummer 12"');
  await desktop.waitForTimeout(400);
  await desktop.click('.chip[data-type=text]');
  await desktop.selectOption('.filter-panel select[name=time]', '1y');
  await desktop.waitForSelector('.filter-chip');
  const chipCount = await desktop.locator('.filter-chip').count();
  assert.equal(chipCount, 3);
  const filtered = await desktop.evaluate(() => window.__redditInvestigator.derived().filtered);
  assert.ok(filtered.length > 0 && filtered.every((p) => p.type === 'text' && /nummer 12/i.test(p.title)));
  await desktop.click('.filter-chip[data-key="type:text"]');
  assert.equal(await desktop.locator('.filter-chip').count(), 2);
  await desktop.click('.chips-row [data-action=reset-filters]');
  assert.equal(await desktop.locator('.filter-chip').count(), 0);
});

await step('Kartenansicht lädt schrittweise, Tabellenansicht ist virtualisiert', async () => {
  await desktop.evaluate(() => window.__redditInvestigator.actions.resetFilters());
  const cards = await desktop.locator('.post-card').count();
  assert.ok(cards > 0 && cards <= 120, `Karten im DOM: ${cards}`);
  await desktop.click('[data-action=mode][data-mode=table]');
  await desktop.waitForSelector('.vt-row');
  const rows = await desktop.locator('.vt-row').count();
  assert.ok(rows < 80, `Tabellenzeilen im DOM: ${rows}`);
  assert.equal(await desktop.locator('.vtable').getAttribute('aria-rowcount'), String(POSTS_SHOWN + 1));
  await desktop.evaluate(() => { document.getElementById('view').scrollTop = 60000; });
  await desktop.waitForTimeout(200);
  const idx = Number(await desktop.locator('.vt-row').first().getAttribute('aria-rowindex'));
  assert.ok(idx > 1000, `nach dem Scrollen gerenderte Zeile ${idx}`);
  await desktop.screenshot({ path: `${OUT}05-tabelle.png` });
  await desktop.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await desktop.click('.vt-head [data-sort=title]');
  const sorted = await desktop.evaluate(() => window.__redditInvestigator.state.filters.sort);
  assert.equal(sorted, 'title');
  await desktop.selectOption('.results-toolbar select[name=sort]', 'newest');
});

await step('Fremde Inhalte werden nicht als HTML ausgeführt (XSS)', async () => {
  await desktop.click('[data-action=mode][data-mode=cards]');
  await desktop.fill('.filter-panel input[name=query]', 'Gefährlicher');
  await desktop.press('.filter-panel input[name=query]', 'Enter');
  await desktop.waitForSelector('.post-card');
  const title = await desktop.locator('.post-card .pc-title').first().innerText();
  assert.match(title, /<img src=x onerror=/);
  await desktop.click('.post-card [data-action=details]');
  await desktop.waitForSelector('.detail-title');
  assert.match(await desktop.locator('.detail-text').innerText(), /<script>window.__xss=2<\/script> fett link/);
  assert.equal(await desktop.evaluate(() => window.__xss), undefined);
  assert.equal(await desktop.locator('img[src="x"], #view script, #detail script').count(), 0);
  assert.equal(await desktop.locator('#detail a[href^="javascript"]').count(), 0);
});

await step('Langer Titel bricht sauber um', async () => {
  await desktop.fill('.filter-panel input[name=query]', 'Sehr langer');
  await desktop.press('.filter-panel input[name=query]', 'Enter');
  await desktop.waitForSelector('.post-card');
  const overflow = await desktop.evaluate(() => {
    const card = document.querySelector('.post-card');
    return card.scrollWidth - card.clientWidth;
  });
  assert.ok(overflow <= 1, `horizontaler Überlauf ${overflow}px`);
  await desktop.screenshot({ path: `${OUT}06-langer-titel.png` });
  await desktop.fill('.filter-panel input[name=query]', '');
  await desktop.press('.filter-panel input[name=query]', 'Enter');
});

await step('Fundstelle merken, Notiz speichern, IndexedDB-Persistenz nach Neuladen', async () => {
  await desktop.click('.post-card [data-action=save] >> nth=0');
  await desktop.waitForFunction(() => window.__redditInvestigator.state.findings.size === 1);
  await desktop.locator('.post-card').nth(1).locator('.pc-title [data-action=details]').click();
  await desktop.fill('#detail-note', 'Meine Notiz mit "Anführungszeichen" & Ümlauten');
  await desktop.fill('#detail-tags', 'wichtig, prüfen');
  await desktop.press('#detail-tags', 'Tab');
  await desktop.waitForTimeout(700);
  const stored = await desktop.evaluate(async () => {
    const req = indexedDB.open('reddit-investigator');
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const rows = await new Promise((res) => { const r = db.transaction('findings').objectStore('findings').getAll(); r.onsuccess = () => res(r.result); });
    db.close();
    return rows;
  });
  assert.equal(stored.length, 2, JSON.stringify(stored));
  const withNote = stored.find((r) => r.note);
  assert.deepEqual(withNote.tags, ['wichtig', 'prüfen']);
  assert.deepEqual(Object.keys(withNote).sort(), ['collection', 'favorite', 'id', 'note', 'publishedUtc', 'savedAt', 'subreddit', 'tags', 'url']);
  assert.ok(!('title' in withNote) && !('text' in withNote), 'keine fremden Volltexte gespeichert');
  await desktop.click('[data-action=mode][data-mode=table]');
  await desktop.reload();
  await desktop.waitForSelector('.home');
  assert.equal(await desktop.evaluate(() => window.__redditInvestigator.state.findings.size), 2);
  assert.equal(await desktop.evaluate(() => window.__redditInvestigator.state.viewMode), 'table', 'Darstellungsmodus bleibt gespeichert');
  await desktop.click('.nav-item[data-view=findings]');
  await desktop.waitForSelector('.finding');
  await desktop.waitForFunction(() => document.querySelectorAll('.finding .status-badge.ok').length === 2);
  await desktop.screenshot({ path: `${OUT}07-fundstellen.png` });
  await desktop.click('.chip[data-tag="wichtig"]');
  assert.equal(await desktop.locator('.finding').count(), 1);
});

await step('Export der Fundstellen (CSV, JSON, Markdown) mit korrekten Sonderzeichen', async () => {
  for (const format of ['csv', 'json', 'md']) {
    await desktop.click('.findings-tools summary');
    const pending = desktop.waitForEvent('download');
    await desktop.click(`[data-action=fexport][data-format=${format}][data-scope=filtered]`);
    const file = await pending;
    const path = `${OUT}export.${format}`;
    await file.saveAs(path);
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    assert.ok(text.includes('Ümlauten'), format);
    if (format === 'csv') assert.ok(text.startsWith('\ufeff') && text.includes('""Anführungszeichen""'));
    if (format === 'json') assert.equal(JSON.parse(text).findings.length, 1);
  }
});

await step('Hell/Dunkel-Wechsel', async () => {
  await desktop.click('.nav-item[data-view=home]');
  const before = await desktop.evaluate(() => document.documentElement.dataset.theme);
  await desktop.click('[data-action=toggle-theme]');
  const after = await desktop.evaluate(() => document.documentElement.dataset.theme);
  assert.notEqual(before, after);
  await desktop.screenshot({ path: `${OUT}08-start-${after}.png` });
  await search(desktop, 'MockAutor');
  await waitDone(desktop);
  await desktop.click('.tab[data-view=posts]');
  await desktop.click('[data-action=mode][data-mode=cards]');
  await desktop.waitForSelector('.post-card');
  await desktop.click('.post-card [data-action=details] >> nth=0');
  await desktop.screenshot({ path: `${OUT}09-beitraege-${after}.png` });
  await desktop.click('.tab[data-view=explorer]');
  await desktop.screenshot({ path: `${OUT}10-explorer-${after}.png` });
  await desktop.click('[data-action=toggle-theme]');
  await desktop.click('.tab[data-view=posts]');
  await desktop.screenshot({ path: `${OUT}11-beitraege-${before}.png` });
});

await step('Tastaturbedienung: "/" fokussiert Suche, Escape schließt Dialoge', async () => {
  await desktop.click('.tab[data-view=overview]');
  await desktop.locator('#view').focus();
  await desktop.keyboard.press('/');
  assert.equal(await desktop.evaluate(() => document.activeElement.name), 'user1');
  await desktop.click('.topbar [data-action=open-settings]');
  await desktop.waitForSelector('#settings-dialog[open]');
  await desktop.focus('[role=tab][aria-selected=true]');
  await desktop.keyboard.press('ArrowRight');
  assert.equal(await desktop.locator('[role=tab][aria-selected=true]').innerText(), 'Suche');
  await desktop.keyboard.press('ArrowRight');
  await desktop.keyboard.press('ArrowRight');
  await desktop.screenshot({ path: `${OUT}12-einstellungen-datenquellen.png` });
  await desktop.keyboard.press('Escape');
  assert.equal(await desktop.locator('#settings-dialog[open]').count(), 0);
  await desktop.focus('#top-search input[name=user1]');
  await desktop.fill('#top-search input[name=user1]', 'Leer');
  await desktop.keyboard.press('Enter');
  await waitDone(desktop);
});

await step('Leere Suchergebnisse', async () => {
  await desktop.click('.tab[data-view=posts]');
  await desktop.waitForSelector('.state-block');
  assert.match(await desktop.locator('.state-block h2').innerText(), /Keine eigenständigen Subreddit-Beiträge/);
  await desktop.screenshot({ path: `${OUT}13-leer.png` });
});

await step('Suche abbrechen', async () => {
  await search(desktop, 'Langsam');
  await desktop.waitForSelector('#top-search .search-cancel:not([hidden])');
  await desktop.click('#top-search .search-cancel');
  await waitDone(desktop, 15000);
  assert.equal(await desktop.evaluate(() => window.__redditInvestigator.state.session.status.state), 'cancelled');
  await desktop.click('.tab[data-view=overview]');
  assert.match(await desktop.locator('.callout').first().innerText(), /abgebrochen/);
});

await step('Temporär nicht verfügbare API zeigt verständlichen Fehler mit Wiederholung', async () => {
  await search(desktop, 'Kaputt');
  await waitDone(desktop, 90000);
  await desktop.click('.tab[data-view=overview]');
  await desktop.waitForSelector('.state-block');
  assert.match(await desktop.locator('.state-block h2').innerText(), /vorübergehend nicht verfügbar/);
  assert.ok(await desktop.locator('.state-block [data-action=retry]').isVisible());
  await desktop.screenshot({ path: `${OUT}14-api-fehler.png` });
});

assert.deepEqual(desktop.errors, [], `Konsolenfehler: ${desktop.errors.join(' | ')}`);

const mobile = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });

await step('Mobile Ansicht: Menü, Filter-Sheet, Karten', async () => {
  await mobile.screenshot({ path: `${OUT}20-mobil-start.png` });
  await search(mobile, 'MockAutor');
  await waitDone(mobile);
  await mobile.screenshot({ path: `${OUT}21-mobil-uebersicht.png` });
  assert.ok(await mobile.locator('.menu-btn').isVisible());
  await mobile.click('.menu-btn');
  await mobile.waitForTimeout(250);
  assert.ok(await mobile.locator('.app.menu-open').count());
  await mobile.screenshot({ path: `${OUT}22-mobil-menue.png` });
  await mobile.click('.sidebar .nav-item[data-view=posts]');
  await mobile.waitForSelector('.post-card');
  assert.equal(await mobile.locator('.filter-panel').isVisible(), false);
  await mobile.click('[data-action=open-filters]');
  assert.ok(await mobile.locator('.filter-panel.open').isVisible());
  await mobile.screenshot({ path: `${OUT}23-mobil-filter.png` });
  await mobile.click('[data-action=close-filters]');
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontaler Überlauf ${overflow}`);
  await mobile.screenshot({ path: `${OUT}24-mobil-beitraege.png` });
  await mobile.click('.post-card [data-action=details] >> nth=0');
  await mobile.waitForSelector('.detail-title');
  await mobile.screenshot({ path: `${OUT}25-mobil-details.png` });
  await mobile.keyboard.press('Escape');
  await mobile.click('.tab[data-view=explorer]');
  await mobile.screenshot({ path: `${OUT}26-mobil-explorer.png` });
});
assert.deepEqual(mobile.errors, [], `Konsolenfehler mobil: ${mobile.errors.join(' | ')}`);

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} UI-Tests bestanden.`);
process.exit(failed.length ? 1 : 0);
