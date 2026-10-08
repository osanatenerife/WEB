#!/usr/bin/env python3
"""Monta un Reel vertical 9:16 de Osana a partir de una tabla de tomas (JSON).

Uso:
    python3 tools/reels/build_reel.py tools/reels/reel-cuanto-llevo-en-mi-cara.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Requisitos: ffmpeg con libass, numpy y opencv-python-headless<5 (detección de cara).

Estilo Osana (guía completa en tools/reels/ESTILO.md):
  - 1080x1920, 30 fps, cortes secos y encuadre que alterna plano medio / plano
    cerrado en cada corte (jump cut), centrado en la cara.
  - Imagen cinematográfica: exposición de la cara igualada en todos los clips,
    sombras levantadas y algo frías, luces bajadas (sin brillos), piel neutra
    (no amarilla), saturación contenida, reducción de ruido, nitidez ligera.
    Sin suavizado de piel.
  - Subtítulos de diálogo grandes justo DEBAJO de la cara (detectada), que se
    construyen palabra a palabra.
  - Tema / precio en un recuadro oscuro redondeado: encima de la cabeza si hay
    sitio, si no en la parte baja de la zona segura. Precio en dorado.
  - Sombra negra suave al 40 % y franja oscura difuminada si el fondo es claro.
  - Zonas libres: 15 % superior y 25 % inferior.
  - Destello suave de 0,25 s entre bloques de tema. Sin cartela final.
  - Sin música (se añade en Instagram/Edits con un audio en tendencia). Solo
    efectos de sonido sutiles: «pop» al aparecer un precio, «whoosh» en los
    destellos y tecleo en el gancho. Con --musica, versión extra con pad suave.
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

FLASH = "0xFFE9D2"
LIMITE_SUP = int(H * 0.15)             # 288 px libres arriba
LIMITE_INF = int(H * 0.75)             # 1440 px: por debajo, libre

# Colores ASS (&HAABBGGRR)
BLANCO = "&H00FFFFFF"
DORADO = "&H0062C6EE"
SOMBRA_ALFA = "&H99&"                  # negro al 40 %

# Tamaño de la cara (alto / alto de pantalla) que se busca en cada toma: alterna
# plano medio y plano cerrado para dar ritmo a los cortes.
PLANOS = [0.19, 0.245]
ZOOM_MAX = 1.8                         # el original es 4K: hasta 2x sin perder nitidez

# Subtítulos de diálogo: grandes, justo debajo de la cara.
F_SUB, LH_SUB, SUB_MAX_CHARS = 80, 96, 16
# Recuadro de información (tema, precio): encima de la cabeza si cabe, si no abajo.
F_ROT, LH_ROT, ROT_MAX_CHARS = 58, 70, 20
F_PRE, LH_PRE = 104, 116
PAD_X, PAD_Y, RADIO = 44, 30, 26
CAJA_ALFA = "&H70&"                    # negro al ~56 %


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
        # El pelo sobresale ~40 % del alto de la caja por encima de ella.
        cabeza = np.min(c[:, 1] - c[:, 3] * 0.4) / AH
        luma = float(np.mean(c[:, 4])) / 255
    else:
        cx, cy, alto, barbilla, cabeza, luma = 0.5, 0.3, 0.15, 0.4, 0.15, None
    tm["_cara"] = dict(cx=cx, cy=cy, alto=alto, barbilla=barbilla, cabeza=cabeza, luma=luma)
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
    tm["_cabeza_px"] = (c["cabeza"] - y0) / ch * H


# ---------------------------------------------------------------- textos

def partir(texto, max_chars):
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


def rect_redondeado(w, h, r):
    k = r * 0.45
    return (f"m {r} 0 l {w - r} 0 b {w - k} 0 {w} {k} {w} {r} l {w} {h - r} "
            f"b {w} {h - k} {w - k} {h} {w - r} {h} l {r} {h} b {k} {h} 0 {h - k} 0 {h - r} "
            f"l 0 {r} b 0 {k} {k} 0 {r} 0")


def bloques_subtitulo(frase, ini, fin):
    """Subtítulos que se construyen palabra a palabra, en grupos cortos (una línea)."""
    palabras = frase.split()
    pesos = [len(p) + 3 for p in palabras]
    total = sum(pesos)
    tiempos, t = [], ini
    for w in pesos:
        d = (fin - ini) * w / total
        tiempos.append((t, t + d))
        t += d
    grupos, actual = [], []
    for i, p in enumerate(palabras):
        if actual and (len(" ".join(palabras[j] for j in actual + [i])) > SUB_MAX_CHARS or len(actual) == 3):
            grupos.append(actual)
            actual = []
        actual.append(i)
    if actual:
        grupos.append(actual)
    out = []
    for g in grupos:
        for k, i in enumerate(g):
            b = tiempos[i][1] if k < len(g) - 1 else tiempos[g[-1]][1]
            out.append((" ".join(palabras[j] for j in g[:k + 1]), tiempos[i][0], b))
    return out


def ancho_texto(texto, fs, factor=0.66):
    return len(re.sub(r"\*", "", texto)) * fs * factor


def maquetar(tm):
    """Coloca subtítulos (bajo la barbilla) y recuadro (encima de la cabeza o abajo)."""
    sub_top = int(min(max(tm["_barbilla_px"] + 45, LIMITE_SUP), LIMITE_INF - LH_SUB))
    lineas = partir(tm["rotulo"].upper(), ROT_MAX_CHARS)
    alto = 2 * PAD_Y + len(lineas) * LH_ROT + (LH_PRE if tm.get("precio") else 0)
    ancho = 2 * PAD_X + max([ancho_texto(l, F_ROT) for l in lineas]
                            + ([ancho_texto(tm["precio"], F_PRE, 0.62)] if tm.get("precio") else []))
    ancho = int(min(W - 80, max(ancho, 360)))
    arriba = tm["_cabeza_px"] - 30 - alto
    if arriba >= LIMITE_SUP:
        caja_top = int(arriba)
    else:
        caja_top = int(max(LIMITE_INF - alto, sub_top + LH_SUB + 30))
    tm["_sub_top"] = sub_top
    tm["_caja"] = (caja_top, ancho, alto, lineas)


def escribir_ass(ruta, tomas, dur_total):
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Rotulo,Montserrat ExtraBold,{F_ROT},{BLANCO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,8,40,40,0,1
Style: Precio,Montserrat ExtraBold,{F_PRE},{DORADO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,0,1
Style: Sub,Montserrat ExtraBold,{F_SUB},{BLANCO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    for tm in tomas:
        a, b = tm["_t0"], tm["_t1"]
        caja_top, ancho, alto, lineas = tm["_caja"]
        sub_top = tm["_sub_top"]

        # Franja oscura difuminada detrás de los subtítulos si el fondo es claro.
        if tm["_franja"]:
            pad = 50
            ev.append(
                f"Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,"
                + r"{\an7\pos(0," + str(sub_top - pad) + r")\p1\bord0\shad0\blur40\1c&H000000&\1a&H80&}"
                + f"m 0 0 l {W} 0 l {W} {LH_SUB + 2 * pad} l 0 {LH_SUB + 2 * pad}"
            )
        for txt, t0, t1 in bloques_subtitulo(tm["dialogo"], a + 0.08, b - 0.06):
            ev += con_sombra(1, t0, t1, "Sub", 540, sub_top, "", txt)

        # Recuadro con el tema / precio.
        x0 = (W - ancho) // 2
        entrada = r"\fad(120,0)"
        ev.append(
            f"Dialogue: 3,{ts(a)},{ts(b)},Rotulo,,0,0,0,,"
            + r"{\an7\pos(" + f"{x0},{caja_top}" + r")\p1\bord0\shad0\blur1\1c&H000000&\1a" + CAJA_ALFA + entrada + "}"
            + rect_redondeado(ancho, alto, RADIO)
        )
        y = caja_top + PAD_Y
        rot = dorar(r"\N".join(lineas), BLANCO)
        if tm.get("maquina"):
            ev += con_sombra(4, a, b, "Rotulo", 540, y, "", maquina(rot))
        else:
            ev += con_sombra(4, a, b, "Rotulo", 540, y, entrada, rot)
        y += len(lineas) * LH_ROT
        if tm.get("precio"):
            ev += con_sombra(6, a + 0.3, b, "Precio", 540, y - 6,
                             r"\fscx130\fscy130\t(0,180,\fscx100\fscy100)", tm["precio"])

    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cab + "\n".join(ev) + "\n")


def necesita_franja(tm):
    """¿El fondo detrás de los subtítulos es claro? (luminancia media > 55 %)."""
    x0, y0, cw, ch = tm["_crop"]
    top = tm["_sub_top"]
    ya = int((y0 + ch * top / H) * AH)
    yb = int((y0 + ch * (top + LH_SUB) / H) * AH)
    xa = int((x0 + cw * 0.15) * AW)
    xb = int((x0 + cw * 0.85) * AW)
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
        # Cinematográfico: sombras ligeramente frías, medios neutros (piel sin
        # amarillear), luces apenas cálidas y saturación contenida.
        "colorbalance=rs=-0.03:gs=0.0:bs=0.035:rm=-0.01:gm=-0.012:bm=0.02:rh=0.015:bh=-0.005,"
        "eq=saturation=0.92:contrast=1.03,"
        "unsharp=5:5:0.35:5:5:0,"
        "vignette=angle=PI/6"
    )


# ---------------------------------------------------------------- música

SR = 48000


def efectos(dur, eventos):
    """Pista de efectos sutiles generados (sin derechos). eventos: [(tipo, t, extra)]."""
    rng = np.random.default_rng(7)
    pista = np.zeros(int((dur + 1) * SR))

    def poner(sonido, t, gan):
        i = int(t * SR)
        j = min(len(pista), i + len(sonido))
        if 0 <= i < j:
            pista[i:j] += gan * sonido[:j - i]

    def suavizar(x, n):
        return np.convolve(x, np.ones(n) / n, mode="same")

    for tipo, t, extra in eventos:
        if tipo == "pop":
            u = np.arange(int(0.11 * SR)) / SR
            f = 900 * np.exp(-u * 18) + 260
            fase = 2 * np.pi * np.cumsum(f) / SR
            poner(np.sin(fase) * np.exp(-u * 38) * (1 - np.exp(-u * 900)), t, 0.32)
        elif tipo == "whoosh":
            n = int(0.45 * SR)
            u = np.arange(n) / n
            ruido = suavizar(rng.standard_normal(n), 14) - suavizar(rng.standard_normal(n), 90)
            env = np.sin(np.pi * u) ** 2.2
            poner(ruido * env, t - 0.22, 0.3)
        elif tipo == "tecleo":
            for k in range(extra):
                n = int(0.012 * SR)
                clic = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.002 * SR))
                poner(suavizar(clic, 3), t + 0.65 * k / max(extra, 1), 0.2)
    return pista[:int(dur * SR)]


def escribir_wav(ruta, mono):
    mono = np.clip(mono, -1, 1)
    est = np.stack([mono, mono], 1)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((est * 32767).astype("<i2").tobytes())


def musica(dur, sr=SR):
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
    return mezcla / (np.max(np.abs(mezcla)) + 1e-9)


# ---------------------------------------------------------------- montaje

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True, help="carpeta con los vídeos originales")
    ap.add_argument("--salida", default=".")
    ap.add_argument("--musica", action="store_true",
                    help="genera además una versión con música suave de fondo")
    ap.add_argument("--volumen-musica", type=float, default=0.08,
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

    dur_total = t

    lista = os.path.join(tmp, "lista.txt")
    with open(lista, "w") as f:
        f.writelines(f"file '{p}'\n" for p in piezas)
    base = os.path.join(tmp, "base.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", base])

    # 4) Textos (con franja si el fondo es claro), destellos entre bloques y música.
    ass = os.path.join(tmp, "textos.ass")
    for tm in tomas:
        maquetar(tm)
        tm["_franja"] = necesita_franja(tm)
    escribir_ass(ass, tomas, dur_total)
    eventos = []
    for tm in tomas:
        if tm.get("precio"):
            eventos.append(("pop", tm["_t0"] + 0.3, None))
        if tm.get("maquina"):
            eventos.append(("tecleo", tm["_t0"], len(tm["rotulo"].replace("*", ""))))

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
        eventos.append(("whoosh", c, None))
    sfx = efectos(dur_total, eventos)
    wav = os.path.join(tmp, "efectos.wav")
    escribir_wav(wav, sfx)
    filtro += (
        f"[{previo}]subtitles='{ass}':fontsdir='{FUENTES_TIPO}',format=yuv420p[v]"
    )
    os.makedirs(args.salida, exist_ok=True)
    final = os.path.join(args.salida, cfg["salida"] + ".mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", base, "-i", wav,
         "-filter_complex", filtro, "-map", "[v]", "-map", "1:a",
         "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-maxrate", "6500k", "-bufsize", "13000k",
         "-profile:v", "high",
         "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-movflags", "+faststart", "-t", f"{dur_total:.3f}", final])

    salidas = [final]
    if args.musica:
        con = os.path.join(args.salida, cfg["salida"] + "-con-musica.mp4")
        wav2 = os.path.join(tmp, "mezcla.wav")
        escribir_wav(wav2, sfx + args.volumen_musica * musica(dur_total)[:len(sfx)])
        run(["ffmpeg", "-v", "error", "-y", "-i", final, "-i", wav2, "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", con])
        salidas.append(con)

    for tm in tomas:
        print(f"{tm['_t0']:5.2f}s {tm['archivo']} zoom={1 / tm['_crop'][2]:.2f} "
              f"subs_y={tm['_sub_top']} recuadro_y={tm['_caja'][0]} franja={tm['_franja']}", file=sys.stderr)
    shutil.rmtree(tmp)
    print("\n".join(salidas))


if __name__ == "__main__":
    main()
