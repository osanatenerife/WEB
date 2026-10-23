#!/usr/bin/env python3
"""Formato 1 · Entrevista de Osana: la serie «Te lo cuento» (una pregunta, un clip) y
cualquier vídeo de ella hablando a cámara. Es un formato fijo (ver «Formatos fijos» en
ESTILO.md): letra, tamaños, colores y posiciones no se cambian salvo que ella lo pida.

Uso:
    python3 tools/reels/te_lo_cuento.py tools/reels/te-lo-cuento-c1-p1.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Estilo natural (lo que pidió la dueña tras ver la primera versión y sus referencias):
  - La luz tal cual se grabó: sin filtro de color, sin contraste ni nitidez añadidos
    (el filtro le blanqueaba la piel y oscurecía los ojos).
    Con «"color": "suave"» en la tabla, el ajuste suave que ella aprobó (COLOR_SUAVE).
  - Sin etiqueta de serie ni capítulo (eso va, si acaso, en el pie de foto).
  - La pregunta aparece y desaparece rápido, solo al inicio, en el silencio antes de
    responder: mayúsculas espaciadas en Raleway SemiBold (la letra de la web) y en el
    marrón de la marca, sobre la cortina, a la izquierda de la cara (en blanco si el
    fondo de detrás es oscuro y el marrón no se leería).
  - Se quitan las pausas largas. En cada corte el encuadre alterna plano abierto y
    plano cerrado (dos cámaras); los planos largos se parten en dos encuadres sin
    cortar el audio. La frase clave va algo más cerca, sin rótulo.
  - Subtítulos pequeños en mayúsculas espaciadas, blancos, de 2 o 3 palabras, al
    ritmo de la voz y a la altura del pecho.
  - Al final, «osana.es» pequeño y centrado debajo de las últimas palabras.
  - Dientes: con la luz cálida salían amarillentos o con manchas; se igualan las
    manchas al tono de sus dientes, solo dentro de la boca (dientes.py).
  - Ningún corte con los ojos a medio cerrar: cada inicio y final de plano se mueve
    unos fotogramas hasta uno con los ojos abiertos (gestos.py), sin comerse la voz;
    si el parpadeo coincide con la última palabra, se congela el último fotograma bueno.
  - Voz natural (sin reducción de ruido), compresión ligera y -14 LUFS. Sin música:
    la pone ella al publicar.

Tabla (JSON):
    archivo     vídeo de la entrevista (en --fuentes)
    pregunta    (opcional) pregunta o título del inicio; «|» separa líneas
    color_pregunta  (opcional) "marron" o "blanco"; si no se pone, se elige según el fondo
    intro       (opcional) segundo del original donde empieza el silencio de la pregunta
                (termina donde empieza la primera frase); si no, se empieza con la voz
    fin         (opcional) segundo del original donde acaba el último plano
    portada     (opcional) segundo del original para la portada del Reel
    frases      [{inicio, fin, texto}] en orden: inicio y fin de la voz (s del
                original) y el texto exacto para los subtítulos. Opcionales:
                «clave» (frase importante: plano más cerrado), «unir» (no cortar
                la pausa de antes), «corte_inicio» / «corte_fin» (punto exacto de
                corte cuando la palabra de al lado no se quiere), «archivo» (la
                frase sale de otro vídeo: un guion grabado en varias tomas) e
                «imagenes» (imágenes de apoyo, ver abajo).

Imágenes de apoyo (el formato de su guía de contenidos; plantilla
piel-despues-del-verano.json): pantalla partida. Cuando nombra un caso, su imagen entra
en la mitad de abajo, difuminada por arriba; se queda hasta que la tapa la siguiente
(si llega pronto) o hasta poco después de acabar la frase, y la de la última frase (la
llamada a la acción) hasta el final. Con imágenes, la cara sube lo justo para que la
barbilla quede por encima de los subtítulos, que van en el centro; la pregunta del
inicio va centrada en una tarjeta crema abajo (tarjetas/fondo.png), con la misma letra y
color. Cada imagen de una frase: {"desde": "palabra"} y además
    "tarjeta": "calima"   tarjeta de la marca (tarjetas/calima.png, de tarjetas.py), o
    "foto": "calima.jpg", "zoom": z, "centro_x", "centro_y", "acercar": 0.05
                          una foto real del caso (en --fuentes): suya, de sus clientas con
                          permiso o de un banco de imágenes libre para uso comercial, o
    "video": "IMG_6368.mov", "inicio": s, "fin": s, "zoom": z, "centro_x", "centro_y"
                          un plano de otro vídeo suyo (por ejemplo, la cabina vacía);
                          «fin»: hasta dónde vale el plano (antes de que entre alguien).
Las tarjetas con iconos no gustaron («horribles»): los casos van con fotos reales, como en
sus referencias. Las tarjetas quedan solo para el fondo crema de la pregunta.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from functools import lru_cache

import cv2
import numpy as np
from PIL import ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_reel as br  # noqa: E402  (reutiliza análisis de cara, voz y caché)
import dientes as dt  # noqa: E402  (blanqueado natural de dientes)
import gestos as gs  # noqa: E402  (ojos y boca en cada fotograma)

W, H, FPS = br.W, br.H, br.FPS
VERSION_TOMA = 3
# «"color": "suave"» en la tabla: el ajuste que aprobó la dueña (octubre de 2026) para
# grabaciones con la pared clara: algo más de contraste y color, bordes apenas oscurecidos
# y sin tono cálido añadido (con más saturación o un viraje cálido la piel sale naranja).
COLOR_SUAVE = "eq=contrast=1.08:saturation=1.18:gamma=0.98,vignette=PI/8"
# «"color": "golden"»: menos amarillo y algo más oscuro y contrastado, como las cuentas
# de referencia (@goldenbrows_). En prueba con IMG_7041 (octubre de 2026).
COLOR_GOLDEN = ("colorbalance=rs=-0.02:bs=0.05:gm=-0.04:bm=0.06:bh=0.03,"
                "eq=contrast=1.15:brightness=0.0:saturation=1.08:gamma=0.97,vignette=PI/6")
# «"color": "natural"» (el que eligió el 22 de octubre de 2026): su piel tal cual, solo un poco
# más de color y contraste; nada de amarillo, viraje ni bordes oscuros (el «golden» con la piel
# igualada la dejaba «demasiado amarilla, como filtro»).
COLOR_NATURAL = "eq=saturation=1.12:contrast=1.05"
COLORES = {"suave": COLOR_SUAVE, "golden": COLOR_GOLDEN, "natural": COLOR_NATURAL}
# Para que todos los vídeos tengan el mismo tono, antes del ajuste de color se iguala la piel
# de cada grabación a la de la prueba aprobada (IMG_7041), un 5 % más clara (la pidió
# «un poquito menos oscura»). Mediana RGB de mejillas y frente.
PIEL_OBJETIVO = (231.0, 157.0, 117.0)
# Con «natural», la piel de referencia es la de IMG_7049 sin tocar (la que eligió).
PIELES = {"golden": PIEL_OBJETIVO, "natural": (200.0, 139.0, 111.0)}


def ganancias_piel(ruta, tiempos, objetivo=PIEL_OBJETIVO):
    """Ganancias R, G, B que llevan la piel de esta grabación a PIEL_OBJETIVO."""
    vals = []
    for t in tiempos:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", ruta, "-frames:v", "1",
                              "-vf", "scale=1080:1920", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                             capture_output=True).stdout
        if len(raw) < 1080 * 1920 * 3:
            continue
        img = np.frombuffer(raw, np.uint8).reshape(1920, 1080, 3)
        c = dt.caja_cara(img)
        if c is None:
            continue
        x, y, w, h = c.astype(int)
        zona = img[y + int(.30 * h):y + int(.62 * h), x + int(.22 * w):x + int(.78 * w)]
        vals.append(np.median(zona.reshape(-1, 3).astype(float), 0)[::-1])
    if not vals:
        return (1.0, 1.0, 1.0)
    med = np.median(vals, 0)
    # El brillo se iguala del todo (0,9-1,12); el color, solo un poco (±4 %): en otra sala o con
    # otra luz la piel «objetivo» no vale y forzarla la dejaba roja o amarilla.
    luma = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    brillo = float(np.clip(luma(objetivo) / luma(med), 0.9, 1.12))
    color = [float(np.clip((o / luma(objetivo)) / (m / luma(med)), 0.96, 1.04)) for o, m in zip(objetivo, med)]
    return tuple(brillo * c for c in color)

# ---------------------------------------------------------------- tiempos
PRE, POST = 0.12, 0.28      # aire antes de hablar / después de la última sílaba
PAUSA_MAX = 0.55            # las pausas más largas se quitan (salto de encuadre)
PAUSA_CORTA, FRASE_MIN = 0.8, 1.3  # …salvo que el corte deje un trozo de menos de 1,3 s
PLANO_MAX = 5.2             # planos más largos: dos encuadres sin cortar el audio
FINAL_EXTRA = 0.45          # aire tras la última frase (o «fin» en la tabla)
PREGUNTA_MIN, PREGUNTA_MAX = 2.0, 2.8   # la pregunta se ve solo al inicio, poco rato
OSANA_ES = 1.8              # segundos finales con «osana.es» debajo de los subtítulos

# ---------------------------------------------------------------- encuadres
# «pregunta»: el primer plano, algo cerrado y desplazado para dejar libre a la
# izquierda la cortina donde aparece la pregunta.
ZOOM = {"pregunta": 1.14, "abierto": 1.0, "cerrado": 1.14, "clave": 1.22}

# ---------------------------------------------------------------- imágenes de apoyo
# Pantalla partida: ella arriba, la imagen en la mitad de abajo y los subtítulos en el
# centro, entre las dos. La cara sube lo justo para que la barbilla quede encima de los
# subtítulos; abierto, cerrado y clave guardan entre sí la misma proporción de siempre.
TARJETAS = os.path.join(br.AQUI, "tarjetas")
H_IMAGEN = H // 2           # la mitad de abajo
FUNDIDO_IMAGEN = 260        # px difuminados en el borde de arriba de la imagen
Y_SUB_IMAGENES = 905        # con imágenes, subtítulos en el centro (debajo de la barbilla)
BARBILLA_IMAGENES = 880     # px: la barbilla, como mucho aquí (25 px por encima de los subtítulos)
Y_PREGUNTA_IMAGENES = 1390  # con imágenes, la pregunta va centrada en una tarjeta crema abajo (fuera del pie de Instagram)
IMAGEN_MIN, IMAGEN_COLA = 1.2, 0.3   # s: lo mínimo que se ve una imagen; lo que sigue tras la frase
IMAGEN_HUECO = 3.0          # s: si la siguiente imagen llega antes, esta se queda hasta que la tape
IMAGEN_HUECO_CORTE = 1.0    # …o este, si entre las dos hay un corte (otra toma, otro tema)
CUBRE = 0.45                # s que la imagen anterior sigue debajo de la nueva (sin ver el hueco)

# ---------------------------------------------------------------- tipografía
# Colores de la marca (logo y web de Osana): marrón y crema. Nada de dorado.
MARRON = "&H3C5A6E&"        # #6E5A3C: el marrón de la marca algo más oscuro, para leerse sobre la cortina clara
BLANCO = "&HFFFFFF&"
SOMBRA, SOMBRA_ALFA = "&H000000&", "&HA6&"   # negro al 35 %, muy suave
X0 = 72                     # margen izquierdo de la pregunta
Y_PREGUNTA = 330            # justo por debajo del 15 % superior
FS_PREGUNTA_MAX, ESP_PREGUNTA = 104, 0.06    # espaciado entre letras, en fracción del tamaño
FS_SUB, ESP_SUB = 56, 0.16
SUB_MAX_PALABRAS, SUB_MAX_LETRAS = 3, 18
FS_WEB, ESP_WEB = 44, 0.14
Y_SUB = 1300                # subtítulos a la altura del pecho
LUZ_MARRON = 0.6            # fondo de la pregunta más oscuro que esto: en blanco

# Fuente ASS → (archivo, factor ancho libass / Pillow)
FUENTES = {
    "Raleway SemiBold": ("Raleway-600.ttf", 0.717),
}


@lru_cache(maxsize=None)
def _pil(archivo):
    return ImageFont.truetype(os.path.join(br.FUENTES_TIPO, archivo), 100)


def ancho(texto, fuente, fs, espaciado=0.0):
    """Ancho en píxeles de pantalla de un texto tal como lo dibuja libass."""
    archivo, k = FUENTES[fuente]
    return _pil(archivo).getlength(texto) * k * fs / 100 + espaciado * len(texto)


def ev(capa, t0, t1, tags, texto):
    return f"Dialogue: {capa},{br.ts(t0)},{br.ts(t1)},Base,,0,0,0,,{{{tags}}}{texto}"


def con_sombra(capa, t0, t1, x, y, tags, texto, an=8):
    """Texto blanco con una sombra negra suave debajo (capa aparte, desenfocada)."""
    return [ev(capa, t0, t1, rf"\an{an}\pos({x},{y + 4})\bord0\shad0\blur7\1c{SOMBRA}\1a{SOMBRA_ALFA}" + tags, texto),
            ev(capa + 1, t0, t1, rf"\an{an}\pos({x},{y})\bord0\shad0\1c{BLANCO}" + tags, texto)]


def cabecera_ass():
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,Raleway SemiBold,{FS_SUB},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


# ---------------------------------------------------------------- planificación

def segmentos_y_planos(cfg):
    """Agrupa las frases en tramos de audio continuo (se cortan las pausas largas) y
    los tramos en planos (cambios de encuadre). Devuelve la lista de planos."""
    frases = cfg["frases"]
    # 1) Tramos de audio continuo (nunca entre dos vídeos distintos).
    tramos = [[frases[0]]]
    for previa, f in zip(frases, frases[1:]):
        hueco = f["inicio"] - previa["fin"]
        corto = min(previa["fin"] - previa["inicio"], f["fin"] - f["inicio"]) < FRASE_MIN
        seguido = (f.get("unir") or hueco <= PAUSA_MAX or (hueco <= PAUSA_CORTA and corto))
        mismo = archivo_de(cfg, f) == archivo_de(cfg, previa) and 0 <= hueco
        if seguido and mismo and "corte_fin" not in previa and "corte_inicio" not in f:
            tramos[-1].append(f)
        else:
            tramos.append([f])
    planos = []
    for n, tramo in enumerate(tramos):
        a = tramo[0].get("corte_inicio", tramo[0]["inicio"] - PRE)
        if n == 0:
            a = cfg.get("intro", a)
        ultimo = n == len(tramos) - 1
        b = tramo[-1].get("corte_fin", tramo[-1]["fin"] + (FINAL_EXTRA + POST if ultimo else POST))
        if ultimo and "fin" in cfg:
            b = cfg["fin"]          # el último plano termina en una mirada bonita, no en un parpadeo
        a, b = round(a * FPS) / FPS, round(b * FPS) / FPS
        # 2) Planos dentro del tramo: se parte en las pausas internas.
        limites = [a]
        for k, (p, f) in enumerate(zip(tramo, tramo[1:])):
            corte = round((p["fin"] + f["inicio"]) / 2 * FPS) / FPS
            # La frase clave va en su propio plano; la primera frase del clip cierra
            # el plano de la pregunta.
            if f.get("clave") or p.get("clave") or (n == 0 and k == 0):
                limites.append(corte)
        limites.append(b)
        for x, y in zip(limites, limites[1:]):
            fr = [f for f in tramo if x - 0.05 <= (f["inicio"] + f["fin"]) / 2 <= y + 0.05]
            planos.append(dict(inicio=x, fin=y, tramo=n, frases=fr, archivo=archivo_de(cfg, tramo[0]),
                               clave=any(f.get("clave") for f in fr)))
    return planos


def archivo_de(cfg, frase):
    """Vídeo del que sale la frase (el de la tabla, salvo que la frase diga otro)."""
    return frase.get("archivo", cfg["archivo"])


def vecina(cfg, frase, paso):
    """La frase de antes (paso -1) o de después (+1) en la tabla, solo si es del mismo
    vídeo y le sigue en el original; si no, None (no se sabe qué se dijo alrededor)."""
    frases = cfg["frases"]
    i = frases.index(frase) + paso
    if not 0 <= i < len(frases) or archivo_de(cfg, frases[i]) != archivo_de(cfg, frase):
        return None
    return frases[i]


def partir_largos(planos, fuentes):
    """Planos de más de PLANO_MAX s: se parten (sin cortar el audio) en la pausa entre
    frases más cercana a la mitad o, si es una sola frase, en el instante más
    silencioso cerca de la mitad."""
    out = []
    pendientes = list(planos)
    while pendientes:
        p = pendientes.pop(0)
        dur = p["fin"] - p["inicio"]
        if dur <= PLANO_MAX or p["clave"]:
            out.append(p)
            continue
        mitad = (p["inicio"] + p["fin"]) / 2
        candidatos = [(f["fin"] + g["inicio"]) / 2 for f, g in zip(p["frases"], p["frases"][1:])
                      if p["inicio"] + 1.5 < (f["fin"] + g["inicio"]) / 2 < p["fin"] - 1.5]
        if candidatos:
            corte = min(candidatos, key=lambda c: abs(c - mitad))
        else:
            a, b = p["inicio"] + dur * 0.38, p["inicio"] + dur * 0.62
            e = br.energia_voz(os.path.join(fuentes, p["archivo"]), a, b)
            e = np.convolve(e, np.ones(5) / 5, "same")
            corte = a + int(np.argmin(e[3:-3]) + 3) * 0.02
        corte = round(corte * FPS) / FPS
        izq = dict(p, fin=corte, frases=[f for f in p["frases"] if f["inicio"] < corte])
        der = dict(p, inicio=corte, frases=[f for f in p["frases"] if f["fin"] > corte])
        pendientes[:0] = [izq, der]
    return out


def tipos_de_plano(planos, pregunta=True):
    """Abierto / cerrado alternos (dos cámaras); la frase clave, más cerrada."""
    previo = None
    for i, p in enumerate(planos):
        if i == 0 and pregunta:
            p["tipo"] = "pregunta"
        elif p["clave"]:
            p["tipo"] = "clave"
        elif previo != "abierto":
            p["tipo"] = "abierto"
        else:
            p["tipo"] = "cerrado"
        previo = p["tipo"]


def encuadre(p, imagenes=False):
    """Recorte del plano: ojos en el tercio superior. El de la pregunta, anclado arriba a
    la izquierda para dejar la cortina libre junto a la cara. Con imágenes de apoyo, la
    barbilla por encima de los subtítulos del centro (ver BARBILLA_IMAGENES)."""
    c = p["_cara"]
    z = ZOOM[p["tipo"]]
    # La caja de Haar acaba en la barbilla (la «barbilla» de build_reel deja margen de cuello).
    menton = c["cy"] + 0.55 * c["alto"]
    if imagenes:
        z_min = max(1.0, (1 - BARBILLA_IMAGENES / H) / max(1 - menton, 0.05))
        z = z_min * ZOOM[p["tipo"]] / ZOOM["abierto"]
    cw = ch = 1 / z
    x0 = min(max(c["cx"] - cw / 2, 0), 1 - cw)
    y0 = c["cy"] - 0.30 * ch
    if imagenes:
        y0 = menton - BARBILLA_IMAGENES / H * ch
    elif p["tipo"] == "pregunta":
        x0 = y0 = 0.0
    y0 = min(max(y0, 0), 1 - ch)
    p["_menton_px"] = (menton - y0) / ch * H
    p["_crop"] = (x0, y0, cw, ch)
    # Borde izquierdo de la cara con margen para el pelo (la caja de Haar es cuadrada).
    p["_cara_izq_px"] = (c["cx"] - c["alto"] * H / W * 0.55 - x0) / cw * W
    p["_cabeza_px"] = (c["cabeza"] - y0) / ch * H


def filtro_plano(p, congelar=True):
    """Solo encuadre: la luz y el color, tal como se grabaron. Con «inicio_imagen», los
    primeros fotogramas repiten el primero bueno (la voz ya ha empezado y un parpadeo
    acaba justo en el corte); con «fin_imagen», los últimos repiten el último bueno (la
    voz sigue hasta acabar la palabra)."""
    x0, y0, cw, ch = p["_crop"]
    vf = (f"crop=iw*{cw:.5f}:ih*{ch:.5f}:iw*{x0:.5f}:ih*{y0:.5f},"
          f"scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1,format=yuv420p")
    if p.get("_color"):
        if p.get("_ganancias"):
            gr, gg, gb = p["_ganancias"]
            vf += f",colorchannelmixer=rr={gr:.3f}:gg={gg:.3f}:bb={gb:.3f}"
        vf += "," + COLORES[p["_color"]]
    if not congelar:
        return vf
    n = round((p["fin"] - p["inicio"]) * FPS)
    if p.get("inicio_imagen"):
        quietos = round((p["inicio_imagen"] - p["inicio"]) * FPS)
        if 0 < quietos < n:
            vf += f",trim=start_frame={quietos},setpts=PTS-STARTPTS,tpad=start_mode=clone:start={quietos}"
    if p.get("fin_imagen"):
        visibles = round((p["fin_imagen"] - p["inicio"]) * FPS)
        if 0 < visibles < n:
            vf += f",trim=end_frame={visibles},tpad=stop_mode=clone:stop={n - visibles}"
    return vf


def pulir_cortes(planos, cfg, gestos):
    """Que ningún corte caiga en un parpadeo. Cada inicio de tramo se mueve (sin pasar
    del comienzo de la voz) hasta un fotograma con los ojos abiertos; cada final, hasta
    uno bueno sin cortar la última palabra (si no lo hay, se congela el último bueno);
    y los cambios de encuadre dentro de una frase, a un punto sin parpadeo.
    «gestos»: {archivo: Gestos} (un detector por vídeo)."""
    k = lambda t: int(round(t * FPS))  # noqa: E731
    g = None

    def bien(a, b, umbral=gs.OJOS_MAL):
        return all(v[0] <= umbral for v in g.tramo(a / FPS, b / FPS).values())
    cambios = []
    for i, p in enumerate(planos):
        g = gestos[p["archivo"]]
        previo = planos[i - 1] if i else None
        siguiente = planos[i + 1] if i + 1 < len(planos) else None
        # Inicio de tramo (entra la voz): más tarde, nunca después de empezar a hablar.
        if previo is None or previo["tramo"] != p["tramo"]:
            s0 = k(p["inicio"])
            voz = k(p["frases"][0]["inicio"]) - (6 if i == 0 else 1)
            fijo = i == 0 or "corte_inicio" in p["frases"][0]
            # Si parpadea justo antes de hablar, se empieza un poco antes, aún en silencio
            # (hasta 0,4 s y nunca dentro de la frase anterior). Si la frase anterior de la
            # tabla es de otro vídeo, no se sabe qué se dijo antes: no se adelanta.
            previa_f = vecina(cfg, p["frases"][0], -1)
            antes = previa_f["fin"] if previa_f else None
            otra = previa_f is None and cfg["frases"].index(p["frases"][0]) > 0
            if fijo or otra:
                minimo = s0
            else:
                minimo = max(s0 - 12, k(antes + 0.08) if antes is not None and antes < p["inicio"] else s0 - 12)
            candidatos = sorted(range(minimo, max(voz, s0) + 1), key=lambda c: (c < s0, abs(c - s0)))
            nuevo = next((c for c in candidatos if bien(c, c + 3)), s0)
            if nuevo != s0:
                cambios.append(f"inicio {p['inicio']:.2f} → {nuevo / FPS:.2f}")
                p["inicio"] = nuevo / FPS
            elif not bien(s0, s0 + 3):
                # Empieza a hablar justo en el corte y un parpadeo acaba ahí: las primeras
                # imágenes repiten el primer fotograma bueno (como mucho 5, ≈0,17 s, para que
                # no se note la boca quieta) en vez de enseñar los ojos a medio abrir.
                bueno = next((c for c in range(s0 + 1, s0 + 6) if bien(c, c + 3, gs.OJOS_BIEN)),
                             next((c for c in range(s0 + 1, s0 + 6) if bien(c, c + 3)), None))
                if bueno is not None:
                    p["inicio_imagen"] = bueno / FPS
                    cambios.append(f"inicio {s0 / FPS:.2f}: imagen congelada hasta {bueno / FPS:.2f}")
                else:
                    cambios.append(f"inicio {s0 / FPS:.2f}: ojos a medio cerrar sin arreglo automático (revisar)")
        # Final de tramo (acaba la voz): sin comerse la última palabra.
        if siguiente is None or siguiente["tramo"] != p["tramo"]:
            e0 = k(p["fin"])
            fin_voz = p["frases"][-1]["fin"]
            voz = k(fin_voz + 0.06)
            fijo = siguiente is None and "fin" in cfg or "corte_fin" in p["frases"][-1]
            # Hasta 0,3 s más de pausa, sin llegar a la frase siguiente del original (si la
            # siguiente de la tabla es de otro vídeo, no se alarga).
            siguiente_f = vecina(cfg, p["frases"][-1], +1)
            despues = siguiente_f["inicio"] if siguiente_f else None
            otra = siguiente_f is None and cfg["frases"].index(p["frases"][-1]) + 1 < len(cfg["frases"])
            if fijo or otra:
                maximo = e0
            else:
                maximo = min(e0 + 9, k(despues - 0.1) if despues and despues > fin_voz else e0 + 9)
            # La última imagen del clip se queda en la retina: ahí, ojos bien abiertos.
            umbral = 0.15 if siguiente is None else gs.OJOS_MAL
            candidatos = sorted(range(min(voz, e0), max(maximo, min(voz, e0)) + 1), key=lambda c: (c > e0, abs(c - e0)))
            nuevo = next((c for c in candidatos if bien(c - 4, c - 1, umbral)), None)
            if nuevo is None:
                # Parpadeo justo al acabar de hablar: se congela el último fotograma bueno,
                # solo si lo congelado es ya casi silencio (si no, se notaría la boca quieta).
                bueno = next((c for c in range(min(voz, e0) - 1, min(voz, e0) - 12, -1)
                              if bien(c - 3, c, umbral)), None)
                if bueno is not None and bueno + 1 >= k(fin_voz - 0.08):
                    if not fijo:
                        p["fin"] = min(voz, e0) / FPS      # congelado lo justo para acabar la palabra
                    p["fin_imagen"] = (bueno + 1) / FPS
                    cambios.append(f"final {e0 / FPS:.2f}: imagen congelada desde {(bueno + 1) / FPS:.2f}")
                else:
                    cambios.append(f"final {e0 / FPS:.2f}: parpadeo sin arreglo automático (revisar)")
            elif nuevo != e0:
                cambios.append(f"final {p['fin']:.2f} → {nuevo / FPS:.2f}")
                p["fin"] = nuevo / FPS
        # Cambio de encuadre dentro del mismo tramo (la voz sigue): a un punto sin parpadeo.
        elif siguiente is not None and abs(siguiente["inicio"] - p["fin"]) < 1e-6:
            # Hasta 0,4 s a cada lado (al mirar hacia abajo los párpados bajan medio segundo),
            # sin dejar planos de menos de medio segundo.
            c0 = k(p["fin"])
            margen = range(max(c0 - 12, k(p["inicio"]) + 15), min(c0 + 13, k(siguiente["fin"]) - 15))
            nuevo = next((c for c in sorted(margen, key=lambda c: abs(c - c0)) if bien(c - 3, c + 2)), None)
            if nuevo is None:
                cambios.append(f"corte {p['fin']:.2f}: ojos cerrados sin arreglo automático (revisar)")
            elif nuevo != c0:
                cambios.append(f"corte {p['fin']:.2f} → {nuevo / FPS:.2f}")
                p["fin"] = siguiente["inicio"] = nuevo / FPS
    return cambios


# ---------------------------------------------------------------- textos

def grupos_subtitulo(texto):
    """Grupos de 2 o 3 palabras (cortando en la puntuación) para los subtítulos."""
    palabras = texto.split()
    grupos, actual = [], []
    for i, p in enumerate(palabras):
        if actual and (len(actual) >= SUB_MAX_PALABRAS
                       or len(" ".join(palabras[j] for j in actual + [i])) > SUB_MAX_LETRAS):
            grupos.append(actual)
            actual = []
        actual.append(i)
        if re.search(r"[.,;:?!»]$", p) and len(actual) >= 2:
            grupos.append(actual)
            actual = []
    if actual:
        if len(actual) == 1 and grupos and len(" ".join(palabras[j] for j in grupos[-1] + actual)) <= SUB_MAX_LETRAS + 4:
            grupos[-1] += actual
        else:
            grupos.append(actual)
    return palabras, grupos


def limpiar(txt):
    """Mayúsculas y sin puntuación (salvo ¿? y ¡!, y el punto de los miles), como en las
    referencias."""
    return re.sub(r"(?<!\d)[.,]|[.,](?!\d)|[;:…«»\"]", "", txt).upper()


def reparto(frase, ruta):
    """Palabras de la frase y cuándo empieza cada una (s del original): el texto se
    reparte por los tramos con voz según lo largas que son las palabras."""
    palabras = frase["texto"].split()
    e = br.energia_voz(ruta, frase["inicio"], frase["fin"])
    voz = np.where(e > max(e.max() - 28, -42))[0]

    def largo(p):
        # Lo que se tarda en decirla: «70%» se dice «setenta por ciento»; «20.000», «veinte mil».
        if not re.search(r"\d", p):
            return len(p)
        letras = len(re.sub(r"[\d.,%]", "", p)) + 10 * p.count("%")
        for numero in re.findall(r"\d+(?:[.,]\d{3})*", p):
            grupos = re.split(r"[.,]", numero)
            letras += 3 * len(grupos[0]) + 4 * (len(grupos) - 1)
        return letras
    pesos = np.array([largo(p) + 3 for p in palabras], float)
    acum = np.concatenate([[0], np.cumsum(pesos)]) / pesos.sum()

    def instante(f):
        if len(voz) < 5:
            return frase["inicio"] + f * (frase["fin"] - frase["inicio"])
        return frase["inicio"] + voz[min(int(f * len(voz)), len(voz) - 1)] * 0.02
    return palabras, acum, instante


def subtitulos(frase, ruta, a_salida):
    """[(texto, t0, t1)] en tiempo de salida: palabras repartidas por los tramos con voz."""
    palabras, grupos = grupos_subtitulo(frase["texto"])
    _, acum, instante = reparto(frase, ruta)

    out = []
    for k, g in enumerate(grupos):
        t0 = instante(acum[g[0]]) - 0.05
        t1 = instante(acum[grupos[k + 1][0]]) - 0.05 if k + 1 < len(grupos) else frase["fin"] + 0.15
        out.append((limpiar(" ".join(palabras[j] for j in g)), a_salida(t0), a_salida(t1)))
    return out


def _normal(palabra):
    return re.sub(r"[^\wáéíóúüñ]", "", palabra.lower())


def hay_imagenes(cfg):
    return any(f.get("imagenes") for f in cfg["frases"])


def tiempo_pregunta(cfg, p0):
    """Cuándo se ve la pregunta (s del vídeo final): desde el principio, en el silencio
    antes de responder y un poco más (entre PREGUNTA_MIN y PREGUNTA_MAX)."""
    dur_intro = p0["_a_salida"](cfg["frases"][0]["inicio"]) - p0["_t0"]
    return p0["_t0"] + 0.1, min(p0["_t1"], max(PREGUNTA_MIN, min(PREGUNTA_MAX, dur_intro + 1.0)))


def imagenes_de_apoyo(cfg, planos, dur_video):
    """Cuándo entra y sale cada imagen de apoyo (s del vídeo final), en orden. La
    pregunta va primero, en su tarjeta crema; cada imagen entra con su palabra «desde»
    (nunca antes de que acabe la pregunta) y se queda hasta que la tapa la siguiente si
    esta llega pronto (IMAGEN_HUECO) o, si no, hasta poco después de acabar la frase. La
    de la última frase (la llamada a la acción) se queda hasta el final."""
    if not hay_imagenes(cfg):
        return []
    eventos, fin_pregunta = [], 0.0
    if cfg.get("pregunta"):
        t0, fin_pregunta = tiempo_pregunta(cfg, planos[0])
        eventos.append(dict(spec={"tarjeta": "fondo", "desde": "(pregunta)"}, n=-1, t0=t0,
                            fin_frase=fin_pregunta - IMAGEN_COLA, tramo=planos[0]["tramo"], pregunta=True))
    ultima = len(cfg["frases"]) - 1
    for n, frase in enumerate(cfg["frases"]):
        if not frase.get("imagenes"):
            continue
        p = next(q for q in planos if frase in q["frases"])
        palabras, acum, instante = reparto(frase, p["_ruta"])
        for im in frase["imagenes"]:
            t = frase["inicio"]
            if im.get("desde"):
                i = next((j for j, w in enumerate(palabras) if _normal(w).startswith(_normal(im["desde"]))), None)
                if i is None:
                    raise ValueError(f"«{im['desde']}» no está en la frase «{frase['texto']}»")
                t = instante(acum[i]) - 0.08
            q = next((q for q in planos if frase in q["frases"] and q["inicio"] - 0.05 <= t <= q["fin"] + 0.05), p)
            eventos.append(dict(spec=im, n=n, t0=max(0.0, q["_a_salida"](t), fin_pregunta - 0.15),
                                fin_frase=q["_a_salida"](frase["fin"]), tramo=q["tramo"]))
    eventos.sort(key=lambda e: e["t0"])
    for a, b in zip(eventos, eventos[1:] + [None]):
        fin = max(a["fin_frase"] + IMAGEN_COLA, a["t0"] + IMAGEN_MIN)
        if a["n"] == ultima:
            fin = dur_video
        elif b is not None and (b["t0"] < fin or (not a.get("pregunta") and b["t0"] - fin <= (
                IMAGEN_HUECO if b["tramo"] == a["tramo"] else IMAGEN_HUECO_CORTE))):
            fin = b["t0"] + CUBRE           # la siguiente entra encima: sin hueco entre las dos
        sp = a["spec"]
        if "video" in sp and "fin" in sp:   # el plano de recurso no da para más
            fin = min(fin, a["t0"] + sp["fin"] - sp.get("inicio", 0.0))
        a["t1"] = min(fin, dur_video)
        a["hasta_el_final"] = a["t1"] >= dur_video - 1e-3
    for a, b in zip(eventos, eventos[1:]):
        b["tapa"] = a["t1"] > b["t0"]       # entra encima de otra: se funde en el sitio
    return eventos


def filtros_imagenes(eventos, fuentes, primera_entrada):
    """Entradas de ffmpeg y cadena de filtros que superponen las imágenes de apoyo en la
    mitad de abajo: difuminadas por arriba, con un fundido corto y un leve deslizamiento
    al entrar. Devuelve (argumentos, filtros, etiqueta de salida)."""
    args, filtros, previo = [], [], "0:v"
    for k, ev in enumerate(eventos):
        sp, dur = ev["spec"], ev["t1"] - ev["t0"]
        idx = primera_entrada + k
        # Borde de arriba difuminado, suave al principio y al final (como el de las tarjetas).
        difuminado = (f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':"
                      f"a='255*(3*pow(min(1,Y/{FUNDIDO_IMAGEN}),2)-2*pow(min(1,Y/{FUNDIDO_IMAGEN}),3))'")
        cx, cy = sp.get("centro_x", 0.5), sp.get("centro_y", 0.5)
        if "tarjeta" in sp:
            # Las tarjetas ya traen el difuminado en su canal alfa (tarjetas.py).
            args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur + 0.1:.3f}",
                     "-i", os.path.join(TARJETAS, sp["tarjeta"] + ".png")]
            prep = f"[{idx}:v]scale={W}:{H_IMAGEN},format=rgba"
        elif "foto" in sp:
            # Una foto real (suya, o de un banco de imágenes libre para uso comercial): llena
            # la mitad de abajo y se acerca despacio («acercar», un 5 % en toda la imagen).
            # Se trabaja al triple de tamaño para que el acercamiento no tiemble.
            z, n = sp.get("zoom", 1.0), round((dur + 0.1) * FPS)
            args += ["-i", os.path.join(fuentes, sp["foto"])]
            prep = (f"[{idx}:v]scale={3 * W * z:.0f}:{3 * H_IMAGEN * z:.0f}:force_original_aspect_ratio=increase:"
                    f"flags=lanczos,crop={3 * W}:{3 * H_IMAGEN}:'(iw-ow)*{cx}':'(ih-oh)*{cy}',"
                    f"zoompan=z='1+{sp.get('acercar', 0.05)}*on/{n}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':"
                    f"d={n}:s={W}x{H_IMAGEN}:fps={FPS},format=rgba,{difuminado}")
        else:
            ruta = os.path.join(fuentes, sp["video"])
            z = sp.get("zoom", 1.6)
            # Recorte con la forma de la mitad de abajo (W×H_IMAGEN) en el vídeo girado.
            cw = f"iw/{z}"
            ch = f"iw/{z}*{H_IMAGEN}/{W}"
            args += ["-ss", f"{sp.get('inicio', 0.0):.3f}", "-t", f"{dur + 0.1:.3f}", "-i", ruta]
            prep = (f"[{idx}:v]crop={cw}:{ch}:'min(max(iw*{cx}-ow/2,0),iw-ow)':'min(max(ih*{cy}-oh/2,0),ih-oh)',"
                    f"scale={W}:{H_IMAGEN}:flags=lanczos,fps={FPS},format=rgba,{difuminado}")
        # La que llega hasta el final (la llamada a la acción) no se desvanece: es la última imagen.
        salida = "" if ev.get("hasta_el_final") else f"fade=out:st={max(dur - 0.22, 0):.3f}:d=0.22:alpha=1,"
        filtros.append(f"{prep},fade=in:st=0:d=0.22:alpha=1,{salida}"
                       f"setpts=PTS-STARTPTS+{ev['t0']:.3f}/TB[im{k}]")
        # Sobre el vídeo entra subiendo un poco; sobre otra imagen, en el sitio (si no, se ven
        # los dos rótulos desplazados un instante).
        y = f"{H - H_IMAGEN}" if ev.get("tapa") else f"'{H - H_IMAGEN}+36*max(0,1-(t-{ev['t0']:.3f})/0.3)'"
        filtros.append(f"[{previo}][im{k}]overlay=x=0:y={y}:eval=frame:eof_action=pass:format=auto[ov{k}]")
        previo = f"ov{k}"
    return args, filtros, previo


def maquetar_pregunta(cfg, p0):
    """Tamaño de la pregunta para que quepa en la cortina, a la izquierda de la cara
    (o a todo lo ancho, si la línea queda por encima de la cabeza)."""
    lineas = [re.sub(r"[*_]", "", l).strip().upper() for l in cfg["pregunta"].split("|")]
    limite_cara = p0["_cara_izq_px"] - 40
    for fs in range(FS_PREGUNTA_MAX, 40, -2):
        alto, y, ok = fs * 1.05, Y_PREGUNTA, True
        for l in lineas:
            libre = (W - 2 * X0) if y + alto < p0["_cabeza_px"] - 10 else limite_cara - X0
            if ancho(l, "Raleway SemiBold", fs, fs * ESP_PREGUNTA) > libre:
                ok = False
                break
            y += alto
        if ok:
            return fs, lineas
    return 40, lineas


def color_pregunta(cfg, p0, imgs):
    """Marrón de la marca sobre fondo claro (la cortina); blanco con sombra suave si lo
    de detrás es oscuro y el marrón no se leería. Devuelve (color, luz del fondo)."""
    if cfg.get("color_pregunta"):
        return {"marron": MARRON, "blanco": BLANCO}[cfg["color_pregunta"]], None
    fs, lineas = maquetar_pregunta(cfg, p0)
    x0, y0, cw, ch = p0["_crop"]
    derecha = X0 + max(ancho(l, "Raleway SemiBold", fs, fs * ESP_PREGUNTA) for l in lineas)
    abajo = Y_PREGUNTA + fs * 1.05 * len(lineas)
    # De píxeles de pantalla a los fotogramas de análisis (el original entero, AW×AH).
    xa, xb = (int((x0 + cw * x / W) * br.AW) for x in (X0, derecha))
    ya, yb = (int((y0 + ch * y / H) * br.AH) for y in (Y_PREGUNTA, abajo))
    luz = float(np.mean([cv2.cvtColor(i, cv2.COLOR_BGR2GRAY)[ya:yb, xa:xb].mean() for i in imgs])) / 255
    return (MARRON if luz >= LUZ_MARRON else BLANCO), luz


def eventos_pregunta(cfg, p0, t0, t1, fundido=True):
    """La pregunta, en el marrón de la marca (o en blanco sobre fondo oscuro): entra y
    sale con un fundido rápido."""
    fs, lineas = maquetar_pregunta(cfg, p0)
    fad = r"\fad(250,300)" if fundido else ""
    out, y = [], Y_PREGUNTA
    for l in lineas:
        if p0.get("_color_pregunta", MARRON) == BLANCO:
            out += con_sombra(4, t0, t1, X0, round(y),
                              rf"\fnRaleway SemiBold\fs{fs}\fsp{fs * ESP_PREGUNTA:.1f}" + fad, l, an=7)
        else:
            out.append(ev(4, t0, t1, rf"\an7\pos({X0},{y:.0f})\fnRaleway SemiBold\fs{fs}\fsp{fs * ESP_PREGUNTA:.1f}"
                                     rf"\bord0\shad0\1c{MARRON}" + fad, l))
        y += fs * 1.05
    return out


def eventos_pregunta_imagenes(cfg, t0, t1, fundido=True):
    """Con imágenes de apoyo, la pregunta va centrada en su tarjeta crema de la mitad de
    abajo, en el marrón de la marca, y entra con ella (fundido y el mismo deslizamiento)."""
    lineas = [re.sub(r"[*_]", "", l).strip().upper() for l in cfg["pregunta"].split("|")]
    fs = next((f for f in range(FS_PREGUNTA_MAX, 40, -2)
               if all(ancho(l, "Raleway SemiBold", f, f * ESP_PREGUNTA) <= W - 2 * X0 for l in lineas)), 40)
    alto = fs * 1.05
    y = Y_PREGUNTA_IMAGENES - alto * len(lineas) / 2
    out = []
    for l in lineas:
        pos = (rf"\move({W // 2},{y + 36:.0f},{W // 2},{y:.0f},0,300)\fad(250,300)" if fundido
               else rf"\pos({W // 2},{y:.0f})")
        out.append(ev(4, t0, t1, rf"\an8{pos}\fnRaleway SemiBold\fs{fs}\fsp{fs * ESP_PREGUNTA:.1f}"
                                 rf"\bord0\shad0\1c{MARRON}", l))
        y += alto
    return out


def escribir_ass(ruta, cfg, planos, dur_video, imagenes=False):
    eventos = []
    p0 = planos[0]
    y_sub = Y_SUB_IMAGENES if imagenes else Y_SUB
    # 1) La pregunta: solo al inicio, aparece y desaparece rápido.
    if cfg.get("pregunta"):
        t0, t_fin = tiempo_pregunta(cfg, p0)
        eventos += (eventos_pregunta_imagenes(cfg, t0, t_fin) if imagenes
                    else eventos_pregunta(cfg, p0, t0, t_fin))

    # 2) Subtítulos.
    subs = []
    for p in planos:
        a, b = p["_t0"], p["_t1"]
        for frase in p["frases"]:
            for txt, t0, t1 in subtitulos(frase, p["_ruta"], p["_a_salida"]):
                t0, t1 = max(t0, a), min(t1, b)
                if t1 - t0 >= 0.12:
                    subs.append([txt, t0, t1])
    subs.sort(key=lambda x: x[1])
    for actual, siguiente in zip(subs, subs[1:]):
        actual[2] = min(actual[2], siguiente[1])   # frases seguidas: nunca dos subtítulos a la vez
    if subs:
        subs[-1][2] = dur_video          # las últimas palabras se quedan hasta el final
    tags = rf"\fs{FS_SUB}\fsp{FS_SUB * ESP_SUB:.1f}\fad(60,0)"
    for txt, t0, t1 in subs:
        eventos += con_sombra(1, t0, t1, W // 2, y_sub, tags, txt)

    # 3) Al final, «osana.es» pequeño y centrado debajo de las últimas palabras.
    if subs:
        t0 = max(subs[-1][1], dur_video - OSANA_ES)
        eventos += con_sombra(1, t0, dur_video, W // 2, y_sub + int(FS_SUB * 1.25),
                              rf"\fs{FS_WEB}\fsp{FS_WEB * ESP_WEB:.1f}\fad(300,0)", "osana.es")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cabecera_ass() + "\n".join(eventos) + "\n")


def portada(cfg, p0, ruta, salida, imagenes=False):
    """Portada del Reel: un fotograma del plano de la pregunta, con la pregunta (con
    imágenes de apoyo, en su tarjeta crema de abajo). «portada» en la tabla = segundo
    del original con buena expresión."""
    t = cfg.get("portada", p0["inicio"])
    ass, png = salida + ".ass", salida + ".png"
    textos = []
    if cfg.get("pregunta"):
        textos = (eventos_pregunta_imagenes(cfg, 0, 5, fundido=False) if imagenes
                  else eventos_pregunta(cfg, p0, 0, 5, fundido=False))
    with open(ass, "w", encoding="utf-8") as f:
        f.write(cabecera_ass() + "\n".join(textos) + "\n")
    dt.procesar(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", ruta, "-frames:v", "1",
                 "-vf", filtro_plano(p0, congelar=False), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                 "-i", "-", png], W, H)
    textos_vf = f"subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}'"
    if imagenes and cfg.get("pregunta"):
        br.run(["ffmpeg", "-v", "error", "-y", "-i", png, "-i", os.path.join(TARJETAS, "fondo.png"),
                "-filter_complex", f"[1:v]scale={W}:{H_IMAGEN},format=rgba[t];[0:v][t]overlay=0:{H - H_IMAGEN}"
                                   f":format=rgb,{textos_vf}", "-q:v", "2", salida])   # en RGB: si no, sale grisácea
    else:
        br.run(["ffmpeg", "-v", "error", "-y", "-i", png, "-vf", textos_vf, "-q:v", "2", salida])
    os.remove(ass)
    os.remove(png)


# ---------------------------------------------------------------- montaje

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True)
    ap.add_argument("--salida", default=".")
    ap.add_argument("--cache")
    ap.add_argument("--solo-portada", action="store_true", help="genera solo la portada (JPG)")
    ap.add_argument("--sin-gestos", action="store_true",
                    help="no comprueba los ojos en los cortes (si no hay mediapipe)")
    args = ap.parse_args()

    cfg = json.load(open(args.tabla, encoding="utf-8"))
    cache = args.cache or os.path.join(args.salida, ".cache-te-lo-cuento")
    os.makedirs(cache, exist_ok=True)
    os.makedirs(args.salida, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="tlc-")
    reloj = [("inicio", time.time())]

    planos = partir_largos(segmentos_y_planos(cfg), args.fuentes)
    ganancias = {}
    if cfg.get("color") in PIELES:
        for arch in sorted({p["archivo"] for p in planos}):
            ts = [(p["inicio"] + p["fin"]) / 2 for p in planos if p["archivo"] == arch]
            ganancias[arch] = ganancias_piel(os.path.join(args.fuentes, arch), ts[:10], PIELES[cfg["color"]])
            print(f"Piel de {arch}: ganancias {tuple(round(g, 3) for g in ganancias[arch])}", file=sys.stderr)
    for p in planos:
        p["_color"] = cfg.get("color")
        p["_ganancias"] = ganancias.get(p["archivo"])
    imagenes_si = hay_imagenes(cfg)       # pantalla partida: la pregunta va en su tarjeta
    tipos_de_plano(planos, pregunta=bool(cfg.get("pregunta")) and not imagenes_si)
    if not args.sin_gestos:
        gestos = {a: gs.Gestos(os.path.join(args.fuentes, a), cache) for a in sorted({p["archivo"] for p in planos})}
        for c in pulir_cortes(planos, cfg, gestos):
            print("Ojos:", c, file=sys.stderr)
        for g in gestos.values():
            g.cerrar()
    tomas = [dict(archivo=p["archivo"], inicio=p["inicio"], fin=p["fin"]) for p in planos]
    br.en_paralelo(lambda tm: br.analizar_con_cache(tm, args.fuentes, cache), tomas, hilos=4)
    br.completar_caras(tomas)
    for p, tm in zip(planos, tomas):
        p["_cara"], p["_ruta"] = tm["_cara"], os.path.join(args.fuentes, p["archivo"])
        encuadre(p, imagenes_si)
        if imagenes_si and p["_menton_px"] > BARBILLA_IMAGENES + 5:
            print(f"Encuadre {p['inicio']:.2f}: la barbilla queda en {p['_menton_px']:.0f} px, encima de los "
                  "subtítulos (revisar)", file=sys.stderr)
    ruta = planos[0]["_ruta"]          # el vídeo del primer plano (portada)
    if cfg.get("pregunta") and not imagenes_si:
        color, luz = color_pregunta(cfg, planos[0], tomas[0]["_imgs"])
        planos[0]["_color_pregunta"] = color
        print(f"Pregunta en {'marrón' if color == MARRON else 'blanco'}"
              + (f" (luz del fondo {luz:.2f})" if luz is not None else " (fijado en la tabla)"), file=sys.stderr)
    reloj.append(("análisis", time.time()))
    portada_jpg = os.path.join(args.salida, cfg["salida"] + "-portada.jpg")
    if args.solo_portada:
        portada(cfg, planos[0], ruta, portada_jpg, imagenes_si)
        shutil.rmtree(tmp)
        return

    # Tiempos de salida y piezas.
    t, trabajos, piezas, voces = 0.0, [], [], []
    tramos = {}
    for p in planos:
        n = round((p["fin"] - p["inicio"]) * FPS)
        p["_t0"], p["_t1"] = t, t + n / FPS
        t += n / FPS
        tramos.setdefault(p["tramo"], []).append(p)
        vf = filtro_plano(p)
        out = os.path.join(cache, f"toma_{br.huella('tlc', VERSION_TOMA, dt.VERSION, p['archivo'], round(p['inicio'], 3), n, vf)}.mp4")
        piezas.append(out)
        if not os.path.exists(out):
            # Encuadre con ffmpeg → dientes en Python → codificación con ffmpeg.
            trabajos.append(("dientes",
                             ["ffmpeg", "-v", "error", "-ss", f"{p['inicio']:.3f}", "-i", p["_ruta"],
                              "-frames:v", str(n), "-an", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                             ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
                              "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                              "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p",
                              out + ".tmp.mp4"], out))
    dur_video = t
    # Voz por tramo continuo (sin microcortes dentro de un tramo).
    for k in sorted(tramos):
        ps = tramos[k]
        a = ps[0]["inicio"]
        dur = ps[-1]["_t1"] - ps[0]["_t0"]
        for p in ps:
            p["_a_salida"] = (lambda a0, s0: (lambda ts_: s0 + ts_ - a0))(a, ps[0]["_t0"])
        wv = os.path.join(cache, f"voz_{br.huella('voz', ps[0]['archivo'], round(a, 3), round(dur, 4))}.wav")
        voces.append(wv)
        if not os.path.exists(wv):
            trabajos.append(("ffmpeg",
                             ["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-i", ps[0]["_ruta"],
                              "-t", f"{dur:.4f}", "-vn", "-ac", "1", "-ar", "48000",
                              "-af", f"afade=t=in:d=0.012,afade=t=out:st={dur - 0.015:.4f}:d=0.015",
                              "-c:a", "pcm_s16le", wv + ".tmp.wav"], wv))

    def ejecutar(trabajo):
        if trabajo[0] == "dientes":
            _, lectura, escritura, destino = trabajo
            dt.procesar(lectura, escritura, W, H)
        else:
            _, cmd, destino = trabajo
            br.run(cmd)
        os.replace(trabajo[-2][-1], destino)
    print(f"Planos: {len(piezas)} ({len(piezas) - sum(1 for c in trabajos if c[0] == 'dientes')} reutilizados)",
          file=sys.stderr)
    br.en_paralelo(ejecutar, trabajos, hilos=3)
    reloj.append(("planos", time.time()))

    lista = os.path.join(tmp, "lista.txt")
    with open(lista, "w") as f:
        f.writelines(f"file '{p}'\n" for p in piezas)
    base = os.path.join(tmp, "base.mp4")
    br.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", base])

    # Voz: compresión ligera y -14 LUFS, sin reducción de ruido.
    lista_v = os.path.join(tmp, "voces.txt")
    with open(lista_v, "w") as f:
        f.writelines(f"file '{v}'\n" for v in voces)
    voz = os.path.join(tmp, "voz.wav")
    br.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista_v,
            "-af", "highpass=f=80,acompressor=threshold=-20dB:ratio=2:attack=10:release=150,"
                   "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000",
            "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", voz])

    # Imágenes de apoyo (si las hay): debajo de los textos, que siempre quedan encima.
    imagenes = imagenes_de_apoyo(cfg, planos, dur_video)
    for ev in imagenes:
        sp = ev["spec"]
        print(f"Imagen {ev['t0']:6.2f}-{ev['t1']:6.2f}s  {sp.get('tarjeta') or sp.get('video')}"
              f"  (desde «{sp.get('desde', '')}»)", file=sys.stderr)
        if ev["t1"] - ev["t0"] < 1.0:
            print(f"  ojo: se ve solo {ev['t1'] - ev['t0']:.1f} s (palabras demasiado juntas)", file=sys.stderr)
    args_im, filtros_im, salida_im = filtros_imagenes(imagenes, args.fuentes, 2)
    ass = os.path.join(tmp, "textos.ass")
    escribir_ass(ass, cfg, planos, dur_video, imagenes=imagenes_si)
    tasa = int(min(6000, 27e6 * 8 / dur_video / 1000 - 200))
    final = os.path.join(args.salida, cfg["salida"] + ".mp4")
    br.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-i", voz, *args_im,
            "-filter_complex", ";".join(filtros_im + [
                f"[{salida_im}]subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}',format=yuv420p[v]"]),
            "-map", "[v]", "-map", "1:a",
            "-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-maxrate", f"{tasa}k", "-bufsize", f"{2 * tasa}k", "-profile:v", "high",
            "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart", "-t", f"{dur_video:.3f}", final])
    portada(cfg, planos[0], ruta, portada_jpg, imagenes_si)
    reloj.append(("final", time.time()))
    print("Tiempos: " + ", ".join(f"{n} {t1 - t0:.0f} s" for (_, t0), (n, t1) in zip(reloj, reloj[1:])),
          file=sys.stderr)
    for p in planos:
        print(f"{p['_t0']:6.2f}-{p['_t1']:6.2f}s  {p['archivo']} {p['inicio']:7.2f}-{p['fin']:7.2f}  {p['tipo']:8s} "
              f"zoom={1 / p['_crop'][2]:.2f} barbilla={p['_menton_px']:.0f}px", file=sys.stderr)
    print(f"Duración: {dur_video:.1f} s", file=sys.stderr)
    shutil.rmtree(tmp)
    print(final)


if __name__ == "__main__":
    main()
