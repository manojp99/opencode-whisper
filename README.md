# OpenCode Whisper Local

Local voice dictation for **OpenCode V2**, powered by **whisper.cpp**. No API keys,
cloud transcription, Python environment, runtime npm dependencies, or LLM cleanup.

Press **F4** to record, speak, and press **F4** again. Your transcript is inserted
into the prompt for review. **Nothing is sent until you press Enter.** F5 cancels.

## Compatibility

- Targets **OpenCode 2.1.4** and its native `{ id, setup(context) }` CLI plugin API.
- Uses `context.keymap.layer`, `context.storage.memory`, `context.ui.toast.show`,
  and OpenTUI's public `renderer.keyInput.processPaste()` input pipeline.
- No V1 `tui()` entrypoint, `api.kv`, `client.tui`, private host imports, or bundled
  OpenCode/OpenTUI/Solid copies. V1 is intentionally unsupported.
- macOS (CoreAudio) and Linux (SoX / PulseAudio recording). Windows is not supported.
  Linux capture should be tested on your own audio setup.
- This is a CLI/TUI plugin, not a web or desktop voice extension. Capture and
  transcription run on the CLI machine, even when connected to a remote server.
- Newer V2 releases are capability-checked, not assumed tested.

## 1. Install native tools

On macOS with a current Homebrew installation:

```sh
brew install whisper-cpp sox
```

Alternatively, build whisper.cpp from source (also works on Linux with a C++
compiler and CMake installed):

```sh
git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git ~/repos/whisper.cpp
cmake -S ~/repos/whisper.cpp -B ~/repos/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF
cmake --build ~/repos/whisper.cpp/build --config Release -j 4 --target whisper-cli
```

Set `whisperPath` below to the built `build/bin/whisper-cli` executable if it is
not on PATH. Apple Silicon builds normally enable Metal automatically.

On Linux, install SoX with the input driver for your audio system, for example
`sudo apt install sox libsox-fmt-pulse`. An existing FFmpeg installation can also
record instead; see the options table.

## 2. Download a Whisper model

Clone this plugin, then run the explicit, checksum-verified download helper with
**Node 20 or newer**. The plugin itself does not need a separate Node installation.

```sh
git clone https://github.com/manojp99/opencode-whisper.git ~/repos/opencode-whisper
cd ~/repos/opencode-whisper
node scripts/download-model.js
```

This downloads the English-only `base.en` model (~148 MB) to
`~/.local/share/whisper-cpp/ggml-base.en.bin`. It uses a pinned upstream revision
and verifies SHA-256 before activation. You may pass a different **destination**
as the first argument. Existing files with an unexpected checksum are not replaced.

For multilingual speech, download a multilingual whisper.cpp model yourself,
point `modelPath` at it, and set `language` to `auto` or a language code such as
`te` or `hi`. English-only `.en` models cannot transcribe other languages.

## 3. Enable the V2 CLI plugin

