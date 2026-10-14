#!/usr/bin/env python3
"""Montaje dinámico sin voz (Reels / TikTok de Osana): cortes rápidos al ritmo,
zooms en movimiento, destellos de luz en los cortes y recuadros de texto con el
estilo Osana. El vídeo sale sin audio: la música o la voz en off se ponen al
publicar.

Uso:
    python3 tools/reels/montaje_dinamico.py tools/reels/montaje-laser-shr-hombre.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Cada toma de la tabla: archivo, inicio (s del original), dur (s en el vídeo final),
velocidad (1 = normal, 2 = el doble de rápido), zoom (1 = plano completo),
centro_x / centro_y (0–1), mov («in», «out», «punch» o «none»), rotulo
(texto del recuadro, *palabra* en dorado), maquina (efecto máquina de escribir)
y posicion («arriba» o abajo por defecto).

Con "modo": "limpio" en la tabla (montajes de tratamiento para su Instagram, como
montaje-laser-piernas-1.json): cortes secos sin destellos ni textos, cada toma
estabilizada (solo el temblor fino) y con su color igualado con la sábana y la piel.
Opcionales: "estabilizar" (true), "suavizado" (3 fotogramas) y "color_objetivo"
(cambia los valores de COLOR_LIMPIO); por toma, "estabilizar" y "suavizado".
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_reel as br  # noqa: E402  (reutiliza color, textos y caché del estilo Osana)

W, H, FPS = br.W, br.H, br.FPS
SUPER = (1620, 2880)          # resolución intermedia: el zoom animado no «tiembla»
VERSION_TOMA = 1


def dimensiones(ruta):
    """Ancho y alto tal como se ve el vídeo (teniendo en cuenta la rotación del móvil)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:stream_side_data=rotation", "-of", "json", ruta],
        capture_output=True, text=True, check=True).stdout
    d = json.loads(out)["streams"][0]
    w, h = d["width"], d["height"]
    rot = next((int(sd["rotation"]) for sd in d.get("side_data_list", []) if "rotation" in sd), 0)
    return (h, w) if abs(rot) % 180 == 90 else (w, h)


def recorte(dim, zoom, cx, cy):
    """Recorte 9:16 en píxeles del original; vale para vídeos verticales y horizontales."""
    w, h = dim
    if w / h > 9 / 16:
        ch = h / zoom
        cw = ch * 9 / 16
    else:
        cw = w / zoom
        ch = cw * 16 / 9
    x = min(max(cx * w - cw / 2, 0), w - cw)
    y = min(max(cy * h - ch / 2, 0), h - ch)
    par = lambda v: int(v) // 2 * 2  # noqa: E731
    return par(cw), par(ch), par(x), par(y)


def zoom_animado(mov, n, fuerza=0.08):
    """Expresión de zoompan: «in» acerca despacio, «out» se aleja, «punch» golpe de zoom
    suave. «fuerza» es cuánto se acerca en total (0,08 = un 8 %)."""
    n = max(n, 1)
    return {
        "in": f"1+{fuerza}*on/{n}",
        "out": f"{1 + fuerza}-{fuerza}*on/{n}",
        "punch": f"1+{fuerza * 1.5}*exp(-on/5)+{fuerza / 2}*on/{n}",
    }.get(mov, "1")


# ------------------------------------------------------------ modo «limpio»
# Montajes de tratamiento para su Instagram («modo": "limpio" en la tabla): cortes secos,
# sin destellos añadidos ni textos. Cada toma se estabiliza (sin bordes negros) y se
# iguala de color por separado, con la sábana blanca y la piel como referencia, para que
# todas parezcan grabadas con la misma cámara y la misma luz.

ANALISIS_W = 360          # copia pequeña para medir movimiento, destellos y color
NITIDEZ_EXTRA = 1.18      # la imagen intermedia es un 18 % mayor que la salida: el
                          # reencuadre final reduce un poco y la imagen queda nítida
