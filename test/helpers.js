import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function fixture(t, { whisperDelay = 0, recorderExit, transcript = "Hello local Whisper." } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "whisper-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const modelPath = path.join(dir, "model with spaces.bin");
  const recorderPath = path.join(dir, "fake recorder");
  const whisperPath = path.join(dir, "fake whisper");
  const readyFile = path.join(dir, "recorder-ready");
  await writeFile(modelPath, "test model");
  const shebang = `#!${process.execPath}\n`;
  await writeFile(recorderPath, shebang + `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const wav = args[args.indexOf('trim') - 1];
    fs.writeFileSync(wav, Buffer.alloc(32044));
    process.on('SIGINT', () => process.exit(0));
    fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
    ${recorderExit === undefined ? "setInterval(() => {}, 1000);" : `setTimeout(() => { process.stderr.write('microphone denied'); process.exit(${recorderExit}); }, 25);`}
  `, { mode: 0o700 });
  await writeFile(whisperPath, shebang + `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    setTimeout(() => fs.writeFileSync(args[args.indexOf('-of') + 1] + '.txt', ${JSON.stringify(transcript)}), ${whisperDelay});
  `, { mode: 0o700 });
  return { dir, modelPath, recorderPath, whisperPath, tempDir: dir, readyFile };
}

export async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test state");
    await delay(10);
  }
}

export function mockContext(options = {}) {
  const state = {};
  const calls = { commands: [], toasts: [], pastes: [], dialogs: [] };
  const context = {
    options,
    app: { version: "2.1.4" },
    storage: { memory(_key, { initial }) { Object.assign(state, initial); return [state, (fn) => fn(state)]; } },
    keymap: { layer(fn) { calls.commands.push(...fn().commands); }, mode: { current: () => "base" } },
    renderer: {
      currentFocusedEditor: {},
      keyInput: { processPaste(bytes) { calls.pastes.push(new TextDecoder().decode(bytes)); } },
    },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "original" }) },
      toast: { show(toast) { calls.toasts.push(toast); } },
      dialog: { async alert(options) { calls.dialogs.push(options); } },
    },
  };
  return { context, calls, state, command: (id) => calls.commands.find((c) => c.id === `whisper.${id}`).run() };
}
