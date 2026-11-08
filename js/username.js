const NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
const REDDIT_HOST = /^(?:[a-z0-9-]+\.)?reddit\.com$/i;

/**
 * Bereinigt Eingaben wie "Name", "u/Name", "/user/Name" oder Profil-URLs.
 * Liefert { ok, username, error }.
 */
export function normalizeUsername(input) {
  let value = String(input ?? '').trim();
  if (!value) return { ok: false, username: '', error: 'Bitte einen Reddit-Benutzernamen eingeben.' };

  if (/^(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)?reddit\.com\/)/i.test(value)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return { ok: false, username: '', error: 'Die Profil-URL ist ungültig.' };
    }
    if (!REDDIT_HOST.test(url.hostname)) {
      return { ok: false, username: '', error: 'Nur Profil-URLs von reddit.com werden akzeptiert.' };
    }
    const match = url.pathname.match(/^\/(?:user|u)\/([^/]+)/i);
    if (!match) return { ok: false, username: '', error: 'Die URL verweist auf kein Reddit-Benutzerprofil.' };
    value = decodeURIComponent(match[1]);
  } else {
    value = value.replace(/^@/, '').replace(/^\/?(?:u|user)\//i, '').replace(/\/+$/, '');
  }

  if (!value) return { ok: false, username: '', error: 'Bitte einen Reddit-Benutzernamen eingeben.' };
  if (!NAME_PATTERN.test(value)) {
    return {
      ok: false,
      username: '',
      error: 'Ungültiger Benutzername: erlaubt sind 1–20 Zeichen aus Buchstaben, Ziffern, „_“ und „-“.'
    };
  }
  if (/^\[?deleted\]?$/i.test(value)) {
    return { ok: false, username: '', error: 'Gelöschte Konten können nicht durchsucht werden.' };
  }
  return { ok: true, username: value, error: '' };
}

export function sameUser(a, b) {
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
}
