import { decodeEntities, markdownToPlain, redditPermalink, safeHttpUrl, safeImageUrl } from './text.js';
import { sameUser } from './username.js';

export const POST_TYPES = {
  text: { label: 'Textpost', icon: 'i-text' },
  image: { label: 'Bildpost', icon: 'i-image' },
  gallery: { label: 'Galerie', icon: 'i-gallery' },
  video: { label: 'Video', icon: 'i-video' },
  link: { label: 'Linkpost', icon: 'i-link' },
  crosspost: { label: 'Crosspost', icon: 'i-crosspost' }
};

const REMOVED_MARKERS = new Set(['[removed]', '[deleted]', '[ Removed by Reddit ]', '[removed by reddit]']);
const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif)(?:$|\?)/i;
const VIDEO_DOMAINS = /(^|\.)(?:v\.redd\.it|youtube\.com|youtu\.be|vimeo\.com|streamable\.com|twitch\.tv)$/i;
const IMAGE_DOMAINS = /(^|\.)(?:i\.redd\.it|i\.imgur\.com)$/i;

export function isProfileSubreddit(subreddit, subredditType) {
  return subredditType === 'user' || /^u_/i.test(String(subreddit ?? ''));
}

export function detectRemoval(raw) {
  if (raw.removed_by_category) return String(raw.removed_by_category);
  if (raw.author === '[deleted]') return 'deleted';
  const self = typeof raw.selftext === 'string' ? raw.selftext.trim() : '';
  if (REMOVED_MARKERS.has(self) || REMOVED_MARKERS.has(self.toLowerCase())) return self.includes('deleted') ? 'deleted' : 'removed';
  if (typeof raw.title === 'string' && /^\[(?:deleted|removed)(?: by user)?\]$/i.test(raw.title.trim())) return 'deleted';
  return null;
}

