"""Opt-in real-TUI registration smoke test. Never records or submits a prompt.

Run: python3 scripts/smoke-tui.py
Requires an installed OpenCode V2. Results are saved under ignored .local/.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import termios
import time

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--plugin-dir", type=Path, default=root, help="Test an extracted npm package instead of the source directory")
parser.add_argument("--sample", type=Path, help="Transcribe a prerecorded WAV instead of using the microphone")
parser.add_argument("--whisper", type=Path)
parser.add_argument("--model", type=Path)
args = parser.parse_args()
if args.sample and not (args.whisper and args.model):
    parser.error("--sample requires --whisper and --model")
output = root / ".local" / "tui-smoke.txt"
output.parent.mkdir(exist_ok=True)
options = {}
if args.sample:
    import sys
    wrapper = root / ".local" / "smoke-recorder"
    wrapper.write_text(f"#!{sys.executable}\nimport shutil, sys, time\na = sys.argv\nshutil.copyfile({str(args.sample.resolve())!r}, a[a.index('trim') - 1])\ntime.sleep(0.25)\n")
    wrapper.chmod(0o700)
    options = {"modelPath": str(args.model.resolve()), "whisperPath": str(args.whisper.resolve()), "recorderPath": str(wrapper)}
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 140, 0, 0))
env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor")
env["OPENCODE_CLI_CONFIG_CONTENT"] = json.dumps({
    "plugins": [{"package": str(args.plugin_dir.resolve()), "options": options}],
    "animations": False,
    "highlights": False,
})
proc = subprocess.Popen([shutil.which("opencode"), str(root)], stdin=slave,
                        stdout=slave, stderr=slave, env=env, start_new_session=True)
os.close(slave)
captured = bytearray()

def pump(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data = os.read(master, 1048576)
            except OSError:
                break
            captured.extend(data)
            # Answer the terminal's cursor-position query; all other probes time out safely.
            if b"\x1b[6n" in data:
                os.write(master, b"\x1b[1;1R")
        if proc.poll() is not None:
            break

try:
    pump(8)
    os.write(master, b"/voice-status")
    pump(1)
    os.write(master, b"\r")
    pump(3)
    if args.sample:
        os.write(master, b"\x1b")  # close status dialog
        pump(0.5)
        os.write(master, b"SMOKE_DRAFT ")
        os.write(master, b"\x1bOS")  # F4: synthetic recorder copies the sample WAV
        pump(12)
    text = captured.decode("utf-8", "replace")
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    output.write_text(text)
    if "Local Whisper voice" not in text or "(V2 API)" not in text:
        raise SystemExit(f"TUI smoke test did not find the plugin status dialog. Inspect {output}")
    if args.sample and "Transcript inserted." not in text:
        raise SystemExit(f"TUI loaded, but dictation did not insert the sample transcript. Inspect {output}")
    print(f"PASS: installed OpenCode loaded the V2 plugin and displayed /voice-status. Capture: {output}")
    if args.sample:
        print("PASS: prerecorded sample transcribed by whisper.cpp and pasted into the real TUI; no prompt submitted.")
finally:
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
    os.close(master)
