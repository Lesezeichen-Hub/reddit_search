// Optionaler LIVE-Test gegen die echte Arctic-Shift-API (benötigt Internet).
// Er prüft, ob die dokumentierten Parameter und Antwortstrukturen weiterhin
// so funktionieren, wie der Adapter sie erwartet. Kein Bestandteil von "npm test",
// da externe Dienste nicht immer verfügbar sind.
//   npm run test:live            (Standard: u/spez)
//   node tests/live/arctic-shift.live.mjs <benutzername>
import assert from 'node:assert/strict';
import { ArcticShiftAdapter } from '../../js/adapters/arctic-shift.js';
import { RequestScheduler } from '../../js/net.js';
import { SOURCES } from '../../js/config.js';
import { PostCollection } from '../../js/posts.js';

const author = process.argv[2] ?? 'spez';
const scheduler = new RequestScheduler({ ...SOURCES.arcticShift, isOnline: () => true });
const adapter = new ArcticShiftAdapter({ scheduler });
const collection = new PostCollection();

console.log(`LIVE: Arctic Shift – Suche nach eigenständigen Beiträgen von u/${author}`);
const test = await adapter.test();
console.log(`  Erreichbarkeit: ${test.message} (${test.latencyMs} ms)`);

const started = Date.now();
const result = await adapter.search({
  author,
  onPage: (raw) => collection.addRaw(raw, { source: 'arctic-shift', searchedAuthor: author }),
  onProgress: (p) => p.sectionsTotal && process.stdout.write(`\r  Abschnitte ${p.sectionsDone}/${p.sectionsTotal}, geladen ${p.loaded}   `)
});
console.log(`\n  Dauer: ${Date.now() - started} ms, Anfragen: ${scheduler.stats.requests}, Wiederholungen: ${scheduler.stats.retries}`);
console.log(`  Archivindex: ${result.expectedTotal ?? 'nicht verfügbar'}, geladen: ${result.loaded}, Vollständigkeit: ${result.completeness}`);
const posts = collection.all();
const regular = posts.filter((p) => !p.isProfile);
const subs = new Set(regular.map((p) => p.subredditKey));
console.log(`  Subreddit-Beiträge: ${regular.length} in ${subs.size} Subreddits, Profilposts: ${posts.length - regular.length}, ausgeblendet (gelöscht/entfernt): ${collection.rejected.removed}`);
for (const issue of result.issues) console.log(`  Hinweis: ${issue.message}`);

assert.ok(result.loaded > 0, 'es wurden Beiträge geladen');
assert.ok(posts.every((p) => p.author.toLowerCase() === author.toLowerCase()), 'alle Beiträge gehören dem Autor');
assert.ok(posts.every((p) => /^https:\/\/www\.reddit\.com\//.test(p.permalink)), 'jeder Treffer hat einen Reddit-Link');
if (result.expectedTotal !== null) assert.equal(result.completeness, 'complete', 'Archivindex und geladene Beiträge stimmen überein');
console.log('LIVE-Test erfolgreich.');
