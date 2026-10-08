#!/usr/bin/env python3
"""Monta un Reel vertical 9:16 de Osana a partir de una tabla de tomas (JSON).

Uso:
    python3 tools/reels/build_reel.py tools/reels/reel-cuanto-llevo-en-mi-cara.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Estilo (fijo para todos los Reels de la marca):
  - 1080x1920, 30 fps, cortes secos entre tomas.
  - Color igualado por clip y grade cálido común: piel natural, contraste suave,
    sombras levantadas, sin suavizado de piel.
  - Rótulo por toma: sans fina blanco roto + una palabra clave (*entre asteriscos*)
    en manuscrita dorada, centrado y con fundido rápido de entrada.
  - Subtítulos de una palabra, sans gruesa blanca con sombra suave, a media altura.
  - Zonas libres: 15 % superior y 25 % inferior.
  - Destello cálido de 0,25 s entre bloques de tema.
  - Cartela final crema de 1 s con el logo de OSANA y la palabra Adeje.
  - Música instrumental generada (sin derechos) a volumen bajo.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

W, H, FPS = 1080, 1920, 30
AQUI = os.path.dirname(os.path.abspath(__file__))
FUENTES_TIPO = os.path.join(AQUI, "fonts")
LOGO = os.path.join(AQUI, "..", "..", "images", "logo-full-color.png")

CREMA = "0xE8E2D8"
FLASH = "0xFFD6A0"
SAFE_TOP = int(H * 0.15)       # 288 px
SAFE_BOTTOM = int(H * 0.75)    # 1440 px

# Colores ASS (&HAABBGGRR)
BLANCO_ROTO = "&H00E4EDF2"
DORADO = "&H0066A8D2"
MARRON = "&H0050738A"

GRADE = (
    "eq=contrast=0.92:saturation=1.03:gamma=1.03,"
    "curves=master='0/0.055 0.25/0.285 0.5/0.52 0.75/0.765 1/0.975',"
    "colorbalance=rs=0.035:gs=0.01:bs=-0.035:rm=0.03:gm=0.008:bm=-0.03:rh=0.012:bh=-0.02"
)


def run(cmd):
    print("+", " ".join(str(c) for c in cmd[:6]), "…", file=sys.stderr)
    subprocess.run(cmd, check=True)


def ts(t):
    t = max(0.0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def rotulo_ass(texto):
    """'Micro de *cejas* · 300 €' -> texto ASS con la palabra clave en manuscrita dorada."""
    def clave(m):
        return (r"{\fnGreat Vibes\fs134\c" + DORADO + r"\fsp0}" + m.group(1) + r"{\r}")
    return re.sub(r"\*(.+?)\*", clave, texto)


def palabras_con_tiempo(frase, ini, fin):
    palabras = frase.split()
    pesos = [len(p) + 3 for p in palabras]
    total = sum(pesos)
    t = ini
    out = []
    for p, w in zip(palabras, pesos):
        d = (fin - ini) * w / total
        out.append((p, t, t + d))
        t += d
    return out


def escribir_ass(ruta, tomas, dur_total):
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Rotulo,Raleway ExtraLight,72,{BLANCO_ROTO},&H000000FF,&H5A000000,&H00000000,0,0,0,0,100,100,1,0,1,4,0,5,80,80,0,1
Style: Total,Raleway ExtraLight,50,{BLANCO_ROTO},&H000000FF,&H64000000,&H00000000,0,0,0,0,100,100,6,0,1,2,0,8,90,90,0,1
Style: Sub,Raleway ExtraBold,104,&H00FFFFFF,&H000000FF,&H8C000000,&H96000000,0,0,0,0,100,100,0,0,1,3,3,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lineas = []
    acumulado = 0
    for tm in tomas:
        a, b = tm["_t0"], tm["_t1"]
        # Rótulo: centrado, en la franja entre los subtítulos y el 25 % inferior.
        lineas.append(
            f"Dialogue: 1,{ts(a)},{ts(b)},Rotulo,,0,0,0,,"
            r"{\an5\pos(540,1250)\blur6\fad(140,0)}" + rotulo_ass(tm["rotulo"])
        )
        # Contador acumulado (estilo «¿cuánto llevo en mi cara?»), justo bajo el 15 % superior.
        if "suma" in tm:
            acumulado += tm["suma"]
        if acumulado:
            lineas.append(
                f"Dialogue: 0,{ts(a)},{ts(b)},Total,,0,0,0,,"
                r"{\an8\pos(540," + str(SAFE_TOP + 40) + r")\blur3}TOTAL  "
                r"{\fnRaleway ExtraBold\fs66\fsp2\c" + DORADO + "}" + f"{acumulado} €"
            )
        # Subtítulos de una palabra, a media altura.
        for p, t0, t1 in palabras_con_tiempo(tm["dialogo"], a + 0.1, b - 0.08):
            lineas.append(
                f"Dialogue: 2,{ts(t0)},{ts(t1)},Sub,,0,0,0,,"
                r"{\an5\pos(540,960)\blur5}" + p
            )
    # Cartela final: «Adeje» bajo el logo.
    c0 = tomas[-1]["_t1"]
    lineas.append(
        f"Dialogue: 3,{ts(c0)},{ts(dur_total)},Rotulo,,0,0,0,,"
        r"{\an5\pos(540,1080)\bord0\blur0\fsp18\fs64\c" + MARRON + "}Adeje"
    )
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cab + "\n".join(lineas) + "\n")


def musica(ruta, dur, sr=48000):
    """Pad instrumental cálido (acordes suaves + arpegio), generado: sin derechos de autor."""
    t = np.arange(int(dur * sr)) / sr
    bpm = 96
    compas = 4 * 60 / bpm
    # Fmaj7 – Am7 – Dm9 – Bbmaj7
    acordes = [
        [174.61, 220.00, 261.63, 329.63],
        [220.00, 261.63, 329.63, 392.00],
        [146.83, 220.00, 261.63, 329.63],
        [116.54, 233.08, 293.66, 349.23],
    ]
    pad = np.zeros_like(t)
    arp = np.zeros_like(t)
    for i in range(int(math.ceil(dur / compas)) + 1):
        notas = acordes[i % 4]
        t0 = i * compas
        m = (t >= t0) & (t < t0 + compas + 0.6)
        tt = t[m] - t0
        env = np.minimum(1, tt / 0.6) * np.exp(-np.maximum(0, tt - compas) / 0.25)
        for f in notas:
            pad[m] += env * (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt + 0.3))
        paso = compas / 8
        for k in range(8):
            f = notas[[0, 2, 1, 3, 2, 1, 3, 2][k]] * 2
            a = t0 + k * paso
            mm = (t >= a) & (t < a + 0.9)
            u = t[mm] - a
            arp[mm] += np.exp(-u * 5) * np.sin(2 * np.pi * f * u) * (1 - np.exp(-u * 300))
    trem = 0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * t)
    mezcla = 0.55 * pad * trem / 4 + 0.35 * arp
    # Fundidos de entrada/salida y normalización a pico 1.0 (el volumen final se fija en la mezcla).
    fade = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.0)
    mezcla *= fade
    mezcla /= np.max(np.abs(mezcla)) + 1e-9
    est = np.stack([mezcla, np.roll(mezcla, int(0.012 * sr))], 1)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((est * 32767 * 0.95).astype("<i2").tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True, help="carpeta con los vídeos originales")
    ap.add_argument("--salida", default=".")
    ap.add_argument("--volumen-musica", type=float, default=0.10,
                    help="volumen de la música (0.05–0.10 = 5–10 %%)")
    args = ap.parse_args()

    cfg = json.load(open(args.tabla, encoding="utf-8"))
    tomas = cfg["tomas"]
    tmp = tempfile.mkdtemp(prefix="reel-")
    ganancias = cfg.get("ajuste_color", {})

    # 1) Cortar, igualar color y normalizar cada toma.
    piezas = []
    t = 0.0
    for i, tm in enumerate(tomas):
        n = round((tm["fin"] - tm["inicio"]) * FPS)
        dur = n / FPS
        tm["_t0"], tm["_t1"] = t, t + dur
        t += dur
        r, g, b = ganancias.get(tm["archivo"], [1, 1, 1])
        vf = (
            f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},"
            f"fps={FPS},colorchannelmixer=rr={r}:gg={g}:bb={b},{GRADE},setsar=1,format=yuv420p"
        )
        out = os.path.join(tmp, f"toma{i:02d}.mp4")
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(tm["inicio"]),
             "-i", os.path.join(args.fuentes, tm["archivo"]),
             "-frames:v", str(n), "-an", "-vf", vf,
             "-c:v", "libx264", "-preset", "medium", "-crf", "12", out])
        piezas.append(out)

    # 2) Cartela crema con el logo.
    dur_cartela = cfg["cartela"]["duracion"]
    cartela = os.path.join(tmp, "cartela.mp4")
    run(["ffmpeg", "-v", "error", "-y",
         "-f", "lavfi", "-i", f"color=c={CREMA}:s={W}x{H}:r={FPS}:d={dur_cartela}",
         "-i", LOGO,
         "-filter_complex", "[1]scale=700:-1[l];[0][l]overlay=(W-w)/2:860,setsar=1,format=yuv420p",
         "-frames:v", str(round(dur_cartela * FPS)),
         "-c:v", "libx264", "-crf", "12", cartela])
    piezas.append(cartela)
    dur_total = t + dur_cartela

    lista = os.path.join(tmp, "lista.txt")
    with open(lista, "w") as f:
        f.writelines(f"file '{p}'\n" for p in piezas)
    base = os.path.join(tmp, "base.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista,
         "-c", "copy", base])

    # 3) Rótulos, subtítulos, destellos entre bloques y música.
    ass = os.path.join(tmp, "textos.ass")
    escribir_ass(ass, tomas, dur_total)
    wav = os.path.join(tmp, "musica.wav")
    musica(wav, dur_total)

    cortes = [tomas[i]["_t0"] for i in range(1, len(tomas))
              if tomas[i]["bloque"] != tomas[i - 1]["bloque"]]
    filtro = ""
    previo = "0:v"
    for k, c in enumerate(cortes):
        # Destello de 0,25 s centrado en el corte: sube 0,125 s y baja 0,125 s.
        filtro += (
            f"color=c={FLASH}@0.85:s={W}x{H}:r={FPS}:d=0.25,format=rgba,"
            f"fade=in:st=0:d=0.125:alpha=1,fade=out:st=0.125:d=0.125:alpha=1,"
            f"setpts=PTS+{c - 0.125:.3f}/TB[f{k}];"
            f"[{previo}][f{k}]overlay=eof_action=pass:format=auto[v{k}];"
        )
        previo = f"v{k}"
    filtro += (
        f"[{previo}]subtitles='{ass}':fontsdir='{FUENTES_TIPO}',format=yuv420p[v];"
        f"[1:a]volume={args.volumen_musica}[a]"
    )
    os.makedirs(args.salida, exist_ok=True)
    final = os.path.join(args.salida, cfg["salida"] + ".mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", base, "-i", wav,
         "-filter_complex", filtro, "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high",
         "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-movflags", "+faststart", "-t", f"{dur_total:.3f}", final])

    # Versión sin música, para poner un audio en tendencia desde Instagram.
    mudo = os.path.join(args.salida, cfg["salida"] + "-sin-musica.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", final, "-c:v", "copy", "-an", mudo])

    shutil.rmtree(tmp)
    print(final)
    print(mudo)


if __name__ == "__main__":
    main()
