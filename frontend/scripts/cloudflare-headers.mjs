/**
 * Cloudflare build only: copy cloud/_headers into the build output, so the
 * static app gets the same security headers the HELL home server adds
 * (server/middleware.py), plus sensible caching.
 */
import { copyFileSync } from 'node:fs';
import path from 'node:path';

export function cloudflareHeadersPlugin() {
  let outDir = '';
  let root = '';
  return {
    name: 'hell-cloudflare-headers',
    apply: 'build',
    configResolved(c) {
      root = c.root;
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      copyFileSync(path.resolve(root, '../cloud/_headers'), path.join(outDir, '_headers'));
    },
  };
}
