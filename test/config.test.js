import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import { captureArgs, expandHome, resolveConfig, whisperArgs } from "../lib/config.js";
import { normalizeTranscript } from "../lib/dictation.js";

test("defaults are local, review-before-send, and use non-conflicting keys", () => {
  const config = resolveConfig();
  assert.equal(config.recordKey, "f4");
  assert.equal(config.cancelKey, "f5");
  assert.equal(config.language, "en");
  assert.ok(config.modelPath.startsWith(os.homedir()));
  assert.equal(config.maxSeconds, 120);
});

test("expands only a leading home shortcut", () => {
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/model.bin"), `${os.homedir()}/model.bin`);
  assert.equal(expandHome("/some/~path"), "/some/~path");
});

test("validates options and allows disabling shortcuts", () => {
  for (const options of [{ maxSeconds: 0 }, { threads: 0 }, { threads: 1.5 }, { recorder: "shell" }, { modelPath: "" }, { language: "$(whoami)" }, { transcriptionTimeoutSeconds: 0 }]) {
    assert.throws(() => resolveConfig(options));
  }
  assert.equal(resolveConfig({ recordKey: false }).recordKey, false);
  assert.equal(resolveConfig({ language: "auto" }).language, "auto");
});

test("SoX produces 16 kHz mono signed PCM and handles device names as arguments", () => {
  const args = captureArgs(resolveConfig({ audioDevice: "Mic; not a shell" }), "/a b.wav", "darwin");
  assert.deepEqual(args.slice(0, 4), ["-q", "-t", "coreaudio", "Mic; not a shell"]);
  assert.ok(args.includes("16000"));
  assert.ok(args.includes("/a b.wav"));
});

test("ffmpeg selects CoreAudio on macOS and PulseAudio on Linux", () => {
  const config = resolveConfig({ recorder: "ffmpeg", recorderPath: "ffmpeg" });
  assert.ok(captureArgs(config, "a.wav", "darwin").includes("avfoundation"));
  assert.ok(captureArgs(config, "a.wav", "linux").includes("pulse"));
  assert.throws(() => captureArgs(config, "a.wav", "win32"), /not supported/);
});

test("whisper flags preserve paths and produce a separate text output file", () => {
  const config = resolveConfig({ modelPath: "/model with spaces.bin" });
  const args = whisperArgs(config, "/audio file.wav", "/output prefix");
  assert.equal(args[args.indexOf("-m") + 1], "/model with spaces.bin");
  assert.equal(args[args.indexOf("-of") + 1], "/output prefix");
  assert.ok(args.includes("-otxt"));
});

test("normalizes whitespace and strips terminal control sequences", () => {
  assert.equal(normalizeTranscript("\u001b[31mHello\u001b[0m\n world.\0"), "Hello world.");
});
