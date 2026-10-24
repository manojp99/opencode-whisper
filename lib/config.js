import os from "node:os";
import path from "node:path";

export function expandHome(value) {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function string(options, key, fallback) {
  const value = options[key] ?? fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function positive(options, key, fallback, max) {
  const value = options[key] ?? fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${key} must be an integer between 1 and ${max}`);
  return value;
}

export function resolveConfig(options = {}) {
  const config = {
    modelPath: expandHome(string(options, "modelPath", "~/.local/share/whisper-cpp/ggml-base.en.bin")),
    whisperPath: expandHome(string(options, "whisperPath", "whisper-cli")),
    recorderPath: expandHome(string(options, "recorderPath", "sox")),
    recorder: string(options, "recorder", "sox"),
    language: string(options, "language", "en"),
    recordKey: options.recordKey === false ? false : string(options, "recordKey", "f4"),
    cancelKey: options.cancelKey === false ? false : string(options, "cancelKey", "f5"),
    maxSeconds: positive(options, "maxSeconds", 120, 3600),
    transcriptionTimeoutSeconds: positive(options, "transcriptionTimeoutSeconds", 180, 3600),
    threads: positive(options, "threads", Math.min(4, os.cpus().length || 1), 128),
    tempDir: expandHome(string(options, "tempDir", os.tmpdir())),
    audioDevice: options.audioDevice === undefined ? undefined : string(options, "audioDevice", "default"),
  };
  if (!["sox", "ffmpeg"].includes(config.recorder)) throw new Error("recorder must be sox or ffmpeg");
  if (!/^(auto|[a-z]{2,3})$/.test(config.language)) throw new Error("language must be auto or a Whisper language code (en, te, hi, ...)");
  return config;
}

export function captureArgs(config, wav, platform = process.platform) {
  if (config.recorder === "sox") {
    if (platform === "win32") throw new Error("Windows recording is not supported in this release. Use macOS or Linux.");
    const input = config.audioDevice ? ["-t", platform === "darwin" ? "coreaudio" : "pulseaudio", config.audioDevice] : ["-d"];
    return ["-q", ...input, "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", wav, "trim", "0", String(config.maxSeconds)];
  }
  const input = platform === "darwin"
    ? ["-f", "avfoundation", "-i", config.audioDevice ?? ":0"]
    : platform === "linux"
      ? ["-f", "pulse", "-i", config.audioDevice ?? "default"]
      : null;
  if (!input) throw new Error("Windows recording is not supported in this release. Use macOS or Linux.");
  return ["-hide_banner", "-loglevel", "error", "-nostdin", ...input, "-t", String(config.maxSeconds), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-y", wav];
}

export function whisperArgs(config, wav, output) {
  return ["-m", config.modelPath, "-f", wav, "-l", config.language, "-t", String(config.threads), "-nt", "-otxt", "-of", output];
}
