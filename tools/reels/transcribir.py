#!/usr/bin/env python3
"""Transcribe la voz de un vídeo en frases con tiempos (Whisper small + detector de voz).

Uso:
    ffmpeg -i video.mov -vn -ac 1 -ar 16000 -af highpass=f=80 audio.wav
    python3 tools/reels/transcribir.py <carpeta-modelos> audio.wav salida.json

<carpeta-modelos> contiene sherpa-onnx-whisper-small/ y silero_vad.onnx (ver ESTILO.md).
"""
import sys, json, numpy as np, soundfile as sf, sherpa_onnx
A = sys.argv[1]; wav = sys.argv[2]; out = sys.argv[3]
rec = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=f"{A}/sherpa-onnx-whisper-small/small-encoder.int8.onnx",
    decoder=f"{A}/sherpa-onnx-whisper-small/small-decoder.int8.onnx",
    tokens=f"{A}/sherpa-onnx-whisper-small/small-tokens.txt",
    language="es", task="transcribe", num_threads=4)
cfg = sherpa_onnx.VadModelConfig()
cfg.silero_vad.model = f"{A}/silero_vad.onnx"
cfg.silero_vad.min_silence_duration = 0.25
cfg.silero_vad.min_speech_duration = 0.25
cfg.silero_vad.max_speech_duration = 12
cfg.silero_vad.threshold = 0.45
cfg.sample_rate = 16000
vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=600)
x, sr = sf.read(wav, dtype="float32")
segs = []
w = cfg.silero_vad.window_size
def drain():
    while not vad.empty():
        s = vad.front; segs.append((s.start / sr, np.array(s.samples))); vad.pop()
for i in range(0, len(x), w):
    vad.accept_waveform(x[i:i + w]); drain()
vad.flush(); drain()
res = []
for t0, smp in segs:
    st = rec.create_stream(); st.accept_waveform(sr, smp); rec.decode_stream(st)
    txt = st.result.text.strip()
    res.append({"inicio": round(t0, 2), "fin": round(t0 + len(smp) / sr, 2), "texto": txt})
    print(f"{t0:7.2f}-{t0+len(smp)/sr:7.2f} {txt}", flush=True)
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
