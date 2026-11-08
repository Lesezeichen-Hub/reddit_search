import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, detectType, isProfileSubreddit, PostCollection, mergePost } from '../../js/posts.js';
import { rawPost } from './fixtures.js';

const ctx = { source: 'arctic-shift', searchedAuthor: 'TestUser', retrievedAt: 1800000000000 };

test('erkennt reguläre Subreddit-Posts und Profilposts', () => {
  assert.equal(normalizePost(rawPost({ subreddit: 'mycology' }), ctx).post.isProfile, false);
  assert.equal(normalizePost(rawPost({ subreddit: 'u_TestUser', subreddit_type: 'user' }), ctx).post.isProfile, true);
  assert.equal(isProfileSubreddit('u_TestUser', undefined), true);
  assert.equal(isProfileSubreddit('unicorns', 'public'), false);
  assert.equal(isProfileSubreddit('Something', 'user'), true);
});

test('weist Beiträge nur dem gesuchten Autor zu', () => {
  assert.equal(normalizePost(rawPost({ author: 'testuser' }), ctx).post.author, 'testuser');
  assert.equal(normalizePost(rawPost({ author: 'Anderer' }), ctx).rejected, 'author-mismatch');
});

test('Kommentare werden nie als Beiträge gewertet', () => {
  const comment = { id: 'c1', name: 't1_c1', author: 'TestUser', subreddit: 'x', created_utc: 1, body: 'Text', link_id: 't3_abc' };
  assert.equal(normalizePost(comment, ctx).rejected, 'comment');
  assert.equal(normalizePost({ ...rawPost(), body: 'x' }, ctx).rejected, 'comment');
});

test('gelöschte und entfernte Beiträge werden nicht übernommen', () => {
  assert.equal(normalizePost(rawPost({ removed_by_category: 'moderator' }), ctx).rejected, 'removed');
  assert.equal(normalizePost(rawPost({ selftext: '[removed]' }), ctx).rejected, 'removed');
  assert.equal(normalizePost(rawPost({ selftext: '[deleted]' }), ctx).rejected, 'removed');
  assert.equal(normalizePost(rawPost({ author: '[deleted]' }), ctx).rejected, 'removed');
});

test('ungültige Datensätze werden abgewiesen', () => {
  assert.equal(normalizePost(null, ctx).rejected, 'invalid');
  assert.equal(normalizePost(rawPost({ id: '../x' }), ctx).rejected, 'invalid');
  assert.equal(normalizePost(rawPost({ created_utc: 'abc' }), ctx).rejected, 'invalid');
  assert.equal(normalizePost(rawPost({ subreddit: '' }), ctx).rejected, 'invalid');
});

test('Crossposts werden als solche erkannt und behalten Herkunft', () => {
  const raw = rawPost({ is_self: false, crosspost_parent: 't3_orig1', crosspost_parent_list: [{ id: 'orig1', subreddit: 'fungi', author: 'TestUser', title: 'Original' }] });
  const { post } = normalizePost(raw, ctx);
  assert.equal(post.type, 'crosspost');
  assert.equal(post.isCrosspost, true);
  assert.equal(post.crosspostParentId, 'orig1');
  assert.equal(post.crosspostParentSubreddit, 'fungi');
  assert.equal(post.crosspostParentAuthor, 'TestUser');
});

test('Beitragstypen werden unterschieden', () => {
  assert.equal(detectType({ is_self: true }), 'text');
  assert.equal(detectType({ post_hint: 'image', url: 'https://i.redd.it/x.jpg' }), 'image');
  assert.equal(detectType({ is_gallery: true, url: 'https://www.reddit.com/gallery/x' }), 'gallery');
  assert.equal(detectType({ is_video: true, url: 'https://v.redd.it/x' }), 'video');
  assert.equal(detectType({ url: 'https://www.youtube.com/watch?v=1' }), 'video');
  assert.equal(detectType({ url: 'https://example.com/artikel' }), 'link');
  assert.equal(detectType({ crosspost_parent: 't3_x', is_self: true }), 'crosspost');
});

