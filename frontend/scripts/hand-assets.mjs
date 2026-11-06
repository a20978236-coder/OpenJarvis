/**
 * On-device hand tracking assets (Stage G), served by the HELL server itself
 * so no camera data or model request ever leaves your network:
 *   public/mediapipe/wasm/*   MediaPipe Tasks Vision runtime (copied from npm)
 *   public/mediapipe/gesture_recognizer.task   the open-source model (8 MB)
 *
 * Both are Apache-2.0. They are build products (git-ignored). The model is
 * downloaded once and verified against a pinned SHA-256; if the download
 * isn't possible (offline build) the app still builds and the Hands feature
 * says plainly that the model is missing.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
export const HAND_MODEL_SHA256 = '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482';
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function ensureHandAssets(root, log = console) {
  const out = path.join(root, 'public', 'mediapipe');
  const wasmOut = path.join(out, 'wasm');
  mkdirSync(wasmOut, { recursive: true });

  const src = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  for (const f of WASM_FILES) {
    const from = path.join(src, f);
    const to = path.join(wasmOut, f);
    if (!existsSync(from)) {
      log.warn(`[hand-assets] missing ${from} — run npm install`);
      continue;
    }
    if (!existsSync(to) || sha256(readFileSync(from)) !== sha256(readFileSync(to))) copyFileSync(from, to);
  }

  const model = path.join(out, 'gesture_recognizer.task');
  if (existsSync(model) && sha256(readFileSync(model)) === HAND_MODEL_SHA256) return { model: true };
  const local = process.env.HELL_HAND_MODEL;
  try {
    let buf;
    if (local) buf = readFileSync(local);
    else {
      const res = await fetch(HAND_MODEL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    }
    const got = sha256(buf);
    if (got !== HAND_MODEL_SHA256) throw new Error(`checksum mismatch (${got.slice(0, 12)}…)`);
    writeFileSync(`${model}.tmp`, buf);
    renameSync(`${model}.tmp`, model);
    log.info?.('[hand-assets] hand gesture model ready');
    return { model: true };
  } catch (e) {
    log.warn(`[hand-assets] hand gesture model not available (${e instanceof Error ? e.message : e}). Camera hand gestures will report it as missing.`);
    return { model: false };
  }
}

/** Vite plugin: make sure the assets exist before dev/build. */
export function handAssetsPlugin() {
  let done = false;
  return {
    name: 'hell-hand-assets',
    async buildStart() {
      if (done) return;
      done = true;
      await ensureHandAssets(process.cwd(), { info: (m) => console.log(m), warn: (m) => console.warn(m) });
    },
  };
}
