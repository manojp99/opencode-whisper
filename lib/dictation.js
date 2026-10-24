import { access, chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { captureArgs, whisperArgs } from "./config.js";
import { launch, failure } from "./process.js";

export function normalizeTranscript(text) {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

export async function transcribeFile(config, wav, output, { signal, onProcess = () => {} } = {}) {
  signal?.throwIfAborted();
  const proc = launch(config.whisperPath, whisperArgs(config, wav, output));
  onProcess(proc);
  const abort = () => { void proc.stop().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void proc.stop().catch(() => {}); }, config.transcriptionTimeoutSeconds * 1000);
  timer.unref();
  try {
    await proc.started;
    const result = await proc.done;
    signal?.throwIfAborted();
    if (timedOut) throw new Error("Whisper transcription timed out. Try a smaller model or a longer transcriptionTimeoutSeconds.");
    if (result.code !== 0) throw failure(config.whisperPath, result);
    return normalizeTranscript(await readFile(`${output}.txt`, "utf8"));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await proc.stop().catch(() => {});
  }
}

export class Dictation {
  #job;
  #disposed = false;

  constructor(config, { state = () => {}, transcript = () => {}, error = () => {} } = {}) {
    this.config = config;
    this.handlers = { state, transcript, error };
  }

  get active() { return Boolean(this.#job); }

  start() {
    if (this.#disposed) throw new Error("Dictation has been disposed");
    if (this.#job) return;
    const job = { controller: new AbortController(), proc: undefined, dir: undefined };
    job.stop = new Promise((resolve) => { job.requestStop = resolve; });
    this.#job = job;
    this.handlers.state("preparing");
    job.done = this.#run(job);
    return job.done;
  }

  stop() { this.#job?.requestStop(); }

  async cancel() {
    const job = this.#job;
    if (!job) return;
    job.controller.abort();
    job.requestStop();
    await job.proc?.stop().catch(() => {});
    await job.done;
  }

  async dispose() {
    this.#disposed = true;
    await this.cancel();
  }

  async #run(job) {
    const signal = job.controller.signal;
    let captureTimer;
    try {
      await access(this.config.modelPath).catch(() => { throw new Error(`Cannot read Whisper model: ${this.config.modelPath}. Download a model or set modelPath; see /voice-status.`); });
      signal.throwIfAborted();
      job.dir = await mkdtemp(path.join(this.config.tempDir, "opencode-whisper-"));
      const wav = path.join(job.dir, "recording.wav");
      const proc = launch(this.config.recorderPath, captureArgs(this.config, wav));
      job.proc = proc;
      await proc.started;
      signal.throwIfAborted();
      // Also bound wall-clock capture if a recorder stalls before producing audio.
      captureTimer = setTimeout(() => job.requestStop(), (this.config.maxSeconds + 1) * 1000);
      captureTimer.unref();
      this.handlers.state("recording");
      const natural = await Promise.race([proc.done, job.stop.then(() => null)]);
      const result = natural ?? await proc.stop("SIGINT");
      clearTimeout(captureTimer);
      signal.throwIfAborted();
      if (result.code !== 0 && !(natural === null && (result.signal === "SIGINT" || result.code === 130 || result.code === 255))) {
        throw failure(this.config.recorderPath, result);
      }
      await chmod(wav, 0o600);
      if ((await stat(wav)).size <= 44) throw new Error("No audio was captured. Check microphone permissions and the input device.");
      this.handlers.state("transcribing");
      const text = await transcribeFile(this.config, wav, path.join(job.dir, "transcript"), {
        signal, onProcess: (child) => { job.proc = child; },
      });
      signal.throwIfAborted();
      if (!text || /^\[(?:blank_audio|silence|music)\]$/i.test(text)) throw new Error("No speech detected. Try recording again.");
      await this.handlers.transcript(text);
    } catch (error) {
      if (!signal.aborted) this.handlers.error(error);
    } finally {
      clearTimeout(captureTimer);
      await job.proc?.stop().catch(() => {});
      if (job.dir) await rm(job.dir, { recursive: true, force: true }).catch((error) => this.handlers.error(new Error(`Could not remove private audio directory ${job.dir}: ${error.message}`)));
      if (this.#job === job) this.#job = undefined;
      this.handlers.state("idle");
    }
  }
}
