/**
 * Where a phone should land when it opens the server's bare address.
 *
 * HELL (the iPhone app) lives at `/m`; `/` is the desktop layout, which on a
 * 390pt-wide screen opens as a sidebar over half-hidden pages. A phone that
 * types or bookmarks the plain address is sent to HELL instead.
 *
 * Only the bare address is redirected, and only on first load: the desktop
 * pages stay reachable from a phone through their own links (Settings ›
 * "Full settings" opens `/settings`), and `/?desktop=1` opens the desktop
 * chat on purpose.
 */
const PHONE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone/i;

export function phoneLanding(pathname: string, search: string, userAgent: string): string | null {
  if (pathname !== '/' && pathname !== '') return null;
  if (new URLSearchParams(search).has('desktop')) return null;
  return PHONE_UA.test(userAgent) ? '/m' : null;
}
