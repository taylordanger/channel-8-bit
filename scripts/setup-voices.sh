#!/usr/bin/env bash
# One-time setup for Kokoro voices: a private Python env + the model files (~340 MB).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv-tts
.venv-tts/bin/pip install -q --upgrade pip
.venv-tts/bin/pip install -q kokoro-onnx soundfile
mkdir -p data/kokoro
base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
for f in kokoro-v1.0.onnx voices-v1.0.bin; do
  [ -f "data/kokoro/$f" ] || curl -L --fail --progress-bar -o "data/kokoro/$f" "$base/$f"
done
echo "Kokoro voices ready. Restart the station (npm start) to use them."
