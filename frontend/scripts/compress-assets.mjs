/**
 * Write .br and .gz copies of the built app's compressible files, so the
 * HELL server can send them pre-compressed (see server/static_compress.py).
 * Cuts what an iPhone downloads by roughly 70%, with no per-request CPU.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const EXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.wasm', '.txt', '.map']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield [p, st.size];
  }
}

export function compressDir(dir) {
  let before = 0;
  let after = 0;
  let files = 0;
  for (const [file, size] of walk(dir)) {
    if (!EXT.has(path.extname(file)) || size < 1024) continue;
    const data = readFileSync(file);
    // Max quality for normal files; a faster level for multi-MB wasm.
    const quality = size > 2 * 1024 * 1024 ? 9 : 11;
    const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: size } });
    const gz = gzipSync(data, { level: 9 });
    if (br.length < size * 0.95) writeFileSync(`${file}.br`, br);
    if (gz.length < size * 0.95) writeFileSync(`${file}.gz`, gz);
    before += size;
    after += Math.min(br.length, size);
    files++;
  }
  return { files, before, after };
}

/** Vite plugin: compress the output after a production build. */
export function compressAssetsPlugin() {
  let outDir = '';
  return {
    name: 'hell-compress-assets',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const t0 = Date.now();
      const r = compressDir(outDir);
      console.log(`[compress] ${r.files} files: ${(r.before / 1048576).toFixed(1)} MB → ${(r.after / 1048576).toFixed(1)} MB brotli (${Date.now() - t0} ms)`);
    },
  };
}
