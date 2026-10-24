import { spawn } from "node:child_process";

// Never invoke a shell. Paths/device names/transcripts are arguments, not code.
export function launch(command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-8192); });
  let settled = false;
  const started = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", (error) => { settled = true; reject(new Error(`Cannot run ${command}: ${error.message}`)); });
    child.once("close", (code, signal) => { settled = true; resolve({ code, signal, stderr }); });
  });
  // Consumers may be awaiting spawn while an error/close is already queued.
  started.catch(() => {});
  done.catch(() => {});
  return {
    started,
    done,
    async stop(signal = "SIGTERM") {
      if (!settled) {
        child.kill(signal);
        const timer = setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2000);
        timer.unref();
        try { return await done; } finally { clearTimeout(timer); }
      }
      return done;
    },
  };
}

export function failure(command, result) {
  return new Error(`${command} failed (${result.code ?? result.signal}). ${result.stderr.trim() || "Check the executable, microphone permission, and model path."}`);
}
