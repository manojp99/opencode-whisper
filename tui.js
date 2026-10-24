import { access } from "node:fs/promises";
import { resolveConfig } from "./lib/config.js";
import { Dictation } from "./lib/dictation.js";

export const ID = "opencode-whisper-local";

export function assertCompatible(context) {
  if (!/^2\./.test(context.app.version.replace(/^v/, ""))) throw new Error("opencode-whisper-local requires OpenCode V2 (tested on 2.1.4).");
  if (!context.keymap?.layer || !context.keymap?.mode?.current || !context.renderer?.keyInput?.processPaste || !context.storage?.memory || !context.ui?.toast?.show) {
    throw new Error("This OpenCode build does not expose the required V2 CLI/OpenTUI APIs.");
  }
}

function routeKey(context) {
  const route = context.ui.router.current();
  return route.type === "session" ? `session:${route.sessionID}` : route.type === "home" ? "home" : null;
}

// Plain { id, setup } is the V2 plugin contract; no bundled OpenCode/OpenTUI copy.
export default {
  id: ID,
  setup(context) {
    assertCompatible(context);
    const config = resolveConfig(context.options);
    const [state, update] = context.storage.memory("runtime", { initial: { phase: "idle", lastTranscript: "" } });
    update((draft) => { draft.phase = "idle"; });
    const toast = (message, variant = "info") => context.ui.toast.show({ title: "Whisper voice", message, variant });
    let origin;
    let disposed = false;

    const insert = (text, target) => {
      if (!target || target.route !== routeKey(context) || !target.editor || target.editor !== context.renderer.currentFocusedEditor || context.keymap.mode.current() !== "base") {
        toast("Transcript retained. Focus your original prompt and run /voice-last to insert it.", "warning");
        return;
      }
      // Go through the normal paste pipeline (attachments/extmarks stay intact).
      // Never manipulate host renderable internals or overwrite the clipboard.
      context.renderer.keyInput.processPaste(new TextEncoder().encode(`${text} `));
      toast("Transcript inserted. Review it, then press Enter to send.", "success");
    };
    const target = () => ({ route: routeKey(context), editor: context.keymap.mode.current() === "base" ? context.renderer.currentFocusedEditor : null });

    const runtime = new Dictation(config, {
      state(phase) {
        if (disposed) return;
        update((draft) => { draft.phase = phase; });
        if (phase === "recording") toast(`Recording (up to ${config.maxSeconds}s). ${config.recordKey || "/voice"} to stop; ${config.cancelKey || "/voice-cancel"} to cancel.`);
        if (phase === "transcribing") toast("Transcribing locally with whisper.cpp…");
      },
      transcript(text) {
        if (disposed) return;
        update((draft) => { draft.lastTranscript = text; });
        insert(text, origin);
      },
      error(error) { if (!disposed) toast(error.message, "error"); },
    });

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "whisper.record", title: "Voice: record / transcribe", group: "Voice",
          palette: true, slash: { name: "voice" }, bind: config.recordKey,
          run() {
            if (state.phase === "transcribing" || state.phase === "preparing") { toast("Voice is busy. Use /voice-cancel to cancel."); return; }
            if (runtime.active) { runtime.stop(); return; }
            origin = target();
            if (!origin.route || !origin.editor) { toast("Focus the chat prompt before recording.", "warning"); return; }
            void runtime.start();
          },
        },
        {
          id: "whisper.cancel", title: "Voice: cancel", group: "Voice",
          palette: true, slash: { name: "voice-cancel" }, bind: config.cancelKey,
          run: async () => { if (!runtime.active) return; await runtime.cancel(); if (!disposed) toast("Recording/transcription cancelled."); },
        },
        {
          id: "whisper.last", title: "Voice: insert last transcript", group: "Voice",
          palette: true, slash: { name: "voice-last" },
          run() {
            if (!state.lastTranscript) { toast("No transcript yet."); return; }
            insert(state.lastTranscript, target());
          },
        },
        {
          id: "whisper.status", title: "Voice: status / setup", group: "Voice",
          palette: true, slash: { name: "voice-status" },
          run: async () => {
            const modelAvailable = await access(config.modelPath).then(() => true, () => false);
            if (disposed) return;
            await context.ui.dialog.alert({ title: "Local Whisper voice", message: [
              `OpenCode: ${context.app.version} (V2 API)`, `State: ${state.phase}`,
              `Model: ${config.modelPath} (${modelAvailable ? "found" : "MISSING"})`,
              `Whisper: ${config.whisperPath}`, `Recorder: ${config.recorderPath} (${config.recorder})`,
              `Language: ${config.language}`, `Record: ${config.recordKey || "slash command only"}; cancel: ${config.cancelKey || "slash command only"}`,
              "", "Audio and transcription stay local. Text is inserted, never auto-submitted.",
              "Grant microphone access to your terminal in macOS System Settings.",
            ].join("\n") });
          },
        },
      ],
      bindings: ["whisper.record", "whisper.cancel"],
    }));

    return async () => {
      disposed = true;
      await runtime.dispose();
      update((draft) => { draft.phase = "idle"; });
    };
  },
};
