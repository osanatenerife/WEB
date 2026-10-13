#!/usr/bin/env python3
"""Clips de la serie «Te lo cuento» (la entrevista de Osana): una pregunta, un clip.

Uso:
    python3 tools/reels/te_lo_cuento.py tools/reels/te-lo-cuento-c1-p1.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Estilo (guía «OSANA · Guía de grabación y edición», parte 5, y las entrevistas de
referencia que eligió la dueña):
  - Arranca en el silencio de después de la pregunta: la pregunta aparece grande,
    palabra a palabra, en el hueco de la cortina, con letra editorial (fina, cursiva
    fina y la palabra clave en negrita dorada). Se queda mientras empieza a
    responder y en el primer corte pasa a una cabecera pequeña arriba, con la
    etiqueta de la serie, durante todo el clip.
  - Se quitan las pausas largas. En cada corte el encuadre alterna plano abierto y
    plano cerrado (dos cámaras); los planos largos se parten en dos encuadres sin
    cortar el audio.
  - Subtítulos pequeños en minúsculas, de 2 a 4 palabras, al ritmo de la voz y a la
    altura del pecho.
  - Frase clave: zoom al 122 % con los ojos en el tercio superior y rótulo en
    mayúsculas (Montserrat ExtraBold) con la palabra clave en dorado degradado;
    los subtítulos siguen debajo.
  - Cierre: el buscador con «osana.es» escribiéndose letra a letra, sin sonido.
  - Voz natural (sin reducción de ruido), compresión ligera y -14 LUFS. Sin música:
    la pone ella al publicar.

Tabla (JSON):
    archivo     vídeo de la entrevista (en --fuentes)
    serie       etiqueta pequeña de arriba, p. ej. «Te lo cuento · Capítulo 1»
    pregunta    pregunta grande del inicio: «|» separa líneas, _cursiva fina_,
                *negrita dorada*; el resto, fina
    intro       segundo del original donde empieza el silencio de la pregunta
                (termina donde empieza la primera frase)
    fin         (opcional) segundo del original donde acaba el último plano
    portada     (opcional) segundo del original para la portada del Reel
    frases      [{inicio, fin, texto}] en orden: inicio y fin de la voz (s del
                original) y el texto exacto para los subtítulos. Opcionales:
                «clave» (rótulo de la frase clave), «unir» (no cortar la pausa
                de antes), «corte_inicio» / «corte_fin» (punto exacto de corte
                cuando la palabra de al lado no se quiere).
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
from functools import lru_cache

import numpy as np
from PIL import ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_reel as br  # noqa: E402  (reutiliza análisis de cara, color, voz y caché)

W, H, FPS = br.W, br.H, br.FPS
VERSION_TOMA = 1

# ---------------------------------------------------------------- tiempos
PRE, POST = 0.12, 0.28      # aire antes de hablar / después de la última sílaba
PAUSA_MAX = 0.55            # las pausas más largas se quitan (salto de encuadre)
PAUSA_CORTA, FRASE_MIN = 0.8, 1.3  # …salvo que el corte deje un trozo de menos de 1,3 s
PLANO_MAX = 5.2             # planos más largos: dos encuadres sin cortar el audio
FINAL_EXTRA = 0.45          # aire tras la última frase, antes del buscador (o «fin» en la tabla)
BUSCADOR = 2.3              # duración del cierre con osana.es

# ---------------------------------------------------------------- encuadres
# «pregunta»: el primer plano, algo cerrado y desplazado para dejar a la izquierda la
# cortina libre donde se escribe la pregunta grande.
ZOOM = {"pregunta": 1.14, "abierto": 1.0, "cerrado": 1.14, "clave": 1.22}

# ---------------------------------------------------------------- tipografía
X0 = 72                     # margen izquierdo de la pregunta y la cabecera
Y_ETIQUETA = 296            # justo por debajo del 15 % superior
FS_ETIQUETA, FS_CABECERA = 30, 52
Y_CABECERA = Y_ETIQUETA + 40
CABECERA_FIN = Y_CABECERA + FS_CABECERA + 10   # la cabeza siempre por debajo de aquí
FS_SUB, SUB_MAX_PALABRAS, SUB_MAX_LETRAS = 60, 4, 24
FS_CLAVE_MAX = 108
LIMITE_INF = br.LIMITE_INF

BLANCO = "&H00FFFFFF&"
SOMBRA = "&H000000&"
SOMBRA_ALFA = "&H99&"       # negro al 40 %
ORO_ARRIBA, ORO_ABAJO = (0xFF, 0xE8, 0xAA), (0xD2, 0xA0, 0x50)   # dorado degradado de la guía
CREMA = "0xF4EEE6"

# Fuente ASS → (archivo, factor ancho libass / Pillow, alto de mayúscula y línea base en fs)
FUENTES = {
    ("Inter Display Light", 0): ("InterDisplay-Light.otf", 0.818, 0.20, 0.80),
    ("Inter Display Light", 1): ("InterDisplay-LightItalic.otf", 0.824, 0.20, 0.80),
    ("Inter Display Medium", 0): ("InterDisplay-Medium.otf", 0.819, 0.20, 0.80),
    ("Inter Display SemiBold", 0): ("InterDisplay-SemiBold.otf", 0.821, 0.20, 0.80),
    ("Inter Display SemiBold", 1): ("InterDisplay-SemiBoldItalic.otf", 0.822, 0.20, 0.80),
    ("Inter Display ExtraBold", 0): ("InterDisplay-ExtraBold.otf", 0.823, 0.20, 0.80),
    ("Montserrat ExtraBold", 0): ("Montserrat-800.ttf", 0.636, 0.26, 0.71),
}
ESTILOS = {   # marcas de la pregunta → (fuente, cursiva, dorado)
    "fina": ("Inter Display Light", 0, False),
    "cursiva": ("Inter Display Light", 1, False),
    "oro": ("Inter Display ExtraBold", 0, True),
    "etiqueta": ("Inter Display SemiBold", 0, False),
    "cab": ("Inter Display SemiBold", 0, False),          # cabecera: más gruesa, se lee en pequeño
    "cab_cursiva": ("Inter Display SemiBold", 1, False),
    "rotulo": ("Montserrat ExtraBold", 0, False),
    "rotulo_oro": ("Montserrat ExtraBold", 0, True),
}


@lru_cache(maxsize=None)
def _pil(archivo):
    return ImageFont.truetype(os.path.join(br.FUENTES_TIPO, archivo), 100)


def ancho(texto, fuente, fs, cursiva=0, espaciado=0.0):
    """Ancho en píxeles de pantalla de un texto tal como lo dibuja libass."""
    archivo, k = FUENTES[(fuente, cursiva)][:2]
    return _pil(archivo).getlength(texto) * k * fs / 100 + espaciado * len(texto)


def color_ass(rgb):
    r, g, b = rgb
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def oro(f):
    """Color del degradado dorado a la altura f (0 arriba, 1 abajo)."""
    return color_ass(tuple(round(a + (b - a) * f) for a, b in zip(ORO_ARRIBA, ORO_ABAJO)))


def trozos(linea):
    """«¿por qué _abriste_ *OSANA?*» → [(texto, estilo)]."""
    out = []
    for m in re.finditer(r"\*([^*]+)\*|_([^_]+)_|([^*_]+)", linea):
        if m.group(1):
            out.append((m.group(1), "oro"))
        elif m.group(2):
            out.append((m.group(2), "cursiva"))
        else:
            out.append((m.group(3), "fina"))   # también los espacios entre trozos
    return out


def ancho_linea(partes, fs, espaciado=0.0):
    return sum(ancho(t, ESTILOS[e][0], fs, ESTILOS[e][1], espaciado) for t, e in partes)


def texto_ass(partes, color_oro, color_base=BLANCO, aparicion=None, sombra=False, alfa_final=None):
    """Línea con su tipografía mixta. aparicion: (inicio_ms, paso_ms, fundido_ms) para que
    las palabras entren una a una. Con sombra=True, todo negro (capa de sombra)."""
    out, k = [], 0
    for texto, estilo in partes:
        fuente, cursiva, dorado = ESTILOS[estilo]
        color = SOMBRA if sombra else (color_oro if dorado else color_base)
        out.append(r"{\fn" + fuente + rf"\i{cursiva}\c{color}" + "}")
        for palabra in re.split(r"(\s+)", texto):
            if not palabra:
                continue
            if palabra.isspace() or aparicion is None:
                out.append(palabra)
                continue
            t0 = aparicion[0] + aparicion[1] * k
            final = alfa_final or (SOMBRA_ALFA if sombra else "&H00&")
            out.append(r"{\alpha&HFF&\t(" + f"{t0},{t0 + aparicion[2]}" + r",\alpha" + final + ")}" + palabra)
            k += 1
    return "".join(out)


def ev(capa, t0, t1, tags, texto):
    return f"Dialogue: {capa},{br.ts(t0)},{br.ts(t1)},Base,,0,0,0,,{{{tags}}}{texto}"


def linea_dorada(capa, t0, t1, x, y, fs, partes, tags="", aparicion=None, bandas=10, an=7, base=BLANCO,
                 sombra=True, halo=False):
    """Línea con la palabra clave en dorado degradado (de #FFE8AA arriba a #D2A050
    abajo): libass no hace degradados, así que se dibuja en bandas horizontales con
    \\clip, cada una con su tono. Debajo, la sombra negra suave al 40 %."""
    fuente0 = ESTILOS[partes[0][1]][0] if partes else "Inter Display Light"
    _, _, alto_may, linea_base = FUENTES[(fuente0, 0)]
    out = []
    if halo:
        # Halo muy difuminado: oscurece un poco la cortina clara justo detrás de la letra.
        out.append(ev(capa, t0, t1, rf"\an{an}\pos({x},{y + 6})\fs{fs}\bord{fs * 0.12:.0f}\3c{SOMBRA}\shad0\blur{fs * 0.45:.0f}"
                      rf"\1a&HD0&\3a&HD0&" + tags, texto_ass(partes, SOMBRA, aparicion=aparicion, sombra=True,
                                                            alfa_final="&HD0&")))
    if sombra:
        out.append(ev(capa, t0, t1, rf"\an{an}\pos({x},{y + 5})\fs{fs}\bord0\shad0\blur9\1a{SOMBRA_ALFA}" + tags,
                      texto_ass(partes, SOMBRA, aparicion=aparicion, sombra=True)))
    if not any(ESTILOS[e][2] for _, e in partes):
        out.append(ev(capa + 1, t0, t1, rf"\an{an}\pos({x},{y})\fs{fs}\bord0\shad0" + tags,
                      texto_ass(partes, BLANCO, base, aparicion)))
        return out
    arriba, abajo = y + alto_may * fs, y + linea_base * fs
    cortes = [y - fs] + [arriba + (abajo - arriba) * k / bandas for k in range(1, bandas)] + [y + 2 * fs]
    for k in range(bandas):
        clip = rf"\clip(0,{cortes[k]:.1f},{W},{cortes[k + 1]:.1f})"
        out.append(ev(capa + 1, t0, t1, rf"\an{an}\pos({x},{y})\fs{fs}\bord0\shad0{clip}" + tags,
                      texto_ass(partes, oro((k + 0.5) / bandas), base, aparicion)))
    return out


def rect_redondeado(w, h, r):
    return br.rect_redondeado(int(w), int(h), int(r))


# ---------------------------------------------------------------- planificación

def segmentos_y_planos(cfg):
    """Agrupa las frases en tramos de audio continuo (se cortan las pausas largas) y
    los tramos en planos (cambios de encuadre). Devuelve la lista de planos."""
    frases = cfg["frases"]
    # 1) Tramos de audio continuo.
    tramos = [[frases[0]]]
    for previa, f in zip(frases, frases[1:]):
        hueco = f["inicio"] - previa["fin"]
        corto = min(previa["fin"] - previa["inicio"], f["fin"] - f["inicio"]) < FRASE_MIN
        seguido = (f.get("unir") or hueco <= PAUSA_MAX or (hueco <= PAUSA_CORTA and corto))
        if seguido and "corte_fin" not in previa and "corte_inicio" not in f:
            tramos[-1].append(f)
        else:
            tramos.append([f])
    planos = []
    for n, tramo in enumerate(tramos):
        a = tramo[0].get("corte_inicio", tramo[0]["inicio"] - PRE)
        if n == 0:
            a = cfg["intro"]
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
            # el plano de la pregunta grande.
            if f.get("clave") or p.get("clave") or (n == 0 and k == 0):
                limites.append(corte)
        limites.append(b)
        for x, y in zip(limites, limites[1:]):
            fr = [f for f in tramo if x - 0.05 <= (f["inicio"] + f["fin"]) / 2 <= y + 0.05]
            planos.append(dict(inicio=x, fin=y, tramo=n, frases=fr,
                               clave=next((f["clave"] for f in fr if f.get("clave")), None)))
    return planos


def partir_largos(planos, ruta):
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
            e = br.energia_voz(ruta, a, b)
            e = np.convolve(e, np.ones(5) / 5, "same")
            corte = a + int(np.argmin(e[3:-3]) + 3) * 0.02
        corte = round(corte * FPS) / FPS
        izq = dict(p, fin=corte, frases=[f for f in p["frases"] if f["inicio"] < corte])
        der = dict(p, inicio=corte, frases=[f for f in p["frases"] if f["fin"] > corte])
        pendientes[:0] = [izq, der]
    return out


def tipos_de_plano(planos):
    """Abierto / cerrado alternos (dos cámaras); la frase clave, más cerrada."""
    previo = None
    for i, p in enumerate(planos):
        if i == 0:
            p["tipo"] = "pregunta"
        elif p["clave"]:
            p["tipo"] = "clave"
        elif previo != "abierto":
            p["tipo"] = "abierto"
        else:
            p["tipo"] = "cerrado"
        previo = p["tipo"]


def encuadre(p):
    """Recorte del plano. En los planos con cabecera, la cabeza queda por debajo de la
    pregunta escrita; en el de la frase clave, los ojos en el tercio superior."""
    c = p["_cara"]
    z = ZOOM[p["tipo"]]
    cw = ch = 1 / z
    x0 = min(max(c["cx"] - cw / 2, 0), 1 - cw)
    y0 = c["cy"] - 0.30 * ch
    if p["tipo"] == "pregunta":
        x0 = y0 = 0.0                      # cara a la derecha, cortina libre a la izquierda
    elif p["tipo"] != "clave":
        y0 = min(y0, c["cabeza"] - (CABECERA_FIN + 30) / H * ch)
    y0 = min(max(y0, 0), 1 - ch)
    p["_crop"] = (x0, y0, cw, ch)
    p["_barbilla_px"] = (c["barbilla"] - y0) / ch * H
    p["_cara_x_px"] = (c["cx"] - x0) / cw * W
    # Borde izquierdo de la cara con margen para el pelo (la caja de Haar es cuadrada).
    p["_cara_izq_px"] = (c["cx"] - c["alto"] * H / W * 0.55 - x0) / cw * W
    p["_cabeza_px"] = (c["cabeza"] - y0) / ch * H


# ---------------------------------------------------------------- textos

def grupos_subtitulo(texto):
    """Grupos de 2 a 4 palabras (cortando en la puntuación) para los subtítulos."""
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
    """Sin punto ni coma al final del grupo (estilo subtítulo de redes)."""
    return re.sub(r"[.,;:]+$", "", txt.replace("…", ""))


def subtitulos(frase, ruta, a_salida):
    """[(texto, t0, t1)] en tiempo de salida: palabras repartidas por los tramos con voz."""
    palabras, grupos = grupos_subtitulo(frase["texto"])
    e = br.energia_voz(ruta, frase["inicio"], frase["fin"])
    voz = np.where(e > max(e.max() - 28, -42))[0]
    pesos = np.array([len(p) + 3 for p in palabras], float)
    acum = np.concatenate([[0], np.cumsum(pesos)]) / pesos.sum()

    def instante(f):
        if len(voz) < 5:
            return frase["inicio"] + f * (frase["fin"] - frase["inicio"])
        return frase["inicio"] + voz[min(int(f * len(voz)), len(voz) - 1)] * 0.02

    out = []
    for k, g in enumerate(grupos):
        t0 = instante(acum[g[0]]) - 0.05
        t1 = instante(acum[grupos[k + 1][0]]) - 0.05 if k + 1 < len(grupos) else frase["fin"] + 0.15
        out.append((limpiar(" ".join(palabras[j] for j in g)), a_salida(t0), a_salida(t1)))
    return out


def maquetar_pregunta(cfg, p0):
    """Tamaño y posición de la pregunta grande para que quepa en la cortina, a la
    izquierda de la cara y por encima de la cabeza."""
    lineas = [trozos(l) for l in cfg["pregunta"].split("|")]
    limite_cara = p0["_cara_izq_px"] - 40
    for fs in range(118, 58, -2):
        alto = fs * 0.98
        y = Y_ETIQUETA + 58
        ok = True
        for partes in lineas:
            libre = (W - 2 * X0) if y + alto < p0["_cabeza_px"] - 10 else limite_cara - X0
            if ancho_linea(partes, fs, -fs * 0.02) > libre:
                ok = False
                break
            y += alto
        if ok and y < LIMITE_INF - 300:
            return fs, lineas
    return 60, lineas


def cabecera_ass():
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,Inter Display SemiBold,{FS_SUB},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def pregunta_grande(cfg, p0, t0, t1, animada=True):
    """Eventos de la pregunta grande del primer plano (palabra a palabra si animada)."""
    eventos = []
    fs, lineas = maquetar_pregunta(cfg, p0)
    y = Y_ETIQUETA + 58
    n_palabras = 0
    for partes in lineas:
        aparicion = (250 + 120 * n_palabras, 120, 260) if animada else None
        eventos += linea_dorada(4, t0, t1, X0, int(y), fs, partes, halo=True,
                                tags=rf"\fsp{-fs * 0.02:.1f}" + (r"\fad(0,160)" if animada else ""),
                                aparicion=aparicion)
        n_palabras += sum(len(t.split()) for t, _ in partes)
        y += fs * 0.98
    return eventos


def portada(cfg, p0, ruta, receta, salida):
    """Portada del Reel: un fotograma del plano de la pregunta (con su mismo encuadre y
    color) y la pregunta completa con la etiqueta de la serie. «portada» en la tabla =
    segundo del original con buena expresión (por defecto, el inicio del silencio)."""
    t = cfg.get("portada", cfg["intro"])
    x0, y0, cw, ch = p0["_crop"]
    ass = salida + ".ass"
    with open(ass, "w", encoding="utf-8") as f:
        f.write(cabecera_ass() + "\n".join(
            linea_dorada(4, 0, 5, X0, Y_ETIQUETA, FS_ETIQUETA, [(cfg["serie"].upper(), "etiqueta")], tags=r"\fsp4")
            + pregunta_grande(cfg, p0, 0, 5, animada=False)) + "\n")
    br.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", ruta, "-frames:v", "1",
            "-vf", f"crop=iw*{cw:.5f}:ih*{ch:.5f}:iw*{x0:.5f}:ih*{y0:.5f},scale={W}:{H}:flags=lanczos,"
                   f"{receta},subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}'",
            "-q:v", "2", salida])
    os.remove(ass)


def escribir_ass(ruta, cfg, planos, dur_video):
    cab = cabecera_ass()
    eventos = []
    p0 = planos[0]
    # Etiqueta de la serie: arriba a la izquierda, todo el clip salvo en la frase clave.
    etiqueta = cfg["serie"].upper()
    # 1) Pregunta grande en el primer plano, palabra a palabra.
    eventos += pregunta_grande(cfg, p0, p0["_t0"], p0["_t1"])
    # 2) Cabecera pequeña (etiqueta + pregunta) en el resto de planos, salvo la frase clave.
    a_cabecera = {"fina": "cab", "cursiva": "cab_cursiva", "oro": "oro"}
    cabecera = [(t, a_cabecera[e]) for t, e in trozos(cfg["pregunta"].replace("|", " "))]
    fs_cab = FS_CABECERA
    while ancho_linea(cabecera, fs_cab) > W - 2 * X0 and fs_cab > 34:
        fs_cab -= 2
    tramos_cab, actual = [], None
    for p in planos:
        visible = p is not p0 and p["tipo"] != "clave"
        if visible and actual is not None and abs(actual[1] - p["_t0"]) < 1e-6:
            actual[1] = p["_t1"]
        elif visible:
            actual = [p["_t0"], p["_t1"]]
            tramos_cab.append(actual)
    tramos_etq = [[p0["_t0"], p0["_t1"]]]
    for a, b in tramos_cab:
        if abs(tramos_etq[-1][1] - a) < 1e-6:
            tramos_etq[-1][1] = b
        else:
            tramos_etq.append([a, b])
    for a, b in tramos_etq:
        fade = r"\fad(200,0)" if a > 0 else ""
        eventos += linea_dorada(4, a, b, X0, Y_ETIQUETA, FS_ETIQUETA,
                                [(etiqueta, "etiqueta")], tags=r"\fsp4" + fade)
    for a, b in tramos_cab:
        eventos += linea_dorada(4, a, b, X0, Y_CABECERA, fs_cab, cabecera, tags=r"\fad(200,0)")

    # 3) Subtítulos y rótulo de la frase clave.
    for p in planos:
        a, b = p["_t0"], p["_t1"]
        y_sub = int(min(max(p["_barbilla_px"] + 120, 1270), 1370))
        if p["tipo"] == "clave":
            partes = trozos(p["clave"].upper())
            lineas_c = partir_rotulo(partes)
            fs_c = FS_CLAVE_MAX
            while max(ancho_linea(l, fs_c) for l in lineas_c) > W - 150 and fs_c > 60:
                fs_c -= 2
            top = int(max(p["_barbilla_px"] + 60, 960))
            alto = len(lineas_c) * fs_c * 0.92
            # Franja oscura difuminada para que se lea sobre cualquier fondo.
            eventos.append(ev(2, a, b, r"\an7\pos(" + f"{60},{top - 30}" + r")\p1\bord0\shad0\blur34\1c&H000000&\1a&HA8&\fad(150,0)",
                              rect_redondeado(W - 120, alto + 60 + FS_SUB * 1.4, 60)))
            yy = top
            for l in lineas_c:
                eventos += linea_dorada(4, a, b, W // 2, int(yy), fs_c, l, an=8,
                                        tags=r"\fad(150,0)\fscx94\fscy94\t(0,220,\fscx100\fscy100)")
                yy += fs_c * 0.92
            y_sub = int(yy + 26)
        palabras_clave = set(re.findall(r"\w+", (p["clave"] or "").lower()))
        for frase in p["frases"]:
            for txt, t0, t1 in subtitulos(frase, p["_ruta"], p["_a_salida"]):
                t0, t1 = max(t0, a), min(t1, b)
                if t1 - t0 < 0.12:
                    continue
                # Con el rótulo de la frase clave no se repite lo que ya pone el rótulo.
                pal = re.findall(r"\w+", txt.lower())
                if palabras_clave and sum(w in palabras_clave for w in pal) >= 0.6 * len(pal):
                    continue
                eventos.append(ev(1, t0, t1, rf"\an8\pos({W // 2},{y_sub + 5})\fs{FS_SUB}\bord0\shad0\blur8\1c{SOMBRA}\1a{SOMBRA_ALFA}\fad(60,0)", txt))
                eventos.append(ev(2, t0, t1, rf"\an8\pos({W // 2},{y_sub})\fs{FS_SUB}\bord0\shad0\fad(60,0)", txt))

    # 4) Cierre: buscador con osana.es.
    eventos += buscador(dur_video, dur_video + BUSCADOR)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cab + "\n".join(eventos) + "\n")



def partir_rotulo(partes, max_letras=18):
    """Rótulo en mayúsculas en una o dos líneas equilibradas, respetando el dorado."""
    palabras = [(w, e) for t, e in partes for w in t.split()]
    total = sum(len(w) for w, _ in palabras)
    if total <= max_letras or len(palabras) < 2:
        cortes = [palabras]
    else:
        mejor, k_mejor = None, 1
        for k in range(1, len(palabras)):
            a = sum(len(w) for w, _ in palabras[:k])
            if mejor is None or abs(a - total / 2) < mejor:
                mejor, k_mejor = abs(a - total / 2), k
        cortes = [palabras[:k_mejor], palabras[k_mejor:]]
    lineas = []
    for c in cortes:
        partes_l = []
        for w, e in c:
            e = "oro" if e == "oro" else "fina"
            if partes_l and partes_l[-1][1] == e:
                partes_l[-1] = (partes_l[-1][0] + " " + w, e)
            else:
                partes_l.append(((" " if partes_l else "") + w, e))
        lineas.append([(t, "rotulo_oro" if e == "oro" else "rotulo") for t, e in partes_l])
    return lineas



def buscador(t0, t1):
    """Cierre: buscador blanco sobre crema y «osana.es» escribiéndose letra a letra."""
    out = []
    cw, chh, r = 900, 150, 75
    x, y = (W - cw) // 2, 870
    fondo = rf"\an7\pos({x},{y})\p1\bord0\shad0"
    out.append(ev(0, t0, t1, rf"\an7\pos({x},{y + 14})\p1\bord0\shad0\blur22\1c&H000000&\1a&HD8&", rect_redondeado(cw, chh, r)))
    out.append(ev(1, t0, t1, fondo + r"\1c&HFFFFFF&", rect_redondeado(cw, chh, r)))
    # Lupa
    cx, cy, rr = x + 84, y + chh // 2 - 6, 23
    circ = (f"m {cx} {cy - rr} b {cx + rr * 0.55} {cy - rr} {cx + rr} {cy - rr * 0.55} {cx + rr} {cy} "
            f"b {cx + rr} {cy + rr * 0.55} {cx + rr * 0.55} {cy + rr} {cx} {cy + rr} "
            f"b {cx - rr * 0.55} {cy + rr} {cx - rr} {cy + rr * 0.55} {cx - rr} {cy} "
            f"b {cx - rr} {cy - rr * 0.55} {cx - rr * 0.55} {cy - rr} {cx} {cy - rr}")
    gris = "&H8A9099&"
    out.append(ev(2, t0, t1, rf"\an7\pos(0,0)\p1\bord5\shad0\1a&HFF&\3c{gris}", circ))
    hx, hy = cx + rr * 0.72, cy + rr * 0.72
    out.append(ev(2, t0, t1, rf"\an7\pos(0,0)\p1\bord3\shad0\1c{gris}\3c{gris}",
                  f"m {hx:.0f} {hy:.0f} l {hx + 18:.0f} {hy + 18:.0f} l {hx + 16:.0f} {hy + 20:.0f} l {hx - 2:.0f} {hy + 2:.0f}"))
    # Texto que se escribe solo
    texto = "osana.es"
    fs = 76
    tx = cx + rr + 38
    inicio, paso = 0.35, 0.11
    for k in range(1, len(texto) + 1):
        a = t0 + inicio + paso * (k - 1)
        b = t0 + inicio + paso * k if k < len(texto) else t1
        out.append(ev(3, a, b, rf"\an4\pos({tx},{y + chh // 2})\fnInter Display Medium\fs{fs}\bord0\shad0\1c&H23262B&", texto[:k]))
    # Cursor parpadeante
    for k in range(0, len(texto) + 1):
        a = t0 + (inicio + paso * (k - 1) if k else 0.0)
        b = t0 + inicio + paso * k if k < len(texto) else t1
        cxp = tx + ancho(texto[:k], "Inter Display Medium", fs) + 6
        parpadeo = r"\t(400,401,\alpha&HFF&)\t(800,801,\alpha&H00&)\t(1200,1201,\alpha&HFF&)" if k == len(texto) else ""
        out.append(ev(4, a, b, rf"\an7\pos({cxp:.0f},{y + chh // 2 - 40})\p1\bord0\shad0\1c&H23262B&" + parpadeo,
                      "m 0 0 l 5 0 l 5 80 l 0 80"))
    return out


# ---------------------------------------------------------------- montaje

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True)
    ap.add_argument("--salida", default=".")
    ap.add_argument("--cache")
    ap.add_argument("--solo-portada", action="store_true", help="genera solo la portada (JPG)")
    ap.add_argument("--blancos", type=float, default=0.6,
                    help="cuánto se neutraliza el color de la cortina (0 = nada, 1 = gris)")
    args = ap.parse_args()

    cfg = json.load(open(args.tabla, encoding="utf-8"))
    ruta = os.path.join(args.fuentes, cfg["archivo"])
    cache = args.cache or os.path.join(args.salida, ".cache-te-lo-cuento")
    os.makedirs(cache, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="tlc-")
    reloj = [("inicio", time.time())]

    planos = partir_largos(segmentos_y_planos(cfg), ruta)
    tipos_de_plano(planos)
    tomas = [dict(archivo=cfg["archivo"], inicio=p["inicio"], fin=p["fin"]) for p in planos]
    br.en_paralelo(lambda tm: br.analizar_con_cache(tm, args.fuentes, cache), tomas, hilos=4)
    br.completar_caras(tomas)
    for p, tm in zip(planos, tomas):
        p["_cara"], p["_imgs"], p["_ruta"] = tm["_cara"], tm["_imgs"], ruta
        encuadre(p)
    # Un solo clip: misma receta de color en todos los planos.
    g = br.blancos([im for p in planos for im in p["_imgs"]])
    g = 1 + args.blancos * (g - 1)
    lumas = [p["_cara"]["luma"] for p in planos if p["_cara"]["luma"]]
    receta = br.correccion(g, float(np.mean(lumas)) if lumas else None)
    reloj.append(("análisis", time.time()))
    if args.solo_portada:
        os.makedirs(args.salida, exist_ok=True)
        portada(cfg, planos[0], ruta, receta, os.path.join(args.salida, cfg["salida"] + "-portada.jpg"))
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
        x0, y0, cw, ch = p["_crop"]
        vf = (f"crop=iw*{cw:.5f}:ih*{ch:.5f}:iw*{x0:.5f}:ih*{y0:.5f},"
              f"scale={W}:{H}:flags=lanczos,fps={FPS},{receta},setsar=1,format=yuv420p")
        out = os.path.join(cache, f"toma_{br.huella('tlc', VERSION_TOMA, cfg['archivo'], round(p['inicio'], 3), n, vf)}.mp4")
        piezas.append(out)
        if not os.path.exists(out):
            trabajos.append(["ffmpeg", "-v", "error", "-y", "-ss", f"{p['inicio']:.3f}", "-i", ruta,
                             "-frames:v", str(n), "-an", "-vf", vf,
                             "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", out + ".tmp.mp4"])
    dur_video = t
    # Voz por tramo continuo (sin microcortes dentro de un tramo).
    for k in sorted(tramos):
        ps = tramos[k]
        a = ps[0]["inicio"]
        dur = ps[-1]["_t1"] - ps[0]["_t0"]
        for p in ps:
            p["_a_salida"] = (lambda a0, s0: (lambda ts_: s0 + ts_ - a0))(a, ps[0]["_t0"])
        wv = os.path.join(cache, f"voz_{br.huella('voz', cfg['archivo'], round(a, 3), round(dur, 4))}.wav")
        voces.append(wv)
        if not os.path.exists(wv):
            trabajos.append(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-i", ruta,
                             "-t", f"{dur:.4f}", "-vn", "-ac", "1", "-ar", "48000",
                             "-af", f"afade=t=in:d=0.012,afade=t=out:st={dur - 0.015:.4f}:d=0.015",
                             "-c:a", "pcm_s16le", wv + ".tmp.wav"])

    def ejecutar(cmd):
        br.run(cmd)
        os.replace(cmd[-1], cmd[-1].replace(".tmp.mp4", "").replace(".tmp.wav", ""))
    print(f"Planos: {len(piezas)} ({len(piezas) - sum(1 for c in trabajos if c[-1].endswith('.mp4'))} reutilizados)",
          file=sys.stderr)
    br.en_paralelo(ejecutar, trabajos, hilos=3)
    reloj.append(("planos", time.time()))

    lista = os.path.join(tmp, "lista.txt")
    with open(lista, "w") as f:
        f.writelines(f"file '{p}'\n" for p in piezas)
    base = os.path.join(tmp, "base.mp4")
    br.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", base])

    # Voz: compresión ligera y -14 LUFS, sin reducción de ruido; silencio en el buscador.
    lista_v = os.path.join(tmp, "voces.txt")
    with open(lista_v, "w") as f:
        f.writelines(f"file '{v}'\n" for v in voces)
    voz = os.path.join(tmp, "voz.wav")
    br.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista_v,
            "-af", f"apad=pad_dur={BUSCADOR + 0.5},highpass=f=80,"
                   "acompressor=threshold=-20dB:ratio=2:attack=10:release=150,"
                   "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000",
            "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", voz])

    ass = os.path.join(tmp, "textos.ass")
    escribir_ass(ass, cfg, planos, dur_video)
    total = dur_video + BUSCADOR
    tasa = int(min(6000, 27e6 * 8 / total / 1000 - 200))
    os.makedirs(args.salida, exist_ok=True)
    final = os.path.join(args.salida, cfg["salida"] + ".mp4")
    filtro = (f"color=c={CREMA}:s={W}x{H}:r={FPS}:d={BUSCADOR},format=yuv420p,setsar=1[cierre];"
              f"[0:v][cierre]concat=n=2:v=1:a=0,subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}',format=yuv420p[v]")
    br.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-i", voz,
            "-filter_complex", filtro, "-map", "[v]", "-map", "1:a",
            "-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-maxrate", f"{tasa}k", "-bufsize", f"{2 * tasa}k", "-profile:v", "high",
            "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart", "-t", f"{total:.3f}", final])
    portada(cfg, planos[0], ruta, receta, os.path.join(args.salida, cfg["salida"] + "-portada.jpg"))
    reloj.append(("final", time.time()))
    print("Tiempos: " + ", ".join(f"{n} {t1 - t0:.0f} s" for (_, t0), (n, t1) in zip(reloj, reloj[1:])),
          file=sys.stderr)
    for p in planos:
        print(f"{p['_t0']:6.2f}-{p['_t1']:6.2f}s  {p['inicio']:7.2f}-{p['fin']:7.2f}  {p['tipo']:8s} "
              f"zoom={1 / p['_crop'][2]:.2f} barbilla={p['_barbilla_px']:.0f} cabeza={p['_cabeza_px']:.0f}",
              file=sys.stderr)
    print(f"Duración: {total:.1f} s", file=sys.stderr)
    shutil.rmtree(tmp)
    print(final)


if __name__ == "__main__":
    main()