test('Vorschaubilder nur von erlaubten Hosts', () => {
  const ok = normalizePost(rawPost({ is_self: false, post_hint: 'image', url: 'https://i.redd.it/a.jpg', preview: { images: [{ source: { url: 'https://preview.redd.it/a.jpg?s=1&amp;x=2', width: 1000, height: 800 }, resolutions: [{ url: 'https://preview.redd.it/a.jpg?width=640&amp;s=2', width: 640, height: 512 }] }] } }), ctx).post;
  assert.equal(ok.image.url, 'https://preview.redd.it/a.jpg?width=640&s=2');
  const bad = normalizePost(rawPost({ is_self: false, thumbnail: 'javascript:alert(1)', preview: { images: [{ source: { url: 'https://evil.example/a.jpg' } }] } }), ctx).post;
  assert.equal(bad.image, null);
});

test('Permalink wird validiert, sonst Kurzlink', () => {
  assert.match(normalizePost(rawPost({ id: 'abc12', permalink: '/r/x/comments/abc12/t/' }), ctx).post.permalink, /^https:\/\/www\.reddit\.com\/r\/x\/comments\/abc12\/t\/$/);
  assert.equal(normalizePost(rawPost({ id: 'abc13', permalink: 'javascript:alert(1)' }), ctx).post.permalink, 'https://www.reddit.com/comments/abc13/');
});

test('Kennzahlen gelten erst nach Aktualisierung als verlässlich', () => {
  const fresh = normalizePost(rawPost({ created_utc: 1799999000, _meta: undefined }), ctx).post;
  assert.equal(fresh.metricsReliable, false);
  const old = normalizePost(rawPost({ created_utc: 1700000000, _meta: undefined }), ctx).post;
  assert.equal(old.metricsReliable, true);
});

test('Deduplizierung über die Post-ID, Quellen werden zusammengeführt', () => {
  const coll = new PostCollection();
  const a = rawPost({ id: 'dup1' });
  assert.equal(coll.addRaw([a, a, rawPost({ id: 'dup2' })], ctx), 2);
  assert.equal(coll.size, 2);
  assert.equal(coll.addRaw([{ ...a, score: 999 }], { ...ctx, source: 'reddit-local' }), 0);
  const merged = coll.byId.get('dup1');
  assert.deepEqual(merged.sources.sort(), ['arctic-shift', 'reddit-local']);
  assert.equal(merged.score, 999);
});

test('Original und Crosspost bleiben getrennte Einträge', () => {
  const coll = new PostCollection();
  coll.addRaw([rawPost({ id: 'orig1', subreddit: 'fungi' }), rawPost({ id: 'xp1', subreddit: 'mycology', is_self: false, crosspost_parent: 't3_orig1' })], ctx);
  assert.equal(coll.size, 2);
  assert.equal(coll.byId.get('xp1').isCrosspost, true);
  assert.equal(coll.byId.get('orig1').isCrosspost, false);
});

test('später als entfernt markierte Beiträge verschwinden und kehren nicht zurück', () => {
  const coll = new PostCollection();
  coll.addRaw([rawPost({ id: 'gone1' })], ctx);
  assert.equal(coll.markRemoved('gone1'), true);
  assert.equal(coll.size, 0);
  coll.addRaw([rawPost({ id: 'gone1' })], ctx);
  assert.equal(coll.size, 0);
  assert.equal(coll.rejected.removed, 1);
});

test('mergePost übernimmt fehlende Felder', () => {
  const base = normalizePost(rawPost({ id: 'm1', selftext: '' }), ctx).post;
  const other = { ...base, text: 'Neu', sources: ['reddit-local'] };
  assert.equal(mergePost(base, other).text, 'Neu');
});
