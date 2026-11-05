# Jarvis on iPhone

OpenJarvis includes a mobile app at **`/m`**: a voice-first assistant with an
animated orb, chat, memory, tasks and notes. You install it on your iPhone
from Safari ("Add to Home Screen").

Your iPhone is only the screen. The AI, your memory, tasks and notes all stay
on the computer that runs `jarvis serve`. This guide connects the two securely.

```
iPhone (Safari / home-screen app)
   │  HTTPS (Tailscale)
   ▼
Your computer: jarvis serve  ──▶  local models (Ollama, …)
                 └─ memory, tasks & notes on disk
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

The mic button and tap-to-talk orb appear only when the server has a
speech-to-text backend. Spoken replies need a text-to-speech backend.

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

To let Jarvis learn facts about you from your chats, turn on automatic
memory:

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
3. On the computer, publish the Jarvis server to your tailnet (port `8000` is
   the `jarvis serve` default):

    ```bash
    tailscale serve --bg 8000
    ```

    It prints your address, for example
    `https://my-mac.tail1234.ts.net`. Only devices signed into your
    Tailscale account can open it.

4. On the iPhone, make sure the Tailscale app shows **Connected**.

!!! danger "Avoid public exposure"
    `tailscale funnel` and public tunnels put Jarvis on the open internet,
    where it would be protected only by your passcode. Use `tailscale serve`,
    which is private to your devices, unless you really need public access.

## 4. Install the app on your iPhone

1. In **Safari**, open `https://<your-machine>.<your-tailnet>.ts.net/m`.
2. Enter your passcode and tap **Unlock**. iOS offers to save it in
   Passwords.
3. Tap **Share** → **Add to Home Screen** → **Add**.

The Jarvis icon now opens full screen, straight into the mobile app.

The first time you tap the orb or the mic, iOS asks for microphone access.
Tap **Allow**.

## Using Jarvis

| Screen | What it does |
|---|---|
| **Home** | Tap the orb to talk and tap again to send. Shows today's tasks, model and memory at a glance, plus quick actions. |
| **Chat** | Type or talk. Replies stream in and are read aloud. Switch models or start a new chat at the top. |
| **Memory** | **Learned**: facts Jarvis picked up from chats. **Saved**: things you taught it. Filter, add, or delete anything (tap the trash icon, then **Delete**). |
| **Tasks** | Tasks with due dates and priorities, grouped by Overdue / Today / Upcoming / Someday, plus a **Notes** tab with search and pinning. |

The speaker button in the header turns spoken replies on or off. Tapping the
mic while Jarvis is talking interrupts it.

## Security notes

- **No secrets on the phone.** A correct passcode gets an `HttpOnly`,
  `SameSite=Strict` session cookie. Page code cannot read it, and the
  browser never sends it to other sites. It holds a signed, expiring token,
  not your API key.
- **Sessions last 30 days.** Sign out from the bottom of the Home screen.
- **Sign out every device** by rotating the key: run
  `jarvis auth create-key` again and restart the server.
- **Brute force is throttled.** After 5 wrong passcodes, that device waits
  10 minutes. The server also caps failures across all devices.
- **Scripts keep working.** `Authorization: Bearer <key>` is accepted
  exactly as before.

## Where your data lives

Everything stays in your OpenJarvis folder (`~/.openjarvis`, or
`$OPENJARVIS_HOME`) on the computer:

| File | Contents |
|---|---|
| `personal.db` | Tasks and notes (owner-only permissions) |
| `memory.db` | Saved memories ("Teach Jarvis something") |
| `memory_facts.jsonl` | Facts learned automatically from chats |

Chat history is kept in Safari's storage on the phone.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red dot / "Offline" | Check that Tailscale says Connected on the phone and that `jarvis serve` is running. |
| No mic button; orb says "Tap to chat" | The server has no speech-to-text backend. See [step 2](#2-turn-on-voice-optional-recommended). |
| Mic button does nothing | Use the `https://…ts.net` address, not `http://`. Check *Settings → Safari → Microphone*. |
| Replies aren't spoken | Check that the speaker button in the header is on and a TTS backend is installed. Tap the screen once after opening the app, since iOS only allows audio after a tap. |
| "Wrong passcode" | Make sure it matches `OPENJARVIS_PASSCODE` on the server, or the API key if no passcode is set. |
| "Too many attempts" | Wait for the countdown (up to 10 minutes). |
| Signed out unexpectedly | The API key changed, or 30 days passed. Enter the passcode again. |
| Learned tab says automatic memory is off | Add `[memory] enabled = true` to the config and restart. |
