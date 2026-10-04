"""Local Kokoro text-to-speech server for Channel 8-Bit.

Loads the model once and serves WAV audio on localhost:
  GET  /health                       -> {"ok": true, "voices": [...]}
  POST /speak {"text","voice","speed"} -> audio/wav (16-bit mono, 24 kHz)

Requests are handled one at a time (the model saturates the CPU anyway).
"""
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

MODEL_DIR = os.environ.get("KOKORO_DIR", "data/kokoro")
PORT = int(os.environ.get("KOKORO_PORT", "8765"))

options = ort.SessionOptions()
options.intra_op_num_threads = os.cpu_count() or 8
session = ort.InferenceSession(os.path.join(MODEL_DIR, "kokoro-v1.0.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
kokoro = Kokoro.from_session(session, os.path.join(MODEL_DIR, "voices-v1.0.bin"))
VOICES = sorted(kokoro.get_voices())
kokoro.create("Warming up.", voice="af_heart", lang="en-us")  # first call is slow; pay it now


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep the station's terminal clean
        pass

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "voices": VOICES})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/speak":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length > 20_000:
                return self._json(413, {"error": "too long"})
            req = json.loads(self.rfile.read(length))
            text = str(req.get("text", "")).strip()[:1000]
            voice = str(req.get("voice", "af_heart"))
            speed = max(0.5, min(2.0, float(req.get("speed", 1.0))))
            if not text:
                return self._json(400, {"error": "empty text"})
            if voice not in VOICES:
                return self._json(400, {"error": f"unknown voice {voice}"})
            samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-gb" if voice[:1] == "b" else "en-us")
            buf = io.BytesIO()
            sf.write(buf, np.asarray(samples), rate, format="WAV", subtype="PCM_16")
            data = buf.getvalue()
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # report, don't die: the station falls back to macOS voices
            self._json(500, {"error": str(e)})


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"kokoro ready on 127.0.0.1:{PORT} with {len(VOICES)} voices", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