VERSION_LIMPIO = 1
# El iPhone ya quita el temblor grande; aquí solo se suaviza el temblor fino (gaussiana de
# 3 fotogramas). Con más (12) el encuadre «flota» y se pelea con los movimientos de cámara
# hechos a propósito (paneos que aceleran o se paran).
SUAVIZADO = 3
ETIQUETAS_709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                 "-color_range", "tv"]
COLOR_LIMPIO = {
    "sabana": [1.0, 0.985],     # R/G y B/G de la sábana: blanco limpio, apenas cálido
    "piel": [1.31, 1.80],       # R/G y R/B de la piel: tostado natural, como sus referencias
    "luz_sabana": 0.85,         # luma de la sábana (0–1): blanca y luminosa sin quemarse
    "luz_piel": 0.585,          # luma media de la piel
    "peso_sabana": 0.65,        # cuánto manda la sábana frente a la piel en el balance
    "saturacion": 1.06,         # un punto de viveza (menos en lo ya saturado)
    "nitidez": 0.3,             # máscara de enfoque suave tras el reescalado
}


def decodificar(ruta, inicio, n, velocidad, w, h):
    """ffmpeg que entrega n fotogramas RGB de w×h desde «inicio» (bt709 bien convertido)."""
    return ["ffmpeg", "-v", "error", "-ss", f"{inicio:.3f}", "-i", ruta, "-frames:v", str(n), "-an",
            "-vf", f"setpts=PTS/{velocidad},fps={FPS},scale={w}:{h}:flags=area:"
                   "in_color_matrix=bt709:in_range=tv,format=rgb24",
            "-f", "rawvideo", "-"]


def destellos_laser(fr):
    """Fotogramas con el destello rojo del láser (uno de cada tres mientras dispara)."""
    rojo = (fr[..., 0].astype(np.float32) - fr[..., 1]).mean(axis=(1, 2))
    med = np.array([np.median(rojo[max(0, f - 4):f + 5]) for f in range(len(rojo))])
    return (rojo - med) > 12


def movimiento(grises, malos):
    """Movimiento de cámara entre fotogramas (dx, dy, giro, log-escala), medido con puntos
    seguidos sobre la imagen; en los destellos no se mide: se reparte el salto entre los
    fotogramas buenos de alrededor."""
    import cv2
    n = len(grises)
    h, w = grises[0].shape
    c = np.float32([w / 2, h / 2])

    def paso(a, b):
        p0 = cv2.goodFeaturesToTrack(grises[a], 400, 0.01, 8, blockSize=7)
        if p0 is None or len(p0) < 25:
            return None
        p1, st, _ = cv2.calcOpticalFlowPyrLK(grises[a], grises[b], p0, None, winSize=(21, 21), maxLevel=3)
        ok = st.ravel() == 1
        if ok.sum() < 25:
            return None
        m, dentro = cv2.estimateAffinePartial2D(p0[ok].reshape(-1, 2) - c, p1[ok].reshape(-1, 2) - c,
                                                method=cv2.RANSAC, ransacReprojThreshold=1.0)
        if m is None or dentro.sum() < 20:
            return None
        return np.array([m[0, 2], m[1, 2], np.arctan2(m[1, 0], m[0, 0]), np.log(np.hypot(m[0, 0], m[1, 0]))])

    pasos = np.full((n, 4), np.nan)
    pasos[0] = 0
    buenos = [f for f in range(n) if not malos[f]]
    for a, b in zip(buenos, buenos[1:]):
        r = paso(a, b)
        if r is not None:
            pasos[a + 1:b + 1] = r / (b - a)
    idx = np.arange(n)
    for k in range(4):
        col = pasos[:, k]
        mal = np.isnan(col)
        col[mal] = np.interp(idx[mal], idx[~mal], col[~mal]) if (~mal).any() else 0
    return pasos


def suavizar(x, sigma):
    """Gaussiana que respeta los paneos: en los bordes se prolonga la recta, no se refleja."""
    n = len(x)
    if n < 3 or sigma <= 0:
        return x.copy()
    m = int(3 * sigma)
    k = min(10, n - 1)
    ini = x[0] - (x[k] - x[0]) / k * np.arange(m, 0, -1)
    fin = x[-1] + (x[-1] - x[-1 - k]) / k * np.arange(1, m + 1)
    t = np.arange(-m, m + 1)
    g = np.exp(-0.5 * (t / sigma) ** 2)
    return np.convolve(np.concatenate([ini, x, fin]), g / g.sum(), mode="same")[m:m + n]


def zoom_por_fotograma(mov, n, fuerza):
    t = np.arange(n) / max(n - 1, 1)
    return {"in": 1 + fuerza * t, "out": 1 + fuerza * (1 - t),
            "punch": 1 + fuerza * 1.5 * np.exp(-np.arange(n) / 5) + fuerza / 2 * t}.get(mov, np.ones(n))