export function detectType(raw) {
  if (raw.crosspost_parent || (Array.isArray(raw.crosspost_parent_list) && raw.crosspost_parent_list.length)) return 'crosspost';
  if (raw.is_gallery || /reddit\.com\/gallery\//i.test(String(raw.url ?? ''))) return 'gallery';
  const hint = String(raw.post_hint ?? '');
  let domain = '';
  try { domain = new URL(String(raw.url ?? '')).hostname; } catch { domain = String(raw.domain ?? ''); }
  if (raw.is_video || hint === 'hosted:video' || hint === 'rich:video' || VIDEO_DOMAINS.test(domain)) return 'video';
  if (raw.is_self) return 'text';
  if (hint === 'image' || IMAGE_DOMAINS.test(domain) || IMAGE_EXT.test(String(raw.url ?? ''))) return 'image';
  if (hint === 'self' || /^self\./i.test(String(raw.domain ?? ''))) return 'text';
  return 'link';
}

function pickResolution(list, target = 640) {
  if (!Array.isArray(list) || !list.length) return null;
  const sorted = [...list].filter((r) => r && (r.url || r.u)).sort((a, b) => (a.width ?? a.x ?? 0) - (b.width ?? b.x ?? 0));
  return sorted.find((r) => (r.width ?? r.x ?? 0) >= target) ?? sorted[sorted.length - 1] ?? null;
}

export function previewImage(raw) {
  const image = raw.preview?.images?.[0];
  if (image) {
    const res = pickResolution(image.resolutions) ?? image.source;
    const url = safeImageUrl(res?.url);
    if (url) return { url, width: res.width ?? null, height: res.height ?? null };
  }
  if (raw.is_gallery && raw.media_metadata && typeof raw.media_metadata === 'object') {
    const firstId = raw.gallery_data?.items?.find((i) => !i.is_deleted)?.media_id;
    const meta = raw.media_metadata[firstId] ?? Object.values(raw.media_metadata)[0];
    const res = pickResolution(meta?.p) ?? meta?.s;
    const url = safeImageUrl(res?.u ?? res?.url);
    if (url) return { url, width: res.x ?? null, height: res.y ?? null };
  }
  const thumb = safeImageUrl(raw.thumbnail);
  if (thumb) return { url: thumb, width: raw.thumbnail_width ?? null, height: raw.thumbnail_height ?? null };
  return null;
}

function toInt(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Prüft ein Rohobjekt und erzeugt einen normalisierten Beitrag.
 * Rückgabe: { post } oder { rejected: Grund }.
 */
export function normalizePost(raw, { source, searchedAuthor, retrievedAt = Date.now() }) {
  if (!raw || typeof raw !== 'object') return { rejected: 'invalid' };
  const id = typeof raw.id === 'string' ? raw.id.replace(/^t3_/, '') : '';
  if (!/^[a-z0-9]{1,13}$/i.test(id)) return { rejected: 'invalid' };
  // Kommentare besitzen body/link_id, aber keinen Titel – sie sind keine eigenständigen Beiträge.
  if (typeof raw.title !== 'string' || 'body' in raw || (typeof raw.name === 'string' && raw.name.startsWith('t1_'))) {
    return { rejected: 'comment' };
  }
  const createdUtc = toInt(raw.created_utc);
  if (createdUtc === null || createdUtc <= 0) return { rejected: 'invalid' };
  if (typeof raw.subreddit !== 'string' || !raw.subreddit) return { rejected: 'invalid' };
  if (searchedAuthor && !sameUser(raw.author, searchedAuthor)) {
    const removal = detectRemoval(raw);
    return { rejected: removal ? 'removed' : 'author-mismatch' };
  }
  const removal = detectRemoval(raw);
  if (removal) return { rejected: 'removed', id, subreddit: raw.subreddit };

  const type = detectType(raw);
  const parent = Array.isArray(raw.crosspost_parent_list) ? raw.crosspost_parent_list[0] : null;
  const isSelf = Boolean(raw.is_self);
  const metaSecond = raw._meta?.retrieved_2nd_on;
  const ageHours = (retrievedAt / 1000 - createdUtc) / 3600;
  const metricsReliable = Boolean(metaSecond) || source !== 'arctic-shift' || ageHours > 48;
  const domain = typeof raw.domain === 'string' ? raw.domain : '';
  const externalUrl = isSelf ? null : safeHttpUrl(raw.url_overridden_by_dest ?? raw.url);

  const post = {
    id,
    fullname: `t3_${id}`,
    author: String(raw.author ?? ''),
    subreddit: raw.subreddit,
    subredditKey: raw.subreddit.toLowerCase(),
    isProfile: isProfileSubreddit(raw.subreddit, raw.subreddit_type),
    createdUtc,
    title: decodeEntities(raw.title).trim() || '(ohne Titel)',
    text: isSelf && typeof raw.selftext === 'string' ? markdownToPlain(raw.selftext) : '',
    type,
    isCrosspost: type === 'crosspost',
    crosspostParentId: typeof raw.crosspost_parent === 'string' ? raw.crosspost_parent.replace(/^t3_/, '') : (parent?.id ?? null),
    crosspostParentSubreddit: typeof parent?.subreddit === 'string' ? parent.subreddit : null,
    crosspostParentAuthor: typeof parent?.author === 'string' ? parent.author : null,
    crosspostParentTitle: typeof parent?.title === 'string' ? decodeEntities(parent.title) : null,
    permalink: redditPermalink(raw.permalink, id),
    externalUrl: externalUrl && !/^https?:\/\/(?:www\.)?reddit\.com\/(?:r|gallery)\//i.test(externalUrl) ? externalUrl : null,
    domain: domain.slice(0, 120),
    image: previewImage(raw),
    over18: Boolean(raw.over_18),
    spoiler: Boolean(raw.spoiler),
    score: toInt(raw.score),
    numComments: toInt(raw.num_comments),
    metricsReliable,
    flair: typeof raw.link_flair_text === 'string' ? decodeEntities(raw.link_flair_text).slice(0, 80) : '',
    sources: [source],
    retrievedOn: toInt(raw.retrieved_on)
  };
  if (post.type === 'crosspost' && !post.image && parent) post.image = previewImage(parent);
  return { post };
}

/** Führt Treffer verschiedener Quellen zusammen (gleiche Post-ID = ein Eintrag). */
export function mergePost(existing, incoming) {
  const merged = { ...existing };
  merged.sources = [...new Set([...existing.sources, ...incoming.sources])];
  // Live-Daten von Reddit sind für Kennzahlen aktueller als Archivdaten.
  if (incoming.sources.includes('reddit-local')) {
    if (incoming.score !== null) merged.score = incoming.score;
    if (incoming.numComments !== null) merged.numComments = incoming.numComments;
    merged.metricsReliable = true;
  }
  for (const key of ['text', 'image', 'crosspostParentSubreddit', 'crosspostParentTitle', 'flair', 'externalUrl']) {
    if (!merged[key] && incoming[key]) merged[key] = incoming[key];
  }
  return merged;
}

export class PostCollection {
  constructor() {
    this.byId = new Map();
    this.rejected = { removed: 0, comment: 0, 'author-mismatch': 0, invalid: 0 };
    this.removedIds = new Set();
    this.version = 0;
  }

  /** Nimmt Rohdaten auf; liefert die Anzahl neuer Einträge. */
  addRaw(rawList, context) {
    let added = 0;
    for (const raw of rawList) {
      const result = normalizePost(raw, context);
      if (result.rejected) {
        if (result.rejected === 'removed' && result.id) {
          if (!this.removedIds.has(result.id)) {
            this.removedIds.add(result.id);
            this.rejected.removed += 1;
          }
        } else {
          this.rejected[result.rejected] = (this.rejected[result.rejected] ?? 0) + 1;
        }
        continue;
      }
      if (this.add(result.post)) added += 1;
    }
    if (added) this.version += 1;
    return added;
  }

  add(post) {
    if (this.removedIds.has(post.id)) return false;
    const existing = this.byId.get(post.id);
    if (existing) {
      this.byId.set(post.id, mergePost(existing, post));
      return false;
    }
    this.byId.set(post.id, post);
    return true;
  }

  /** Entfernt einen Beitrag, dessen Entfernung später bekannt wird (z. B. über Reddit). */
  markRemoved(id) {
    if (this.byId.delete(id)) {
      this.removedIds.add(id);
      this.rejected.removed += 1;
      this.version += 1;
      return true;
    }
    return false;
  }

  get size() {
    return this.byId.size;
  }

  all() {
    return [...this.byId.values()];
  }
}
