#!/usr/bin/env node
/**
 * HELL build tester — smoke-tests the PRODUCTION build in a headless iPhone 12.
 *
 *   npm run build && npm run test:smoke      (or: npm run test:build)
 *
 * Serves the built app with `vite preview` and fakes the OpenJarvis server
 * API in the browser, so no backend or AI model is needed (works in CI).
 * Every check is independent; the script prints PASS/FAIL per check and
 * exits non-zero if anything failed or the page threw an error.
 *
 * Env: SMOKE_BROWSER=/path/to/chromium  (optional executable override)
 *      SMOKE_HEADED=1                     (watch it run)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { preview } from 'vite';
import { chromium, devices } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.resolve(root, '../src/openjarvis/server/static');
if (!existsSync(path.join(outDir, 'index.html'))) {
  console.error(`No build found at ${outDir}. Run "npm run build" first.`);
  process.exit(2);
}

// --------------------------------------------------------------------------
// Fake server API
// --------------------------------------------------------------------------

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const sse = (text) => ({
  status: 200,
  contentType: 'text/event-stream',
  body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })}\n\n`,
});

function fakeServer(state) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    if (p === '/health') return route.fulfill(json({ status: 'ok' }));
    if (p === '/v1/auth/session') {
      if (state.authRequired && method === 'POST') {
        const ok = req.postDataJSON()?.passcode === 'correct horse';
        if (ok) state.authRequired = false;
        return route.fulfill(ok ? json({ auth_required: true, authenticated: true }) : json({ detail: 'Wrong passcode' }, 401));
      }
      return route.fulfill(json({ auth_required: state.authRequired, authenticated: !state.authRequired, via: state.authRequired ? null : 'cookie' }));
    }
    if (state.authRequired && p.startsWith('/v1/')) return route.fulfill(json({ detail: 'Missing Authorization header' }, 401));
    if (p === '/v1/models') return route.fulfill(json({ data: [{ id: 'smoke-model', owned_by: 'ollama' }, { id: 'smoke-vision', owned_by: 'ollama' }] }));
    if (p === '/v1/info') return route.fulfill(json({ model: 'smoke-model', agent: null, engine: 'ollama' }));
    if (p === '/v1/speech/health') return route.fulfill(json({ available: state.speech }));
    if (p === '/v1/speech/transcribe') return route.fulfill(json({ text: state.heard, language: 'en', confidence: 1, duration_seconds: 1 }));
    if (p === '/v1/speech/tts/health') return route.fulfill(json({ available: false }));
    if (p === '/v1/speech/voices') return route.fulfill(json({ available: true, backend: 'kokoro', voices: ['af_heart', 'bm_george'], default_voice: 'af_heart', speed: 1 }));
    if (p === '/v1/speech/synthesize') {
      state.synth.push(req.postDataJSON());
      // 0.2 s of silence as a WAV.
      const n = 4800, buf = Buffer.alloc(44 + n * 2);
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(24000, 24);
      buf.writeUInt32LE(48000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: buf });
    }
    if (p === '/v1/memory/stats') return route.fulfill(json({ entries: 3, backend: 'sqlite' }));
    if (p === '/v1/memory/facts') {
      const facts = [{ index: 0, text: 'Likes espresso', source: 'auto', created_at: 1, trust: 'auto', recallable: true }];
      if (!state.approved) facts.push({ index: 1, text: 'User prefers dark mode', source: 'auto', created_at: 2, trust: 'pending', recallable: false });
      return route.fulfill(json({ enabled: true, facts }));
    }
    if (p === '/v1/memory/facts/approve') {
      state.approved = req.postDataJSON();
      return route.fulfill(json({ status: 'approved' }));
    }
    if (p === '/v1/memory/settings') {
      return route.fulfill(json({ learning: 'ask', use_in_replies: true, learning_available: true, facts: { total: 2, pending: state.approved ? 0 : 1, quarantined: 0 }, documents: 0, sensitive_policy: 'Secrets are never stored.' }));
    }
    if (p === '/v1/memory/documents') return route.fulfill(json({ documents: [], total: 0 }));
    if (p === '/v1/personal/summary') return route.fulfill(json({ open_tasks: 1, due_today: 1, notes: 0 }));
    if (p === '/v1/personal/tasks') {
      if (method === 'POST') {
        const t = { id: `t${state.tasks.length}`, title: req.postDataJSON().title, notes: '', due: null, priority: 0, done: false, created_at: 0, updated_at: 0, completed_at: null };
        state.tasks.push(t);
        return route.fulfill(json(t, 201));
      }
      return route.fulfill(json({ tasks: state.tasks }));
    }
    if (p === '/v1/personal/notes') return route.fulfill(json({ notes: [] }));
    if (p === '/v1/personal/holograms') {
      if (method === 'POST') {
        state.saved = { id: 'h1', ...req.postDataJSON() };
        return route.fulfill(json({ id: 'h1', name: state.saved.name, objects: state.saved.data.objects.length, data: state.saved.data }, 201));
      }
      return route.fulfill(json({ holograms: state.saved ? [{ id: 'h1', name: state.saved.name, objects: state.saved.data.objects.length, created_at: 0, updated_at: 0 }] : [] }));
    }
    if (p === '/v1/hell/vision') {
      const m = url.searchParams.get('model') || '';
      return route.fulfill(json({ model: m, engine_accepts: true, model_sees: m === 'smoke-vision', vision_models: ['smoke-vision'], hint: 'ollama pull qwen2.5vl:7b' }));
    }
    if (p === '/v1/hell/files' && req.method() === 'POST') {
      state.files.push({ id: 'a'.repeat(32), name: 'notes.txt', size: 5, type: 'text/plain', created_at: 1, in_memory: false, memory_chunks: 0, can_add_to_memory: true });
      return route.fulfill(json(state.files[state.files.length - 1], 201));
    }
    if (p === '/v1/hell/files') return route.fulfill(json({ files: state.files, total_bytes: 5 * state.files.length, max_file_bytes: 26214400 }));
    if (p.endsWith('/memory') && p.startsWith('/v1/hell/files/')) {
      state.files = state.files.map((f) => ({ ...f, in_memory: true, memory_chunks: 1 }));
      return route.fulfill(json({ ...state.files[0], secrets_removed: 0 }));
    }
    if (p === '/v1/agents') return route.fulfill(json({ registered: ['simple'], running: [] }));
    if (p === '/v1/skills') return route.fulfill(json({ skills: [] }));
    if (p === '/v1/chat/completions') {
      const body = req.postDataJSON();
      if (body.stream === false) {
        // Hologram AI fallback: answer with editor operations.
        state.aiCalls++;
        return route.fulfill(json({ choices: [{ message: { content: '<think>plan</think>{"ops":[{"op":"add","type":"rotating","props":{"variant":"crystal","color":"gold"}}],"reply":"Added a golden crystal."}' } }] }));
      }
      const parts = Array.isArray(body.messages?.at(-1)?.content) ? body.messages.at(-1).content : [];
      const frames = parts.filter((c) => c.type === 'image_url').length;
      if (frames) {
        state.visionFrames.push(frames);
        return route.fulfill(sse('A green test card.'));
      }
      return route.fulfill(sse('Systems online.'));
    }
    if (p.startsWith('/v1/') || p.startsWith('/api/')) return route.fulfill(json({}));
    return route.continue();
  };
}

// --------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e });
    console.log(`  FAIL  ${name}\n        ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = await preview({ root, logLevel: 'silent', preview: { port: 0, strictPort: false, host: '127.0.0.1' } });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({
  headless: !process.env.SMOKE_HEADED,
  executablePath: process.env.SMOKE_BROWSER || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

// iPhone 12 home-screen app: 844pt minus the notch (47) and home-indicator (34) insets.
const IPHONE_12_APP = { ...devices['iPhone 12'], viewport: { width: 390, height: 763 } };

async function newPage(state, opts = IPHONE_12_APP) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The upstream KaTeX font is blocked by the production CSP; harmless.
    // MediaPipe's WebAssembly prints its native INFO/W lines through console.error.
    if (m.type() === 'error' && !/Failed to load resource|KaTeX|data:font|XNNPACK|^[IWE]\d{4} /.test(m.text())) errors.push(m.text());
  });
  await page.route('**/*', fakeServer(state));
  return { ctx, page, errors };
}
const freshState = () => ({ authRequired: false, tasks: [], saved: null, aiCalls: 0, speech: false, heard: '', visionFrames: [], synth: [], files: [] });