def medir_color(fr, malos):
    """Color medio (0–1) de la sábana blanca y de la piel en los fotogramas sin destello;
    None si apenas se ven."""
    x = fr[~malos] if (~malos).any() else fr
    x = x[::max(1, len(x) // 12)].astype(np.float32) / 255
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    luz = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = (x.max(-1) - x.min(-1)) / (x.max(-1) + 1e-3)
    m_sab = (luz > 0.58) & (sat < 0.12)
    m_piel = (r > g) & (g > b) & (sat > 0.15) & (sat < 0.6) & (luz > 0.22) & (luz < 0.86) & (r - g < 0.28)
    return (x[m_sab].mean(0) if m_sab.mean() > 0.03 else None,
            x[m_piel].mean(0) if m_piel.mean() > 0.05 else None)


def curva_monotona(xs, ys, x):
    """Interpolación cúbica monótona (Fritsch–Carlson): la curva nunca rebota."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.concatenate([[d[0]], np.where(d[:-1] * d[1:] > 0, (d[:-1] + d[1:]) / 2, 0), [d[-1]]])
    for k in range(len(d)):
        if d[k] == 0:
            m[k] = m[k + 1] = 0
            continue
        a, b = m[k] / d[k], m[k + 1] / d[k]
        if a * a + b * b > 9:
            t = 3 / np.sqrt(a * a + b * b)
            m[k], m[k + 1] = t * a * d[k], t * b * d[k]
    i = np.clip(np.searchsorted(xs, x) - 1, 0, len(h) - 1)
    t = (x - xs[i]) / h[i]
    return ((2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h[i] * m[i]
            + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h[i] * m[i + 1])


def color_limpio(sab, piel, obj):
    """Receta de color de una toma: ganancias RGB y puntos de la curva de luz."""
    luma = lambda c: float(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])  # noqa: E731
    log_g = np.zeros(3)
    if sab is not None:
        w = obj["peso_sabana"] if piel is not None else 1.0
        log_g[0] += w * (np.log(obj["sabana"][0]) - np.log(sab[0] / sab[1]))
        log_g[2] += w * (np.log(obj["sabana"][1]) - np.log(sab[2] / sab[1]))
    if piel is not None:
        w = 1 - obj["peso_sabana"] if sab is not None else 0.8
        log_g[0] += w * (np.log(obj["piel"][0]) - np.log(piel[0] / piel[1]))
        log_g[2] += w * (np.log(obj["piel"][0] / obj["piel"][1]) - np.log(piel[2] / piel[1]))
    gan = np.clip(np.exp(log_g), 0.85, 1.18)
    gan /= 0.2126 * gan[0] + 0.7152 * gan[1] + 0.0722 * gan[2]   # el gris medio no cambia de luz
    # Curva de luz: la piel y la sábana a su sitio (con topes para no forzar la imagen).
    puntos = [(0.0, 0.0)]
    if piel is not None:
        xp = luma(piel * gan)
        puntos.append((xp, float(np.clip(obj["luz_piel"], xp - 0.06, xp + 0.06))))
    if sab is not None:
        xs = luma(sab * gan)
        ys = float(np.clip(obj["luz_sabana"], xs - 0.04, min(xs + 0.1, 0.92)))
        if xs > puntos[-1][0] + 0.08 and ys > puntos[-1][1] + 0.05:
            puntos.append((xs, ys))
    puntos.append((1.0, 1.0))
    return gan, puntos


def escribir_lut(ruta, gan, puntos, obj, n=33):
    """LUT 3D (.cube) de la toma: balance, curva de luz y el acabado común a todas
    (algo de contraste, un punto de viveza y luces que no se queman)."""
    v = np.linspace(0, 1, n)
    b, g, r = np.meshgrid(v, v, v, indexing="ij")     # en .cube el rojo cambia más rápido
    rgb = np.stack([r, g, b], -1).reshape(-1, 3) * gan
    y = rgb @ np.array([0.2126, 0.7152, 0.0722])
    xs, ys = zip(*puntos)
    y2 = curva_monotona(xs, ys, np.clip(y, 0, 1))
    # acabado: contraste suave (sombras un poco más hondas, luces más limpias)
    y2 = curva_monotona([0, 0.1, 0.5, 0.9, 1], [0, 0.085, 0.5, 0.915, 1], np.clip(y2, 0, 1))
    rgb = rgb * (y2 / np.maximum(y, 1e-4))[:, None]
    sat = (rgb.max(1) - rgb.min(1)) / np.maximum(rgb.max(1), 1e-4)
    s = 1 + (obj["saturacion"] - 1) * (1 - np.clip(sat, 0, 1))
    rgb = y2[:, None] + (rgb - y2[:, None]) * s[:, None]
    # luces: si un canal se sale, se acerca al blanco en vez de cortarse en seco
    exceso = rgb.max(1)
    k = np.where(exceso > 1, (1 - y2) / np.maximum(exceso - y2, 1e-4), 1.0)
    rgb = y2[:, None] + (rgb - y2[:, None]) * np.clip(k, 0, 1)[:, None]
    rgb = np.clip(rgb, 0, 1)
    with open(ruta, "w") as f:
        f.write(f"LUT_3D_SIZE {n}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n")
        f.writelines(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n" for p in rgb)


def toma_limpia(tm, ruta, dim, n, salida, cfg, tmp):
    """Una toma en modo limpio: estabilizada, reencuadrada y con su color igualado."""
    import cv2
    v = tm.get("velocidad", 1.0)
    z = tm.get("zoom", 1.15)
    cw, ch, x0, y0 = recorte(dim, z, tm.get("centro_x", 0.5), tm.get("centro_y", 0.5))
    r = min(1.0, W / cw * NITIDEZ_EXTRA)
    wi, hi = int(round(dim[0] * r / 2)) * 2, int(round(dim[1] * r / 2)) * 2
    centro = np.array([(x0 + cw / 2) * wi / dim[0], (y0 + ch / 2) * hi / dim[1]])
    q = cw * (wi / dim[0]) / W                      # px de la imagen intermedia por px de salida

    aw = ANALISIS_W
    ah = int(round(aw * dim[1] / dim[0] / 2)) * 2
    raw = subprocess.run(decodificar(ruta, tm["inicio"], n, v, aw, ah), capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, ah, aw, 3)
    if len(fr) < n:
        fr = np.concatenate([fr, np.repeat(fr[-1:], n - len(fr), 0)])
    malos = destellos_laser(fr)

    corr = np.zeros((n, 4))
    if tm.get("estabilizar", cfg.get("estabilizar", True)):
        pasos = movimiento([cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) for f in fr], malos)
        tray = np.cumsum(pasos, 0)
        sigma = tm.get("suavizado", cfg.get("suavizado", SUAVIZADO))
        corr = tray - np.stack([suavizar(tray[:, k], sigma) for k in range(4)], 1)
        corr[:, :2] *= wi / aw
    za = zoom_por_fotograma(tm.get("mov", "none"), n, cfg.get("zoom_mov", 0.04))

    def matrices(lam):
        ms = []
        for f in range(n):
            th = lam * corr[f, 2]
            s = q * np.exp(lam * corr[f, 3]) / za[f]
            a, b = s * np.cos(th), s * np.sin(th)
            cx, cy = centro + lam * corr[f, :2]
            ms.append(np.array([[a, -b, cx - a * W / 2 + b * H / 2], [b, a, cy - b * W / 2 - a * H / 2]]))
        return ms

    esquinas = np.array([[0, 0, 1], [W - 1, 0, 1], [0, H - 1, 1], [W - 1, H - 1, 1]], float).T

    def dentro(ms):
        return all((p := m @ esquinas)[0].min() >= 0 and p[1].min() >= 0
                   and p[0].max() <= wi - 1 and p[1].max() <= hi - 1 for m in ms)

    # Estabilización tan fuerte como deje el margen del encuadre (nunca bordes negros).
    lam, bajo, alto = 1.0, 0.0, 1.0
    if not dentro(matrices(1.0)):
        for _ in range(12):
            lam = (bajo + alto) / 2
            bajo, alto = (lam, alto) if dentro(matrices(lam)) else (bajo, lam)
        lam = bajo
    ms = matrices(lam)

    obj = {**COLOR_LIMPIO, **cfg.get("color_objetivo", {})}
    sab, piel = medir_color(fr, malos)
    gan, puntos = color_limpio(sab, piel, obj)
    lut = os.path.join(tmp, os.path.basename(salida) + ".cube")
    escribir_lut(lut, gan, puntos, obj)
    print(f"  {tm['archivo']} {tm['inicio']:.2f}+{n / FPS:.2f}s: "
          f"{f'estabilización {lam:.0%}' if corr.any() else 'sin estabilizar'}, "
          f"destellos {int(malos.sum())}, ganancias {np.round(gan, 3)}, "
          f"luz {[(round(a, 2), round(b, 2)) for a, b in puntos[1:-1]]}", file=sys.stderr)

    dec = subprocess.Popen(decodificar(ruta, tm["inicio"], n, v, wi, hi), stdout=subprocess.PIPE)
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-",
         "-vf", f"lut3d=file='{lut}':interp=tetrahedral,scale=out_color_matrix=bt709:out_range=tv,"
                f"format=yuv420p,unsharp=5:5:{obj['nitidez']}:5:5:0",
         "-c:v", "libx264", "-preset", "fast", "-crf", "8", *ETIQUETAS_709, salida],
        stdin=subprocess.PIPE)
    tam = wi * hi * 3
    ultimo = None
    try:
        for f in range(n):
            buf = dec.stdout.read(tam)
            if len(buf) == tam:
                ultimo = np.frombuffer(buf, np.uint8).reshape(hi, wi, 3)
            elif ultimo is None:
                raise RuntimeError(f"no se pudo leer {tm['archivo']} en {tm['inicio']} s")
            # si el clip se acaba antes, se repite su último fotograma
            enc.stdin.write(cv2.warpAffine(ultimo, ms[f], (W, H), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP,
                                           borderMode=cv2.BORDER_REFLECT).tobytes())
    except BaseException:
        dec.kill()
        enc.kill()
        raise
    enc.stdin.close()
    dec.stdout.close()
    if enc.wait() or dec.wait():
        raise RuntimeError(f"falló la toma {tm['archivo']} {tm['inicio']}")


def escribir_ass(ruta, tomas, texto_cfg=None):
    tc = texto_cfg or {}
    fs = tc.get("tamano", br.F_ROT)                 # tamaño de letra del recuadro
    lh = int(fs * 1.2)
    max_chars = tc.get("max_letras", br.ROT_MAX_CHARS)
    alfa_caja = tc.get("alfa_caja", br.CAJA_ALFA)  # &H00& opaco … &HFF& transparente
    pad_x, pad_y = int(br.PAD_X * fs / br.F_ROT), int(br.PAD_Y * fs / br.F_ROT)
    cab = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Rotulo,Montserrat ExtraBold,{fs},{br.BLANCO},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,8,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    # Un recuadro dura mientras las tomas seguidas tengan el mismo texto (sin parpadeos).
    grupos = []
    for tm in tomas:
        if tm.get("rotulo") and grupos and grupos[-1]["rotulo"] == tm["rotulo"]:
            grupos[-1]["b"] = tm["_t1"]
        elif tm.get("rotulo"):
            grupos.append({"rotulo": tm["rotulo"], "a": tm["_t0"], "b": tm["_t1"],
                           "maquina": tm.get("maquina"), "posicion": tm.get("posicion")})
    for g in grupos:
        lineas = br.partir(g["rotulo"].upper(), max_chars)
        alto = 2 * pad_y + len(lineas) * lh
        ancho = int(min(W - 60, max(2 * pad_x + max(br.ancho_texto(l, fs) for l in lineas), 360)))
        top = int(H * 0.2) if g["posicion"] == "arriba" else br.LIMITE_INF - alto
        x0 = (W - ancho) // 2
        a, b = g["a"], g["b"]
        entrada = r"\fad(100,0)\fscx108\fscy108\t(0,140,\fscx100\fscy100)"
        ev.append(f"Dialogue: 3,{br.ts(a)},{br.ts(b)},Rotulo,,0,0,0,,"
                  + r"{\an7\pos(" + f"{x0},{top}" + r")\p1\bord0\shad0\blur1\1c&H000000&\1a"
                  + alfa_caja + r"\fad(100,0)}" + br.rect_redondeado(ancho, alto, int(br.RADIO * fs / br.F_ROT)))
        texto = br.dorar(r"\N".join(lineas), br.BLANCO)
        if g["maquina"]:
            ev += br.con_sombra(4, a, b, "Rotulo", 540, top + pad_y, "", br.maquina(texto))
        else:
            ev += br.con_sombra(4, a, b, "Rotulo", 540, top + pad_y, entrada, texto)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cab + "\n".join(ev) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True)
    ap.add_argument("--salida", default=".")
    ap.add_argument("--cache")
    ap.add_argument("--sin-texto", action="store_true",
                    help="sin recuadros de texto (para su Instagram: el mensaje va en el pie del Reel); "
                         "los destellos se quedan donde cambiaba el texto")
    args = ap.parse_args()

    cfg = json.load(open(args.tabla, encoding="utf-8"))
    tomas = cfg["tomas"]
    tmp = tempfile.mkdtemp(prefix="montaje-")
    cache = args.cache or os.path.join(args.salida, ".cache-reel")
    os.makedirs(cache, exist_ok=True)
    reloj = [("inicio", time.time())]

    # 1) Color por clip. En primeros planos de piel no hay pared blanca de referencia:
    #    se lleva el tono medio de cada clip a una piel natural común (proporciones R/G y
    #    R/B), con un 75 % de fuerza para no enfriarla de más. Así todos los clips casan
    #    y la piel no sale naranja.
    #    En modo limpio no: ahí el color se iguala toma a toma (ver toma_limpia).
    limpio = cfg.get("modo") == "limpio"
    obj = cfg.get("piel", {"r_g": 1.18, "r_b": 1.42, "fuerza": 0.75})
    dims, receta = {}, {}
    for archivo in sorted({tm["archivo"] for tm in tomas}):
        ruta = os.path.join(args.fuentes, archivo)
        dims[archivo] = dimensiones(ruta)
        if limpio:
            continue
        instantes = [tm["inicio"] for tm in tomas if tm["archivo"] == archivo][:6]
        imgs = br.en_paralelo(lambda t: br.fotograma(ruta, t), instantes, hilos=3)
        r, g, b = np.mean([im[..., ::-1].reshape(-1, 3).mean(0) for im in imgs], 0)
        gan = np.array([obj["r_g"] * g / r, 1.0, (obj["r_g"] * g / obj["r_b"]) / b])
        gan = np.clip(1 + obj["fuerza"] * (gan - 1), 0.85, 1.2)
        gan /= (0.299 * gan[0] * r + 0.587 * g + 0.114 * gan[2] * b) / (0.299 * r + 0.587 * g + 0.114 * b)
        print(f"{archivo}: ganancias RGB {np.round(gan, 3)}", file=sys.stderr)
        receta[archivo] = br.correccion(gan, None)
    reloj.append(("color", time.time()))

    # 2) Tomas: velocidad, recorte 9:16, zoom animado y color (en paralelo y con caché).
    piezas, trabajos, t = [], [], 0.0
    for tm in tomas:
        n = round(tm["dur"] * FPS)
        tm["_t0"], tm["_t1"] = t, t + n / FPS
        t += n / FPS
        if limpio:
            datos = {k: v for k, v in tm.items() if not k.startswith("_") and k != "nota"}
            out = os.path.join(cache, "limpia_" + br.huella(
                "limpia", VERSION_LIMPIO, datos, n, COLOR_LIMPIO, cfg.get("color_objetivo", {}),
                cfg.get("estabilizar", True), cfg.get("suavizado", SUAVIZADO), cfg.get("zoom_mov", 0.04)) + ".mp4")
            piezas.append(out)
            if not os.path.exists(out):
                trabajos.append(("limpia", tm, n, out))
            continue
        cw, ch, x, y = recorte(dims[tm["archivo"]], tm.get("zoom", 1.0),
                               tm.get("centro_x", 0.5), tm.get("centro_y", 0.5))
        vf = (f"setpts=PTS/{tm.get('velocidad', 1.0)},fps={FPS},crop={cw}:{ch}:{x}:{y},"
              f"scale={SUPER[0]}:{SUPER[1]}:flags=lanczos,"
              f"zoompan=z='{zoom_animado(tm.get('mov', 'in'), n, cfg.get('zoom_mov', 0.08))}':x='iw/2-(iw/zoom/2)':"
              f"y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},"
              f"{receta[tm['archivo']]},setsar=1,format=yuv420p")
        out = os.path.join(cache, "dinamica_" + br.huella("dinamica", VERSION_TOMA, tm["archivo"],
                                                            round(tm["inicio"], 3), n, vf) + ".mp4")
        piezas.append(out)
        if not os.path.exists(out):
            trabajos.append(("ffmpeg", ["ffmpeg", "-v", "error", "-y", "-ss", f"{tm['inicio']:.3f}",
                              "-i", os.path.join(args.fuentes, tm["archivo"]),
                              "-frames:v", str(n), "-an", "-vf", vf,
                              "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", out + ".tmp.mp4"], out))

    def ejecutar(trabajo):
        if trabajo[0] == "limpia":
            _, tm, n, destino = trabajo
            toma_limpia(tm, os.path.join(args.fuentes, tm["archivo"]), dims[tm["archivo"]], n,
                        destino + ".tmp.mp4", cfg, tmp)
            os.replace(destino + ".tmp.mp4", destino)
        else:
            _, cmd, destino = trabajo
            br.run(cmd)
            os.replace(cmd[-1], destino)
    print(f"Tomas: {len(piezas)} ({len(piezas) - len(trabajos)} reutilizadas)", file=sys.stderr)
    br.en_paralelo(ejecutar, trabajos, hilos=3)
    dur_total = t
    reloj.append(("tomas", time.time()))

    lista = os.path.join(tmp, "lista.txt")
    with open(lista, "w") as f:
        f.writelines(f"file '{p}'\n" for p in piezas)
    base = os.path.join(tmp, "base.mp4")
    br.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", base])

    os.makedirs(args.salida, exist_ok=True)
    if limpio:
        # Cortes secos, sin destellos ni textos: solo la codificación final.
        final = os.path.join(args.salida, cfg["salida"] + ".mp4")
        tasa = int(min(9000, 27e6 * 8 / dur_total / 1000 - 100))
        br.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-an",
                "-c:v", "libx264", "-preset", "slow", "-crf", "16",
                "-maxrate", f"{tasa}k", "-bufsize", f"{2 * tasa}k", "-profile:v", "high",
                "-pix_fmt", "yuv420p", "-r", str(FPS), *ETIQUETAS_709, "-movflags", "+faststart",
                "-t", f"{dur_total:.3f}", final])
        reloj.append(("final", time.time()))
        print("Tiempos: " + ", ".join(f"{n} {t1 - t0:.0f} s" for (_, t0), (n, t1) in zip(reloj, reloj[1:])),
              file=sys.stderr)
        shutil.rmtree(tmp)
        print(final)
        return

    # 3) Destellos en los cortes (subida muy rápida y bajada suave) y recuadros de texto.
    d = cfg.get("destellos", {})
    dur_f, alfa = d.get("duracion", 0.16), d.get("alfa", 0.85)
    colores = d.get("colores", ["0xFFFFFF", "0xFFE4C4"])
    if d.get("solo_al_cambiar_texto"):
        cortes = [0.0] + [tm["_t0"] for prev, tm in zip(tomas, tomas[1:])
                          if tm.get("rotulo") != prev.get("rotulo") or tm.get("destello")]
    else:
        cortes = [0.0] + [tm["_t0"] for tm in tomas[1:] if tm.get("destello", True)]
    filtro, previo = "", "0:v"
    for k, c in enumerate(cortes):
        subida = 0.0 if c == 0 else 0.04
        filtro += (
            f"color=c={colores[k % len(colores)]}@{alfa}:s={W}x{H}:r={FPS}:d={subida + dur_f:.3f},format=rgba,"
            + (f"fade=in:st=0:d={subida}:alpha=1," if subida else "")
            + f"fade=out:st={subida}:d={dur_f}:alpha=1,setpts=PTS+{max(c - subida, 0):.3f}/TB[f{k}];"
            f"[{previo}][f{k}]overlay=eof_action=pass:format=auto[v{k}];")
        previo = f"v{k}"
    if args.sin_texto:
        filtro += f"[{previo}]format=yuv420p[v]"
    else:
        ass = os.path.join(tmp, "textos.ass")
        escribir_ass(ass, tomas, cfg.get("texto"))
        filtro += f"[{previo}]subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}',format=yuv420p[v]"

    final = os.path.join(args.salida, cfg["salida"] + ("-sin-texto" if args.sin_texto else "") + ".mp4")
    tasa = int(min(8000, 27e6 * 8 / dur_total / 1000 - 100))
    br.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-filter_complex", filtro, "-map", "[v]", "-an",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-maxrate", f"{tasa}k", "-bufsize", f"{2 * tasa}k", "-profile:v", "high",
            "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart",
            "-t", f"{dur_total:.3f}", final])
    reloj.append(("final", time.time()))
    print("Tiempos: " + ", ".join(f"{n} {t1 - t0:.0f} s" for (_, t0), (n, t1) in zip(reloj, reloj[1:])),
          file=sys.stderr)
    shutil.rmtree(tmp)
    print(final)


if __name__ == "__main__":
    main()
