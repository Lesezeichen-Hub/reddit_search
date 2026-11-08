import { EXTERNAL_SEARCH_ENGINES } from '../config.js';

/**
 * Erzeugt Links für eine manuelle Recherche in externen Suchmaschinen.
 * Es findet keine automatisierte Abfrage und kein Scraping statt.
 */
export function externalSearchLinks(username) {
  const queries = [
    { label: 'Subreddit-Seiten mit dem Namen', query: `site:reddit.com/r/ "${username}"` },
    { label: 'Erwähnungen als u/-Name', query: `site:reddit.com "u/${username}"` }
  ];
  const links = [];
  for (const q of queries) {
    for (const engine of EXTERNAL_SEARCH_ENGINES) {
      links.push({ engine: engine.label, label: q.label, query: q.query, url: engine.url + encodeURIComponent(q.query) });
    }
  }
  links.push({
    engine: 'Reddit',
    label: 'Reddit-Suche im Browser (author:)',
    query: `author:${username}`,
    url: `https://www.reddit.com/search/?q=${encodeURIComponent(`author:${username}`)}&type=posts&sort=new`
  });
  return links;
}