console.log(`HELL smoke test — ${base}\n`);

{
  const state = freshState();
  const { ctx, page, errors } = await newPage(state);

  await check('Dashboard renders HELL with all 12 modules and the orb', async () => {
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.locator('.hd').waitFor();
    expect((await page.locator('.hell-wordmark').first().getAttribute('aria-label')) === 'HELL Phase 6', 'wordmark missing');
    expect((await page.locator('.hd-module').count()) === 12, 'expected 12 module buttons');
    await page.waitForFunction(() => ['3d', 'fallback'].includes(document.querySelector('.hell-orb')?.getAttribute('data-mode') ?? ''), null, { timeout: 15000 });
    expect(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'page scrolls sideways');
  });

  await check('No "Jarvis" branding on the dashboard', async () => {
    const text = await page.evaluate(() => document.body.innerText);
    expect(!/jarvis/i.test(text), 'found "Jarvis" in visible text');
  });

  await check('Chat streams a reply', async () => {
    await page.locator('.hd-dock').getByRole('button', { name: 'Type a message' }).click();
    await page.keyboard.type('Status report');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/m/chat');
    await page.getByText('Systems online.').waitFor({ timeout: 10000 });
  });

  await check('Memory, Tasks, Notes, Settings and AI Modules open', async () => {
    const screens = [
      ['/m/memory', () => page.getByText('Likes espresso')],
      ['/m/tasks', () => page.getByLabel('New task')],
      ['/m/tasks?view=notes', () => page.getByLabel('Search notes')],
      ['/m/settings', () => page.getByRole('slider', { name: 'Interface brightness' })],
      ['/m/ai', () => page.getByRole('radio', { name: 'smoke-model' })],
    ];
    for (const [path, find] of screens) {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await find().first().waitFor({ timeout: 8000 }).catch(() => {
        throw new Error(`${path} did not render its main control`);
      });
    }
  });

  await check('Adding a task works', async () => {
    await page.goto(`${base}/m/tasks`, { waitUntil: 'networkidle' });
    await page.getByLabel('New task').fill('Smoke-test task');
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByText('Smoke-test task', { exact: true }).waitFor();
  });

  await check('Hologram Builder opens with a 3D workspace', async () => {
    await page.goto(`${base}/m/hologram`, { waitUntil: 'networkidle' });
    await page.locator('.holo-canvas canvas').waitFor({ timeout: 15000 });
  });

  await check('Builder toolbar fits the iPhone 12 with an object selected (44pt targets)', async () => {
    await page.getByRole('button', { name: 'Add object' }).click();
    await page.getByRole('button', { name: /^Digital clock/ }).click();
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.holo-toolbar').getBoundingClientRect();
      return [...document.querySelectorAll('.holo-tool')].map((e) => {
        const b = e.getBoundingClientRect();
        return { label: e.getAttribute('aria-label'), ok: b.width >= 44 && b.height >= 44 && b.right <= bar.right + 1 && b.left >= bar.left - 1 };
      });
    });
    const bad = r.filter((x) => !x.ok).map((x) => x.label);
    expect(bad.length === 0, `cut off or too small: ${bad.join(', ')}`);
    await page.getByRole('button', { name: 'Undo' }).click();
  });

  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('hell-holo-draft-v1') || 'null'));
  // No draft yet on a fresh device means the starter layout: the HELL orb alone.
  const count = async () => (await draft())?.layout?.objects?.length ?? 1;

  await check('Voice/text building: "build me a 3D rotating planet" creates it (built-in)', async () => {
    const before = await count();
    await page.getByRole('button', { name: 'Ask HELL to build' }).click();
    await page.getByLabel('What should HELL build?').fill('build me a 3D rotating planet');
    await page.getByRole('button', { name: 'Run command' }).click();
    await page.getByText('Built-in command').first().waitFor();
    await page.waitForTimeout(600);
    const d = await draft();
    expect(d.layout.objects.length === before + 1, `expected ${before + 1} objects, got ${d.layout.objects.length}`);
    expect(d.layout.objects.at(-1).variant === 'planet', 'last object is not a planet');
  });

  await check('AI fallback turns a free-form request into a real object', async () => {
    const before = await count();
    await page.getByLabel('What should HELL build?').fill('conjure something shiny and precious');
    await page.getByRole('button', { name: 'Run command' }).click();
    await page.getByText('Added a golden crystal.').waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    const d = await draft();
    expect(d.layout.objects.length === before + 1, 'AI result was not applied');
    expect(d.layout.objects.at(-1).variant === 'crystal', 'AI object type wrong');
  });

  await check('One undo reverts a whole command', async () => {
    const before = await count();
    await page.getByRole('button', { name: 'Close Ask HELL' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(600);
    expect((await count()) === before - 1, 'undo did not revert the AI change');
  });

  await check('"Save this layout" saves to the server', async () => {
    await page.getByRole('button', { name: 'Ask HELL to build' }).click();
    await page.getByLabel('What should HELL build?').fill('save this layout as Smoke deck');
    await page.getByRole('button', { name: 'Run command' }).click();
    await page.getByText('Saved “Smoke deck”.').waitFor({ timeout: 8000 });
  });

  await check('Vision: camera only on tap, one frame per question, camera-off works', async () => {
    await ctx.grantPermissions(['camera'], { origin: base });
    await page.goto(`${base}/m/vision`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Turn camera on' }).waitFor({ timeout: 8000 });
    expect((await page.locator('video').evaluate((v) => v.srcObject)) === null, 'camera started without a tap');
    await page.getByRole('button', { name: 'Turn camera on' }).click();
    await page.getByRole('button', { name: 'Turn camera off' }).waitFor({ timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0, null, { timeout: 8000 });
    expect(state.visionFrames.length === 0, 'frames were sent before asking');
    await page.getByRole('button', { name: 'What am I looking at?' }).click();
    await page.getByText('A green test card.').waitFor({ timeout: 8000 });
    expect(JSON.stringify(state.visionFrames) === '[1]', `expected one frame, got ${JSON.stringify(state.visionFrames)}`);
    await page.getByRole('button', { name: 'Turn camera off' }).click();
    await page.getByRole('button', { name: 'Turn camera on' }).waitFor();
    expect((await page.locator('video').evaluate((v) => v.srcObject)) === null, 'stream not released');
  });

  await check('Touch gestures: swipe right = next module, swipe down = minimize, button restores', async () => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
    const swipe = async (x0, y0, x1, y1) => {
      await touch('touchStart', [[x0, y0]]);
      for (let i = 1; i <= 4; i++) await touch('touchMove', [[x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4]]);
      await touch('touchEnd', []);
      await page.waitForTimeout(300);
    };
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.getByRole('navigation', { name: 'Modules, left' }).waitFor();
    await swipe(60, 330, 300, 330);
    await page.waitForURL('**/m/hologram', { timeout: 5000 });
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.getByRole('navigation', { name: 'Modules, left' }).waitFor();
    await swipe(195, 250, 195, 520);
    await page.getByRole('button', { name: 'Restore the dashboard' }).click({ timeout: 5000 });
    await page.getByRole('navigation', { name: 'Modules, left' }).waitFor({ timeout: 5000 });
    await cdp.detach();
  });

  await check('Calibration: changes are a draft until saved, then persist; reset needs two taps', async () => {
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('hell-gestures-v1') || '{}'));
    await page.goto(`${base}/m/calibration`, { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: 'Left-handed' }).click();
    await page.getByText('Unsaved changes').waitFor();
    expect((await stored()).hand !== 'left', 'saved before tapping Save');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('hell-gestures-v1') || '{}').hand === 'left');
    await page.reload({ waitUntil: 'networkidle' });
    expect((await page.getByRole('radio', { name: 'Left-handed' }).getAttribute('aria-checked')) === 'true', 'not persisted');
    await page.getByRole('button', { name: 'Reset calibration' }).click();
    expect((await stored()).hand === 'left', 'one tap reset it');
    await page.getByRole('button', { name: 'Tap again to reset calibration' }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('hell-gestures-v1') || '{}').hand === 'right');
  });

  await check('Hand gestures: on-device model loads from this server, camera off releases it', async () => {
    const outside = [];
    const onReq = (r) => {
      const u = r.url();
      if (!u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:')) outside.push(u);
    };
    page.on('request', onReq);
    await ctx.grantPermissions(['camera'], { origin: base });
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Camera hand gestures off' }).click();
    await page.locator('.hand-panel[data-status=on]').waitFor({ timeout: 60000 });
    await page.getByText('Show a hand').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Turn hand gestures off' }).click();
    await page.locator('.hand-panel').waitFor({ state: 'detached', timeout: 5000 });
    const live = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length);
    page.off('request', onReq);
    expect(live === 0, 'camera still in use after turning hand gestures off');
    expect(outside.length === 0, `requests left this server: ${outside.join(', ')}`);
  });

  await check('Voice settings: chosen voice + speed reach the server; device recognition is opt-in', async () => {
    await page.goto(`${base}/m/voice`, { waitUntil: 'networkidle' });
    const allow = page.getByLabel('Allow iPhone speech recognition');
    if (await allow.isEnabled()) expect(!(await allow.isChecked()), 'device recognition should default to off');
    expect(await page.getByLabel(/Listen for/).isDisabled(), 'wake phrase must need recognition first');
    await page.getByRole('radio', { name: 'HELL server' }).first().click();
    await page.locator('label.cal-assign select').first().selectOption('bm_george');
    await page.locator('input[type=range]').first().fill('1.25');
    await page.getByRole('button', { name: 'Preview voice' }).click();
    await page.waitForFunction(() => true);
    const t0 = Date.now();
    while (!state.synth.length && Date.now() - t0 < 8000) await page.waitForTimeout(100);
    const got = state.synth[0];
    expect(got && got.voice_id === 'bm_george' && got.speed === 1.25, `preview sent ${JSON.stringify(got)}`);
  });

  await check('Memory: learned facts wait for approval; Approve sends exactly that fact', async () => {
    await page.goto(`${base}/m/memory`, { waitUntil: 'networkidle' });
    await page.getByText(/Waiting for your approval \(1\)/).waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: 'Approve "User prefers dark mode"' }).click();
    await page.getByText('Approved — HELL may use it now').waitFor({ timeout: 5000 });
    expect(state.approved && state.approved.index === 1 && state.approved.text === 'User prefers dark mode', `approve sent ${JSON.stringify(state.approved)}`);
    expect((await page.getByText(/Waiting for your approval/).count()) === 0, 'pending list did not refresh');
  });

  await check('Diagnostics: all nine checks render, even with a partial server reply', async () => {
    await page.goto(`${base}/m/diagnostics`, { waitUntil: 'networkidle' });
    await page.locator('.dg-row').nth(8).waitFor({ timeout: 10000 });
    const titles = await page.locator('.dg-title').allTextContents();
    expect(titles.length === 9, `got ${titles.length} checks: ${titles.join(', ')}`);
    expect(titles.includes('Gesture recognition') && titles.includes('Rendering performance'), titles.join(', '));
  });

  await check('Files: send a file, add it to memory; Apps: add a Shortcuts button', async () => {
    await page.goto(`${base}/m/files`, { waitUntil: 'networkidle' });
    await page.locator('#files-pick').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.getByText('File sent to HELL').waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: 'Add to memory' }).click();
    await page.getByText('In memory').waitFor({ timeout: 8000 });
    await page.goto(`${base}/m/apps`, { waitUntil: 'networkidle' });
    await page.getByLabel(/Shortcut name/).fill('Lights Off');
    await page.getByRole('button', { name: 'Add button' }).click();
    await page.getByRole('button', { name: 'Run shortcut Lights Off' }).waitFor({ timeout: 5000 });
  });

  await check('Settings: brightness dims HELL, animation can be turned off, sliders are named', async () => {
    await page.goto(`${base}/m/settings`, { waitUntil: 'networkidle' });
    await page.getByRole('slider', { name: 'Interface brightness' }).fill('0.6');
    const dim = await page.locator('.jm-dimmer').evaluate((e) => getComputedStyle(e).opacity);
    expect(dim === '0.4', `dimmer opacity ${dim}`);
    await page.getByRole('radio', { name: 'Off' }).click();
    expect((await page.evaluate(() => document.documentElement.dataset.anim)) === 'off', 'animation not off');
    await page.getByRole('button', { name: /Reset appearance/ }).click();
    const unnamed = await page.locator('input[type=range]:not([aria-label]):not([id])').count();
    expect(unnamed === 0, `${unnamed} unnamed slider(s)`);
  });

  await check('Desktop app at / still renders', async () => {
    const desk = await ctx.newPage();
    await desk.setViewportSize({ width: 1280, height: 800 });
    await desk.route('**/*', fakeServer(freshState()));
    await desk.goto(`${base}/`, { waitUntil: 'networkidle' });
    await desk.locator('textarea').first().waitFor({ timeout: 10000 });
    await desk.close();
  });

  await check('No JavaScript errors during the run', async () => {
    expect(errors.length === 0, errors.slice(0, 3).join(' | '));
  });
  await ctx.close();
}

