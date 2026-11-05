# HELL on iPhone

**HELL — Phase 6** is the iPhone app built into this server, at **`/m`**: a
voice-first assistant with a 3D particle orb, a holographic dashboard, a
hologram builder, camera vision, touch and hand gestures, approved long-term
memory and diagnostics. You install it from Safari ("Add to Home Screen").

Your iPhone is the screen, camera and microphone. The AI, your memory, tasks,
notes and files stay on the computer that runs `jarvis serve`. This guide
connects the two securely.

```
iPhone (Safari / home-screen app)
   │  HTTPS (Tailscale)
   ▼
Your computer: jarvis serve  ──▶  local models (Ollama, …)
                 └─ memory, tasks, notes & files on disk
```

## What you need

- A Mac, Linux or WSL2 machine with OpenJarvis installed
  ([Installation](../getting-started/installation.md)) and a model that answers
  in `jarvis` chat.
- An iPhone running a recent iOS.
- A free [Tailscale](https://tailscale.com) account. Tailscale gives the
  phone a private, encrypted HTTPS link to your computer without opening any
  ports to the internet.

!!! warning "HTTPS is required"
    Safari only allows the microphone, and only installs the app properly,
    on HTTPS pages. Plain `http://192.168…` addresses on your Wi-Fi will load,
    but voice input will not work.

## 1. Protect the server with a key and a passcode

Create an API key. The command saves it in `~/.openjarvis/config.toml`:

```bash
jarvis auth create-key
```

Choose a **passcode** for the phone: at least 8 characters, and easier to
type than the key. Start the server with it:

```bash
OPENJARVIS_PASSCODE='pick a long passphrase' jarvis serve
```

Leave the server on its default address (`127.0.0.1`). Tailscale connects to
it locally, so it never needs to listen on your network.

If you don't set `OPENJARVIS_PASSCODE`, the phone asks for the API key
instead. A passcode shorter than 8 characters is ignored, and the server
logs a warning when that happens.

??? info "Running from a source checkout?"
    `jarvis serve` serves the web app from `src/openjarvis/server/static/`.
    Build it once, and again after updating:

    ```bash
    cd frontend && npm ci && npm run build
    ```

## 2. Turn on voice (optional, recommended)

For private voice input, the server needs a speech-to-text backend; for
HELL's own voice, a text-to-speech backend. Without them HELL can use the
iPhone's built-in voices, and (if you allow it) the iPhone's speech
recognition — see [Voice](#voice).

```bash
uv sync --extra desktop --extra voice   # faster-whisper + Kokoro, both local
```

Then check `~/.openjarvis/config.toml`. These are the defaults:

```toml
[speech]
backend = "auto"          # faster-whisper locally; or "openai", "deepgram"
tts_backend = "kokoro"    # or "openai_tts", "cartesia", "elevenlabs"
voice_id = "bm_george"    # Kokoro British male; bf_emma for British female
```

Cloud speech backends read their API keys **on the server**. The phone never
sees them.

To let HELL learn facts about you from your chats, you can also turn
learning on in the app (**Memory → Ask me first**). To enable it from the
config instead:

```toml
[memory]
enabled = true
```

Restart `jarvis serve` after changing the config.

## 3. Reach your computer over HTTPS with Tailscale

1. Install Tailscale on the computer and on the iPhone, and sign both into the
   **same** account.
2. In the Tailscale admin console, open **DNS** and enable **MagicDNS** and
   **HTTPS Certificates**.
3. On the computer, publish the HELL server to your tailnet (port `8000` is
   the `jarvis serve` default):

    ```bash
    tailscale serve --bg 8000
    ```

    It prints your address, for example
    `https://my-mac.tail1234.ts.net`. Only devices signed into your
    Tailscale account can open it.

4. On the iPhone, make sure the Tailscale app shows **Connected**.

!!! danger "Avoid public exposure"
    `tailscale funnel` and public tunnels put HELL on the open internet,
    where it would be protected only by your passcode. Use `tailscale serve`,
    which is private to your devices, unless you really need public access.

## 4. Install the app on your iPhone

1. In **Safari**, open `https://<your-machine>.<your-tailnet>.ts.net/m`.
2. Enter your passcode and tap **Unlock**. iOS offers to save it in
   Passwords.
3. Tap **Share** → **Add to Home Screen** → **Add**.

The HELL icon now opens full screen, straight into the mobile app.

The first time you tap the orb or the mic, iOS asks for microphone access.
Tap **Allow**.

## Using HELL

The dashboard shows the orb in the middle with twelve modules around it.
Tap the orb to activate HELL, **double tap** it (or the mic) to talk, and
**long press** it to change its look.

| Module | What it does |
|---|---|
| **Hologram Builder** | Build your own 3D holographic interfaces: drag, resize, recolour, align, save layouts — or say *"HELL, build me a rotating planet"*. |
| **Vision** | Point the camera and ask: *"What am I looking at?"*, *"Read this sign"*, *"What do I need to press?"*. One photo is sent per question; nothing is streamed. |
| **Gestures** | Touch gestures (swipes, pinches, double tap, long press) and camera hand gestures (open palm, fist, thumbs up/down, two fingers). |
| **Calibration** | Teach HELL how you swipe, tune sensitivity and speed, left/right-handed mode, choose what each gesture does, test live. |
| **Memory** | What HELL knows: approve or forget learned facts, teach it things, search memories and past chats, turn memory off, clear it. |
| **Tasks** / **Notes** | Tasks with due dates and priorities; notes with search and pinning. |
| **Apps** | HELL's tools in one place, plus buttons that run your **iOS Shortcuts** (*"HELL, run shortcut Lights Off"*). |
| **Files** | Send files from the iPhone to your server; add documents to HELL's memory so it can answer questions about them. |
| **Diagnostics** | Checks microphone, camera, internet, AI service, voice, memory, gestures, rendering and errors, with fixes for each. |
| **Settings** | Orb, interface brightness, glow, animation intensity, voice, gesture sensitivity, permissions. |
| **AI Modules** | Models, agents and skills on your server. |

### Touch gestures (dashboard)

| Gesture | Does |
|---|---|
| Swipe up | Open HELL (chat), or restore the minimised dashboard |
| Swipe down / pinch in | Minimise to just the orb |
| Swipe left / right | Previous / next module (also on module screens) |
| Double tap | Start listening |
| Long press (empty space) | Settings |
| Pinch out | Show your hologram full screen (pinch in to come back) |

Swipes starting at the very top or bottom edge are ignored (iOS uses them).
Change any of this in **Calibration**.

### Voice

- **Talking:** tap the mic, double tap, or show an open palm (Hands on). HELL
  stops listening by itself when you pause, and with **Continue the
  conversation** it listens again for a follow-up after answering.
- **Interrupt:** tap the mic (or double tap / open palm) while HELL speaks.
- **Its voice:** your server's voice (Kokoro: free and local) or the
  iPhone's built-in voices; pick a voice and speed in **Settings → Voice**.
- **"Hey HELL":** optional, needs *Allow iPhone speech recognition*. Works only
  while HELL is open on screen.

## What works on iPhone — and what iOS doesn't allow

| Feature | On iPhone |
|---|---|
| Orb, dashboard, builder, gestures, calibration | ✅ Full |
| Voice in and out | ✅ Full (with the server's transcriber and voice, or the iPhone's own) |
| Camera Vision | ✅ With a vision model on the server (e.g. `ollama pull qwen2.5vl:7b`) |
| Camera hand gestures | ✅ Runs on the phone (a recent iOS, 16.4 or later, is recommended). Speed depends on the iPhone. |
| "Hey HELL" wake phrase | ⚠️ Only while HELL is open and the screen is on. iOS gives web apps no background or lock-screen listening. |
| Hand gestures / camera in the background | ❌ iOS stops the camera when HELL is not on screen (HELL turns it off too). |
| Notifications, widgets, Siri | ❌ Not used. |
| Running iOS Shortcuts | ⚠️ HELL opens the Shortcuts app to run them; iOS may ask to confirm; HELL can't see their results. |
| Desktop app (**Settings → Full settings**) | ⚠️ Opens, but is designed for a computer screen. |

## Privacy: what leaves your iPhone

| Data | Goes to |
|---|---|
| Your questions, voice recordings, Vision photos, files | **Your HELL server only** |
| Camera frames for hand gestures | **Nowhere** — processed on the phone, never uploaded |
| iPhone speech recognition (only if you allow it) | Apple's speech service |
| Weather (only if you set it up) | Open-Meteo, via your server, location rounded to ~1 km |

HELL's own copy of the open-source hand-gesture model (MediaPipe, Apache-2.0)
is served by your server; its built-in usage reporting to Google is blocked.
Memory never stores passwords, keys or card numbers; personal details wait
for your approval.

## Security notes

- **No secrets on the phone.** A correct passcode gets an `HttpOnly`,
  `SameSite=Strict` session cookie. Page code cannot read it, and the
  browser never sends it to other sites. It holds a signed, expiring token,
  not your API key.
- **Sessions last 30 days.** Sign out under **Settings → More**.
- **Sign out every device** by rotating the key: run
  `jarvis auth create-key` again and restart the server.
- **Brute force is throttled.** After 5 wrong passcodes, that device waits
  10 minutes. The server also caps failures across all devices.
- **Scripts keep working.** `Authorization: Bearer <key>` is accepted
  exactly as before.

## Where your data lives

On the computer, in your OpenJarvis folder (`~/.openjarvis`, or
`$OPENJARVIS_HOME`):

| File | Contents |
|---|---|
| `personal.db` | Tasks, notes and saved hologram layouts (owner-only permissions) |
| `memory.db` | Saved memories, and files you added to memory |
| `memory_facts.jsonl` | Facts HELL learned (including those waiting for approval) |
| `memory_prefs.json` | Memory settings (learning mode, use in replies) |
| `files/` | Files you sent from the iPhone |

On the iPhone (Safari's storage for the HELL address): chat history, the
current hologram draft, and your settings (orb, voice, gestures, appearance,
Shortcuts buttons).

## Speed and battery

- HELL downloads about 0.4 MB to start (compressed) and caches it; screens
  load as you open them.
- Camera, hand tracking and the wake phrase run only while you use them, and
  stop when HELL leaves the screen. Hand gestures turn off after 90 s without
  a hand.
- For longer battery life: **Settings → Animation intensity → Calm** (or
  Off) and a lower particle density under **Settings → Orb**. If animations
  stutter, check **Diagnostics → Rendering performance** (Low Power Mode also
  slows them).

## Troubleshooting

Start with **Diagnostics** — it checks everything below and says how to fix it.

| Symptom | Fix |
|---|---|
| Red dot / "Offline" | Check that Tailscale says Connected on the phone and that `jarvis serve` is running. |
| Mic or camera does nothing | Use the `https://…ts.net` address, not `http://`. Check *Settings → Safari → Microphone / Camera*. |
| Voice says it can't listen | Install a transcriber on the server (`uv sync --extra voice`) or allow iPhone speech recognition in **Settings → Voice**. |
| Replies aren't spoken | Check **Settings → Voice → Speak replies aloud**. Tap the screen once after opening the app; iOS only allows audio after a tap. |
| Vision says the model can't see | Install a vision model: `ollama pull qwen2.5vl:7b`, then pick it in Vision. |
| Hand gestures: "model is not installed" | Rebuild the app once with internet access (`cd frontend && npm run build`); it downloads the 8 MB model. |
| Memory facts never appear | Learning is off: **Memory → Ask me first** (needs a model on the server). |
| "Wrong passcode" | Make sure it matches `OPENJARVIS_PASSCODE` on the server, or the API key if no passcode is set. |
| "Too many attempts" | Wait for the countdown (up to 10 minutes). |
| Signed out unexpectedly | The API key changed, or 30 days passed. Enter the passcode again. |