Merge this into **`~/.config/opencode/cli.json`** (or
`$XDG_CONFIG_HOME/opencode/cli.json`). Preserve your other settings:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/repos/opencode-whisper",
      "options": {
        "modelPath": "~/.local/share/whisper-cpp/ggml-base.en.bin",
        "language": "en"
      }
    }
  ]
}
```

**Use a directory path**, not a path to `tui.js`. V2 discovers the package's
`./tui` export. Do not use V1 `tui.json` / `plugin` configuration.

OpenCode watches CLI configuration changes. Use `/reload` if needed. Run
`/voice-status` to confirm loading and the model path. Grant microphone permission
to the terminal running OpenCode in **System Settings → Privacy & Security →
Microphone** on macOS. Recording starts only when you explicitly request it.

## Commands

| Command | Default shortcut | Action |
| --- | --- | --- |
| `/voice` | F4 | Start recording, or stop and transcribe |
| `/voice-cancel` | F5 | Cancel capture/transcription and delete temporary files |
| `/voice-last` | — | Insert the last transcript into the currently focused prompt |
| `/voice-status` | — | Show configuration and model availability |

F4 and F5 leave Ctrl+R (session rename) untouched. On some Macs, use **Fn+F4** /
**Fn+F5**, or change the keys in the options. Escape retains OpenCode's usual
interrupt behavior. No push-to-talk or automatic sending in this release.

Keep the original chat prompt focused while transcribing. If you switch sessions
or focus a dialog, the transcript is retained **in memory**, not pasted into the
wrong place. Return to a prompt and run `/voice-last`. The last transcript is lost
when the TUI exits; it is not written to plugin storage or logs.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `modelPath` | `~/.local/share/whisper-cpp/ggml-base.en.bin` | Local GGML model |
| `whisperPath` | `whisper-cli` | Executable name or absolute path |
| `recorder` | `sox` | `sox` or `ffmpeg` |
| `recorderPath` | `sox` | Executable name/path; set to `ffmpeg` when using FFmpeg |
| `audioDevice` | System default / FFmpeg `:0` on macOS | Explicit input device |
| `language` | `en` | Whisper language code or `auto` |
| `recordKey` | `f4` | Shortcut; `false` disables it |
| `cancelKey` | `f5` | Shortcut; `false` disables it |
| `maxSeconds` | `120` | Maximum recording duration (1–3600); then transcribes |
| `transcriptionTimeoutSeconds` | `180` | Kill a hung transcription after this limit |
| `threads` | Up to 4 CPU threads | Whisper CPU thread count |
| `tempDir` | OS temporary directory | Existing writable parent directory |

Example using FFmpeg already installed on macOS:

```json
{
  "recorder": "ffmpeg",
  "recorderPath": "/absolute/path/to/ffmpeg",
  "audioDevice": ":0"
}
```

To enumerate macOS FFmpeg input devices, run
`ffmpeg -f avfoundation -list_devices true -i ""` in your own terminal. Device
listing normally exits non-zero. Set `audioDevice` to `:<audio-index>`.

## Privacy and safety

- Audio is recorded as 16 kHz mono PCM in a random private temporary directory.
- whisper.cpp runs locally. The plugin makes **no network requests**. Model
  download is a separate, opt-in script.
- Temporary audio and transcript files are deleted on success, failure, cancel,
  and plugin unload. A hard kill, power loss, or OS crash can leave a temporary
  `opencode-whisper-*` directory; review and remove only those stale directories.
- The transcript enters the normal OpenCode prompt paste path. It is sent to
  your configured coding model **only when you submit it yourself**.
- No shell is used to invoke native tools; paths and device names are separate
  arguments. Recording is bounded, and stuck processes are terminated.
- No clipboard access, global key remapping, or automatic native-tool installation.
- Whisper can hallucinate, especially on silence: always review the text.

## Development and publishing

Requires Node 20+ for the supported test workflow; no `npm install` needed.

```sh
npm run check
npm pack --dry-run
```

Tests cover option validation, native process execution, recording/transcription
lifecycle, cancellation, temporary-file cleanup, V2 registration, and focus/session
guards. CI runs on macOS and Linux with Node 20 and 22. Unit tests use fake native
tools and do not access your microphone or download models.

For an opt-in smoke test against your installed OpenCode (no microphone access):

```sh
python3 scripts/smoke-tui.py
```

To exercise transcription and prompt insertion with a prerecorded WAV as well:

```sh
python3 scripts/smoke-tui.py --sample /path/to/sample.wav --whisper /path/to/whisper-cli --model /path/to/model.bin
```

This launches a separate TUI in a pseudo-terminal and never submits a chat prompt.
`--plugin-dir /path/to/extracted/package` tests an npm tarball's contents. Generated
captures and the sample-recorder shim live in ignored `.local/` only.

### Local verification

Verified on macOS / Apple M1 with **OpenCode 2.1.4**, **OpenTUI 0.6.8**, and
**whisper.cpp v1.9.5** using `base.en`: native Metal transcription of the upstream
JFK sample, real-TUI `/voice-status` registration, and transcription-to-prompt
insertion without submission. Live microphone permissions/capture still need a
manual check in the user's terminal.

The package is prepared for public npm publishing as `opencode-whisper-local`;
availability/ownership must be checked before publishing. A public GitHub repo
does **not** automatically publish an npm package. After reviewing the package
contents and authenticating with npm, maintainers can run `npm publish --access public`.

MIT licensed. Independent community plugin, not affiliated with OpenCode or whisper.cpp.