{
  const state = { ...freshState(), speech: true, heard: 'HELL, build me a 3D rotating planet' };
  const { ctx, page, errors } = await newPage(state, { ...IPHONE_12_APP, permissions: ['microphone'] });
  await check('Dashboard voice: "build me a 3D rotating planet" opens the builder and builds it', async () => {
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.locator('.hd-dock').getByRole('button', { name: 'Talk to HELL' }).click();
    await page.getByRole('button', { name: 'Stop and send' }).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await page.waitForURL('**/m/hologram', { timeout: 8000 });
    await page.getByText('Created a rotating planet.').waitFor({ timeout: 15000 });
  });
  await check('Dashboard voice: ordinary requests still go to chat', async () => {
    state.heard = 'what is on my schedule';
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.locator('.hd-dock').getByRole('button', { name: 'Talk to HELL' }).click();
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await page.waitForURL('**/m/chat', { timeout: 8000 });
    await page.getByText('Systems online.').waitFor({ timeout: 10000 });
    expect(errors.length === 0, errors.slice(0, 3).join(' | '));
  });
  await ctx.close();
}

{
  const state = freshState();
  state.authRequired = true;
  const { ctx, page, errors } = await newPage(state);
  await check('Sign-in: wrong passcode refused, right one unlocks HELL', async () => {
    await page.goto(`${base}/m`, { waitUntil: 'networkidle' });
    await page.getByText('Welcome back').waitFor();
    await page.getByLabel('Passcode').fill('nope');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByText('Wrong passcode').waitFor();
    await page.getByLabel('Passcode').fill('correct horse');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.locator('.hd').waitFor({ timeout: 10000 });
    expect(errors.length === 0, errors.slice(0, 3).join(' | '));
  });
  await ctx.close();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}.`);
process.exit(failed.length ? 1 : 0);
