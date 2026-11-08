import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, sameUser } from '../../js/username.js';

test('akzeptiert reine Namen, u/-Präfix und Profil-URLs', () => {
  for (const input of ['BeispielUser', 'u/BeispielUser', '/u/BeispielUser', 'user/BeispielUser', ' @BeispielUser ',
    'https://www.reddit.com/user/BeispielUser/', 'https://old.reddit.com/u/BeispielUser/submitted/', 'reddit.com/user/BeispielUser',
    'www.reddit.com/user/BeispielUser', 'https://www.reddit.com/user/BeispielUser/comments/?sort=new']) {
    const r = normalizeUsername(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.username, 'BeispielUser', input);
  }
});

test('erlaubt Unterstrich und Bindestrich', () => {
  assert.equal(normalizeUsername('a_b-c').username, 'a_b-c');
});

test('lehnt ungültige Eingaben ab', () => {
  for (const input of ['', '   ', 'zu langer benutzername', 'name!', 'https://example.com/user/x', 'https://www.reddit.com/r/mycology/', 'a'.repeat(21), '[deleted]', 'u/', '<script>']) {
    const r = normalizeUsername(input);
    assert.equal(r.ok, false, input);
    assert.ok(r.error.length > 0);
  }
});

test('Vergleich ignoriert Groß-/Kleinschreibung', () => {
  assert.equal(sameUser('Spez', 'spez'), true);
  assert.equal(sameUser('spez', 'spezz'), false);
});
