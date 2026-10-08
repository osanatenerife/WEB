#!/usr/bin/env python3
"""Monta un Reel vertical 9:16 de Osana a partir de una tabla de tomas (JSON).

Uso:
    python3 tools/reels/build_reel.py tools/reels/reel-cuanto-llevo-en-mi-cara.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Requisitos: ffmpeg con libass, numpy y opencv-python-headless<5 (detección de cara).

Estilo (referencia: Reels tipo «¿cuánto dinero llevo en mi cara?»):
  - 1080x1920, 30 fps, cortes secos y encuadre que alterna plano medio / plano
    cerrado en cada corte (jump cut), centrado en la cara.
  - Corrección de imagen: exposición de la cara igualada en todos los clips,
    sombras levantadas, luces bajadas (sin brillos), balance de blancos igualado,
    reducción de ruido y nitidez ligera. Sin suavizado de piel.
  - Textos SIEMPRE a la altura del pecho, por debajo de la barbilla detectada:
    rótulo en mayúsculas Montserrat ExtraBold blanco, precio en dorado con
    «pop», y subtítulos que se van construyendo palabra a palabra.
    Sombra negra suave al 40 % y, si el fondo detrás es claro, franja oscura
    difuminada.
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

import cv2
import numpy as np

W, H, FPS = 1080, 1920, 30
AW, AH = 540, 960                      # resolución de análisis
AQUI = os.path.dirname(os.path.abspath(__file__))
FUENTES_TIPO = os.path.join(AQUI, "fonts")
LOGO = os.path.join(AQUI, "..", "..", "images", "logo-full-color.png")

CREMA = "0xE8E2D8"
FLASH = "0xFFD6A0"
LIMITE_SUP = int(H * 0.15)             # 288 px libres arriba
LIMITE_INF = int(H * 0.75)             # 1440 px: por debajo, libre

# Colores ASS (&HAABBGGRR)
BLANCO = "&H00FFFFFF"
DORADO = "&H0062C6EE"
MARRON = "&H0050738A"
SOMBRA_ALFA = "&H99&"                  # negro al 40 %

# Tamaño de la cara (alto / alto de pantalla) que se busca en cada toma: alterna
# plano medio y plano cerrado para dar ritmo a los cortes.
PLANOS = [0.19, 0.245]
ZOOM_MAX = 1.8                         # el original es 4K: hasta 2x sin perder nitidez

# Tamaños de texto
F_ROT, F_PRE, F_SUB = 80, 118, 54
LH_ROT, LH_PRE, LH_SUB = 98, 120, 62
HUECO = 10


def run(cmd):
    print("+", " ".join(str(c) for c in cmd[:6]), "…", file=sys.stderr)
    subprocess.run(cmd, check=True)


def ts(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


# ---------------------------------------------------------------- análisis

CARAS = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def fotograma(ruta, t):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", ruta, "-frames:v", "1",
         "-vf", f"scale={AW}:{AH}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(AH, AW, 3)


def analizar(tm, fuentes, n=6):
    """Cara (centro, alto, barbilla) y fotogramas de muestra de una toma, en coords 0–1."""
    ruta = os.path.join(fuentes, tm["archivo"])
    imgs, caras = [], []
    for k in range(n):
        t = tm["inicio"] + (tm["fin"] - tm["inicio"]) * (k + 0.5) / n
        img = fotograma(ruta, t)
        imgs.append(img)
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        f = CARAS.detectMultiScale(g, 1.1, 6, minSize=(50, 50))
        if len(f):
            x, y, w, h = max(f, key=lambda r: r[2] * r[3])
            caras.append((x, y, w, h, g[y + h // 4:y + 3 * h // 4, x + w // 4:x + 3 * w // 4].mean()))
    if caras:
        c = np.array(caras, float)
        cx = np.median(c[:, 0] + c[:, 2] / 2) / AW
        cy = np.median(c[:, 1] + c[:, 3] / 2) / AH
        alto = np.median(c[:, 3]) / AH
        # La caja de Haar llega a la boca; la barbilla queda ~20 % más abajo.
        barbilla = np.max(c[:, 1] + c[:, 3] * 1.2) / AH
        luma = float(np.mean(c[:, 4])) / 255
    else:
        cx, cy, alto, barbilla, luma = 0.5, 0.3, 0.15, 0.4, None
    tm["_cara"] = dict(cx=cx, cy=cy, alto=alto, barbilla=barbilla, luma=luma)
    tm["_imgs"] = imgs


def blancos(imgs):
    """Ganancias RGB para neutralizar la pared (el 15 % de píxeles más claros)."""
    acc = []
    for img in imgs:
        a = img[..., ::-1].astype(float)
        lum = a.mean(2)
        acc.append(a[lum > np.percentile(lum, 85)].mean(0))
    m = np.mean(acc, 0)
    return m.mean() / m


def encuadre(tm, i):
    c = tm["_cara"]
    z = min(ZOOM_MAX, max(1.0, PLANOS[i % 2] / max(c["alto"], 1e-3)))
    cw = ch = 1 / z
    x0 = min(max(c["cx"] - cw / 2, 0), 1 - cw)
    y0 = min(max(c["cy"] - 0.30 * ch, 0), 1 - ch)   # ojos en el tercio superior
    tm["_crop"] = (x0, y0, cw, ch)
    tm["_barbilla_px"] = (c["barbilla"] - y0) / ch * H


# ---------------------------------------------------------------- textos

def partir(texto, max_chars=17):
    lineas, actual = [], ""
    for p in texto.split():
        prueba = (actual + " " + p).strip()
        if len(prueba.replace("*", "")) > max_chars and actual:
            lineas.append(actual)
            actual = p
        else:
            actual = prueba
    return lineas + ([actual] if actual else [])


def dorar(texto, color_base):
    return re.sub(r"\*(.+?)\*", lambda m: r"{\c" + DORADO + "}" + m.group(1) + r"{\c" + color_base + "}", texto)


def maquina(texto, dur_ms=650):
    """Efecto máquina de escribir: cada letra aparece de golpe en orden."""
    limpio = re.sub(r"\{[^}]*\}", "", texto.replace(r"\N", "\n"))
    n = max(1, len(limpio))
    out, k, i = [], 0, 0
    while i < len(texto):
        if texto[i] == "{":
            j = texto.index("}", i)
            out.append(texto[i:j + 1])
            i = j + 1
            continue
        if texto.startswith(r"\N", i):
            out.append(r"\N")
            i += 2
            continue
        t = int(dur_ms * k / n)
        out.append(r"{\alpha&HFF&\t(" + f"{t},{t + 1}" + r",\alpha&H00&)}" + texto[i])
        k += 1
        i += 1
    return "".join(out)


def con_sombra(capa, t0, t1, estilo, x, y, tags, texto, an=8):
    """Texto + su sombra negra suave al 40 % (capa aparte desplazada y desenfocada)."""
    sombra = re.sub(r"\\c&H[0-9A-F]{8}&", "", texto)
    sombra = re.sub(r"\\alpha&H00&", r"\\alpha" + SOMBRA_ALFA, sombra)
    return [
        f"Dialogue: {capa},{ts(t0)},{ts(t1)},{estilo},,0,0,0,,"
        + "{" + rf"\an{an}\pos({x},{y + 5})\bord0\shad0\blur9\1c&H000000&\1a{SOMBRA_ALFA}" + tags + "}" + sombra,
        f"Dialogue: {capa + 1},{ts(t0)},{ts(t1)},{estilo},,0,0,0,,"
        + "{" + rf"\an{an}\pos({x},{y})\bord0\shad0" + tags + "}" + texto,
    ]


def bloques_subtitulo(frase, ini, fin, max_palabras=3):
    """Subtítulos que se construyen palabra a palabra, en grupos de hasta 3 palabras."""
    palabras = frase.split()
    pesos = [len(p) + 3 for p in palabras]
    total = sum(pesos)
    tiempos, t = [], ini
    for w in pesos:
        d = (fin - ini) * w / total
        tiempos.append((t, t + d))
        t += d
    out = []
    for g in range(0, len(palabras), max_palabras):
        grupo = palabras[g:g + max_palabras]
        for k in range(len(grupo)):
            a = tiempos[g + k][0]
            b = tiempos[g + k][1] if k < len(grupo) - 1 else tiempos[g + len(grupo) - 1][1]
            out.append((" ".join(grupo[:k + 1]), a, b))
    return out


def escribir_ass(ruta, tomas, dur_total):
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Rotulo,Montserrat ExtraBold,{F_ROT},{BLANCO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,0,1
Style: Precio,Montserrat ExtraBold,{F_PRE},{DORADO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,0,1
Style: Sub,Montserrat,{F_SUB},{BLANCO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,0,1
Style: Cartela,Raleway ExtraLight,64,{MARRON},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,18,0,1,0,0,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    for tm in tomas:
        a, b = tm["_t0"], tm["_t1"]
        lineas = partir(tm["rotulo"].upper())
        alto = len(lineas) * LH_ROT + HUECO + LH_SUB
        if tm.get("precio"):
            alto += LH_PRE + HUECO
        # Bloque de texto bajo la barbilla, dentro de la zona segura.
        top = int(min(max(tm["_barbilla_px"] + 60, LIMITE_SUP), LIMITE_INF - alto))
        tm["_texto"] = (top, alto)

        if tm["_franja"]:
            pad = 70
            ev.append(
                f"Dialogue: 0,{ts(a)},{ts(b)},Rotulo,,0,0,0,,"
                + r"{\an7\pos(0," + str(top - pad) + r")\p1\bord0\shad0\blur45\1c&H000000&\1a&H73&}"
                + f"m 0 0 l {W} 0 l {W} {alto + 2 * pad} l 0 {alto + 2 * pad}"
            )

        y = top
        rot = dorar(r"\N".join(lineas), BLANCO)
        if tm.get("maquina"):
            ev += con_sombra(2, a, b, "Rotulo", 540, y, "", maquina(rot))
        else:
            ev += con_sombra(2, a, b, "Rotulo", 540, y,
                             r"\fad(80,0)\fscx112\fscy112\t(0,160,\fscx100\fscy100)", rot)
        y += len(lineas) * LH_ROT + HUECO

        if tm.get("precio"):
            ev += con_sombra(4, a + 0.35, b, "Precio", 540, y,
                             r"\fscx135\fscy135\t(0,180,\fscx100\fscy100)", tm["precio"])
            y += LH_PRE + HUECO

        for txt, t0, t1 in bloques_subtitulo(tm["dialogo"], a + 0.08, b - 0.06):
            ev += con_sombra(6, t0, t1, "Sub", 540, y, "", txt)

    c0 = tomas[-1]["_t1"]
    ev.append(f"Dialogue: 8,{ts(c0)},{ts(dur_total)},Cartela,,0,0,0,," + r"{\an5\pos(540,1080)}Adeje")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cab + "\n".join(ev) + "\n")


def necesita_franja(tm):
    """¿El fondo detrás del bloque de texto es claro? (luminancia media > 55 %)."""
    x0, y0, cw, ch = tm["_crop"]
    top, alto = tm["_texto"]
    ya = int((y0 + ch * top / H) * AH)
    yb = int((y0 + ch * (top + alto) / H) * AH)
    xa = int((x0 + cw * 0.1) * AW)
    xb = int((x0 + cw * 0.9) * AW)
    lum = np.mean([cv2.cvtColor(i, cv2.COLOR_BGR2GRAY)[ya:yb, xa:xb].mean() for i in tm["_imgs"]])
    return lum / 255 > 0.55


# ---------------------------------------------------------------- imagen

def correccion(gan, luma_cara):
    """Misma receta para todos los clips; solo cambia el punto que lleva la cara a 0,60."""
    r, g, b = gan
    f = min(max(luma_cara or 0.55, 0.35), 0.75)
    curva = f"0/0.045 0.15/0.19 {f:.3f}/0.60 0.8/0.78 1/0.92"   # sombras arriba, luces abajo
    return (
        f"colorchannelmixer=rr={r:.4f}:gg={g:.4f}:bb={b:.4f},"
        f"curves=master='{curva}',"
        "hqdn3d=1.2:1.0:3:3,"
        "colorbalance=rs=0.025:bs=-0.03:rm=0.025:gm=0.005:bm=-0.025:rh=0.01:bh=-0.015,"
        "eq=saturation=1.06,"
        "unsharp=5:5:0.35:5:5:0,"
        "vignette=angle=PI/6"
    )


# ---------------------------------------------------------------- música

def musica(ruta, dur, sr=48000):
    """Pad instrumental cálido (acordes suaves + arpegio), generado: sin derechos de autor."""
    t = np.arange(int(dur * sr)) / sr
    compas = 4 * 60 / 96
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
    mezcla *= np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.0)
    mezcla /= np.max(np.abs(mezcla)) + 1e-9
    est = np.stack([mezcla, np.roll(mezcla, int(0.012 * sr))], 1)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((est * 32767 * 0.95).astype("<i2").tobytes())


# ---------------------------------------------------------------- montaje

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

    # 1) Analizar caras y luz; igualar blancos y exposición por clip.
    for i, tm in enumerate(tomas):
        analizar(tm, args.fuentes)
        encuadre(tm, i)
    por_clip = {}
    for tm in tomas:
        por_clip.setdefault(tm["archivo"], []).append(tm)
    receta = {}
    for archivo, ts_ in por_clip.items():
        imgs = [im for tm in ts_ for im in tm["_imgs"]]
        lumas = [tm["_cara"]["luma"] for tm in ts_ if tm["_cara"]["luma"]]
        receta[archivo] = correccion(blancos(imgs), float(np.mean(lumas)) if lumas else None)

    # 2) Cortar, encuadrar y corregir cada toma.
    piezas, t = [], 0.0
    for i, tm in enumerate(tomas):
        n = round((tm["fin"] - tm["inicio"]) * FPS)
        dur = n / FPS
        tm["_t0"], tm["_t1"] = t, t + dur
        t += dur
        x0, y0, cw, ch = tm["_crop"]
        vf = (
            f"crop=iw*{cw:.5f}:ih*{ch:.5f}:iw*{x0:.5f}:ih*{y0:.5f},"
            f"scale={W}:{H}:flags=lanczos,fps={FPS},{receta[tm['archivo']]},setsar=1,format=yuv420p"
        )
        out = os.path.join(tmp, f"toma{i:02d}.mp4")
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(tm["inicio"]),
             "-i", os.path.join(args.fuentes, tm["archivo"]),
             "-frames:v", str(n), "-an", "-vf", vf,
             "-c:v", "libx264", "-preset", "medium", "-crf", "12", out])
        piezas.append(out)

    # 3) Cartela crema con el logo.
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
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", base])

    # 4) Textos (con franja si el fondo es claro), destellos entre bloques y música.
    ass = os.path.join(tmp, "textos.ass")
    for tm in tomas:
        tm["_franja"] = False
    escribir_ass(ass, tomas, dur_total)          # primera pasada: calcula posiciones
    for tm in tomas:
        tm["_franja"] = necesita_franja(tm)
    escribir_ass(ass, tomas, dur_total)
    wav = os.path.join(tmp, "musica.wav")
    musica(wav, dur_total)

    cortes = [tomas[i]["_t0"] for i in range(1, len(tomas))
              if tomas[i]["bloque"] != tomas[i - 1]["bloque"]]
    filtro, previo = "", "0:v"
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

    for tm in tomas:
        print(f"{tm['_t0']:5.2f}s {tm['archivo']} zoom={1 / tm['_crop'][2]:.2f} "
              f"texto_y={tm['_texto'][0]} franja={tm['_franja']}", file=sys.stderr)
    shutil.rmtree(tmp)
    print(final)
    print(mudo)


if __name__ == "__main__":
    main()
