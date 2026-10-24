// Explicit, opt-in model download; importing the plugin never accesses the network.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, access } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { expandHome } from "../lib/config.js";

const target = path.resolve(expandHome(process.argv[2] ?? "~/.local/share/whisper-cpp/ggml-base.en.bin"));
const checksum = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
const url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin";
async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

await mkdir(path.dirname(target), { recursive: true });
if (await access(target).then(() => true, () => false)) {
  if (await digest(target) !== checksum) throw new Error(`Existing model does not match the expected SHA-256; refusing to overwrite ${target}`);
  console.log(`Verified existing model: ${target}`);
} else {
  const partial = `${target}.${process.pid}.part`;
  try {
    console.log("Downloading base.en (~148 MB) from Hugging Face…");
    const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    if (await digest(partial) !== checksum) throw new Error("Model SHA-256 verification failed");
    await rename(partial, target);
    console.log(`Downloaded and SHA-256 verified: ${target}`);
  } finally {
    await rm(partial, { force: true });
  }
}
