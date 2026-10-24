import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import test from "node:test";
import { Dictation } from "../lib/dictation.js";
import { resolveConfig } from "../lib/config.js";
import { launch } from "../lib/process.js";
import { fixture, until } from "./helpers.js";

test("records, transcribes, and removes private temporary files", async (t) => {
  const f = await fixture(t);
  const phases = [], transcripts = [], errors = [];
  const runtime = new Dictation(resolveConfig(f), {
    state: (s) => phases.push(s), transcript: (s) => transcripts.push(s), error: (e) => errors.push(e),
  });
  t.after(() => runtime.dispose());
  const done = runtime.start();
  await until(() => phases.includes("recording"));
  await until(() => access(f.readyFile).then(() => true, () => false));
  runtime.stop();
  await done;
  assert.deepEqual(errors, []);
  assert.deepEqual(phases, ["preparing", "recording", "transcribing", "idle"]);
  assert.deepEqual(transcripts, ["Hello local Whisper."]);
  assert.equal(runtime.active, false);
  assert.equal((await readdir(f.dir)).filter((p) => p.startsWith("opencode-whisper-")).length, 0);
});

test("cancelling while preparing suppresses results and cleans up", async (t) => {
  const f = await fixture(t);
  const transcripts = [], errors = [];
  const runtime = new Dictation(resolveConfig(f), { transcript: (s) => transcripts.push(s), error: (e) => errors.push(e) });
  runtime.start();
  await runtime.cancel();
  assert.equal(runtime.active, false);
  assert.deepEqual(transcripts, []);
  assert.deepEqual(errors, []);
});

test("cancelling during transcription kills the child and inserts nothing", async (t) => {
  const f = await fixture(t, { whisperDelay: 10000 });
  let phase;
  const transcripts = [];
  const runtime = new Dictation(resolveConfig(f), { state: (s) => { phase = s; }, transcript: (s) => transcripts.push(s) });
  runtime.start();
  await until(() => phase === "recording");
  await until(() => access(f.readyFile).then(() => true, () => false));
  runtime.stop();
  await until(() => phase === "transcribing");
  await runtime.cancel();
  assert.equal(phase, "idle");
  assert.deepEqual(transcripts, []);
  assert.equal((await readdir(f.dir)).filter((p) => p.startsWith("opencode-whisper-")).length, 0);
});

test("a missing model yields a recoverable error", async (t) => {
  const f = await fixture(t);
  const errors = [];
  const runtime = new Dictation(resolveConfig({ ...f, modelPath: `${f.dir}/missing.bin` }), { error: (e) => errors.push(e) });
  await runtime.start();
  assert.match(errors[0].message, /Cannot read Whisper model/);
  assert.equal(runtime.active, false);
});

test("microphone failures include recorder diagnostics", async (t) => {
  const f = await fixture(t, { recorderExit: 1 });
  const errors = [];
  const runtime = new Dictation(resolveConfig(f), { error: (e) => errors.push(e) });
  await runtime.start();
  assert.match(errors[0].message, /microphone denied/);
  assert.equal(runtime.active, false);
});

test("natural recorder completion also transcribes", async (t) => {
  const f = await fixture(t, { recorderExit: 0 });
  const transcripts = [];
  const runtime = new Dictation(resolveConfig(f), { transcript: (s) => transcripts.push(s) });
  await runtime.start();
  assert.deepEqual(transcripts, ["Hello local Whisper."]);
});

test("duplicate starts cannot launch overlapping recordings", async (t) => {
  const f = await fixture(t);
  const runtime = new Dictation(resolveConfig(f));
  runtime.start();
  assert.equal(runtime.start(), undefined);
  await runtime.dispose();
  assert.throws(() => runtime.start(), /disposed/);
});

test("missing executables reject without an unhandled child-process error", async () => {
  const proc = launch("/nonexistent/whisper-cli", []);
  await assert.rejects(proc.started, /ENOENT/);
  await assert.rejects(proc.done, /Cannot run/);
});

test("blank/silence output is not inserted", async (t) => {
  for (const transcript of ["", "[BLANK_AUDIO]"]) {
    const f = await fixture(t, { recorderExit: 0, transcript });
    const transcripts = [], errors = [];
    const runtime = new Dictation(resolveConfig(f), { transcript: (s) => transcripts.push(s), error: (e) => errors.push(e) });
    await runtime.start();
    assert.deepEqual(transcripts, []);
    assert.match(errors[0].message, /No speech detected/);
  }
});

test("a hung transcription times out and deletes its temporary files", async (t) => {
  const f = await fixture(t, { recorderExit: 0, whisperDelay: 10000 });
  const errors = [];
  const runtime = new Dictation(resolveConfig({ ...f, transcriptionTimeoutSeconds: 1 }), { error: (e) => errors.push(e) });
  t.after(() => runtime.dispose());
  await runtime.start();
  assert.match(errors[0].message, /timed out/);
  assert.equal(runtime.active, false);
  assert.equal((await readdir(f.dir)).filter((p) => p.startsWith("opencode-whisper-")).length, 0);
});
