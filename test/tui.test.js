import assert from "node:assert/strict";
import test from "node:test";
import plugin, { assertCompatible } from "../tui.js";
import server from "../index.js";
import { fixture, mockContext, until } from "./helpers.js";

test("entrypoints expose the native V2 id/setup contract, not V1 tui", () => {
  assert.equal(server.id, plugin.id);
  assert.equal(typeof plugin.setup, "function");
  assert.equal(plugin.tui, undefined);
});

test("rejects V1 and missing renderer capabilities", () => {
  const { context } = mockContext();
  assert.doesNotThrow(() => assertCompatible(context));
  context.app.version = "1.18.0";
  assert.throws(() => assertCompatible(context), /V2/);
  context.app.version = "2.1.4";
  context.renderer.keyInput = {};
  assert.throws(() => assertCompatible(context), /required V2/);
});

test("registers V2 keymap and slash commands without overriding session rename", async () => {
  const { context, calls, command } = mockContext();
  const dispose = plugin.setup(context);
  assert.deepEqual(calls.commands.map((c) => c.slash.name), ["voice", "voice-cancel", "voice-last", "voice-status"]);
  assert.equal(calls.commands[0].bind, "f4");
  assert.equal(calls.commands[1].bind, "f5");
  await command("status");
  assert.match(calls.dialogs[0].message, /2.1.4/);
  await dispose();
});

test("inserts transcript through paste without ever invoking a server or submitting", async (t) => {
  const f = await fixture(t, { recorderExit: 0 });
  const { context, calls, command, state } = mockContext(f);
  // No client exists in this fake: any accidental server call fails the test.
  const dispose = plugin.setup(context);
  t.after(dispose);
  command("record");
  await until(() => state.lastTranscript !== "" && state.phase === "idle");
  assert.deepEqual(calls.pastes, ["Hello local Whisper. "]);
});

test("route changes retain transcription rather than leaking it into another session", async (t) => {
  const f = await fixture(t, { recorderExit: 0, whisperDelay: 150 });
  const { context, calls, command, state } = mockContext(f);
  const dispose = plugin.setup(context);
  t.after(dispose);
  command("record");
  context.ui.router.current = () => ({ type: "session", sessionID: "different" });
  await until(() => state.lastTranscript !== "" && state.phase === "idle");
  assert.deepEqual(calls.pastes, []);
  command("last");
  assert.deepEqual(calls.pastes, ["Hello local Whisper. "]);
});

test("focus changes never paste into a dialog; transcript can be recovered", async (t) => {
  const f = await fixture(t, { recorderExit: 0 });
  const { context, calls, command, state } = mockContext(f);
  const dispose = plugin.setup(context);
  t.after(dispose);
  command("record");
  context.renderer.currentFocusedEditor = {};
  await until(() => state.lastTranscript !== "" && state.phase === "idle");
  assert.deepEqual(calls.pastes, []);
  assert.match(calls.toasts.at(-1).message, /retained/);
});

test("refuses recording from a non-prompt route or without a focused editor", async () => {
  const { context, calls, command } = mockContext();
  const dispose = plugin.setup(context);
  context.renderer.currentFocusedEditor = null;
  command("record");
  assert.match(calls.toasts.at(-1).message, /Focus the chat prompt/);
  await dispose();
});

test("refuses to start recording while a modal editor is focused", async () => {
  const { context, calls, command } = mockContext();
  const dispose = plugin.setup(context);
  context.keymap.mode.current = () => "modal";
  command("record");
  assert.match(calls.toasts.at(-1).message, /Focus the chat prompt/);
  await dispose();
});
