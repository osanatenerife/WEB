#!/usr/bin/env python3
"""Clips de la serie «Te lo cuento» (la entrevista de Osana): una pregunta, un clip.

Uso:
    python3 tools/reels/te_lo_cuento.py tools/reels/te-lo-cuento-c1-p1.json \
        --fuentes /ruta/a/los/videos --salida /ruta/de/salida

Estilo natural (lo que pidió la dueña tras ver la primera versión y sus referencias):
  - La luz tal cual se grabó: sin filtro de color, sin contraste ni nitidez añadidos
    (el filtro le blanqueaba la piel y oscurecía los ojos).
  - Sin etiqueta de serie ni capítulo (eso va, si acaso, en el pie de foto).
  - La pregunta aparece y desaparece rápido, solo al inicio, en el silencio antes de
    responder: mayúsculas espaciadas en Raleway (la letra de la web) y en el marrón
    de la marca, sobre la cortina, a la izquierda de la cara.
  - Se quitan las pausas largas. En cada corte el encuadre alterna plano abierto y
    plano cerrado (dos cámaras); los planos largos se parten en dos encuadres sin
    cortar el audio. La frase clave va algo más cerca, sin rótulo.
  - Subtítulos pequeños en mayúsculas espaciadas, blancos, de 2 o 3 palabras, al
    ritmo de la voz y a la altura del pecho.
  - Al final, «osana.es» pequeño y centrado debajo de las últimas palabras.
  - Dientes: con la luz cálida salían amarillentos o con manchas; se blanquean de
    forma natural, solo dentro de la boca (dientes.py).
  - Voz natural (sin reducción de ruido), compresión ligera y -14 LUFS. Sin música:
    la pone ella al publicar.

Tabla (JSON):
    archivo     vídeo de la entrevista (en --fuentes)
    pregunta    pregunta del inicio; «|» separa líneas
    intro       segundo del original donde empieza el silencio de la pregunta
                (termina donde empieza la primera frase)
    fin         (opcional) segundo del original donde acaba el último plano
    portada     (opcional) segundo del original para la portada del Reel
    frases      [{inicio, fin, texto}] en orden: inicio y fin de la voz (s del
                original) y el texto exacto para los subtítulos. Opcionales:
                «clave» (frase importante: plano más cerrado), «unir» (no cortar
                la pausa de antes), «corte_inicio» / «corte_fin» (punto exacto de
                corte cuando la palabra de al lado no se quiere).
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
import build_reel as br  # noqa: E402  (reutiliza análisis de cara, voz y caché)
import dientes as dt  # noqa: E402  (blanqueado natural de dientes)

W, H, FPS = br.W, br.H, br.FPS
VERSION_TOMA = 3

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
            # el plano de la pregunta.
            if f.get("clave") or p.get("clave") or (n == 0 and k == 0):
                limites.append(corte)
        limites.append(b)
        for x, y in zip(limites, limites[1:]):
            fr = [f for f in tramo if x - 0.05 <= (f["inicio"] + f["fin"]) / 2 <= y + 0.05]
            planos.append(dict(inicio=x, fin=y, tramo=n, frases=fr,
                               clave=any(f.get("clave") for f in fr)))
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
    """Recorte del plano: ojos en el tercio superior. El de la pregunta, anclado arriba a
    la izquierda para dejar la cortina libre junto a la cara."""
    c = p["_cara"]
    z = ZOOM[p["tipo"]]
    cw = ch = 1 / z
    x0 = min(max(c["cx"] - cw / 2, 0), 1 - cw)
    y0 = c["cy"] - 0.30 * ch
    if p["tipo"] == "pregunta":
        x0 = y0 = 0.0
    y0 = min(max(y0, 0), 1 - ch)
    p["_crop"] = (x0, y0, cw, ch)
    # Borde izquierdo de la cara con margen para el pelo (la caja de Haar es cuadrada).
    p["_cara_izq_px"] = (c["cx"] - c["alto"] * H / W * 0.55 - x0) / cw * W
    p["_cabeza_px"] = (c["cabeza"] - y0) / ch * H


def filtro_plano(p):
    """Solo encuadre: la luz y el color, tal como se grabaron."""
    x0, y0, cw, ch = p["_crop"]
    return (f"crop=iw*{cw:.5f}:ih*{ch:.5f}:iw*{x0:.5f}:ih*{y0:.5f},"
            f"scale={W}:{H}:flags=lanczos,fps={FPS},setsar=1,format=yuv420p")


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


def eventos_pregunta(cfg, p0, t0, t1, fundido=True):
    """La pregunta, en el marrón de la marca: entra y sale con un fundido rápido."""
    fs, lineas = maquetar_pregunta(cfg, p0)
    fad = r"\fad(250,300)" if fundido else ""
    out, y = [], Y_PREGUNTA
    for l in lineas:
        out.append(ev(4, t0, t1, rf"\an7\pos({X0},{y:.0f})\fnRaleway SemiBold\fs{fs}\fsp{fs * ESP_PREGUNTA:.1f}"
                                 rf"\bord0\shad0\1c{MARRON}" + fad, l))
        y += fs * 1.05
    return out


def escribir_ass(ruta, cfg, planos, dur_video):
    eventos = []
    p0 = planos[0]
    # 1) La pregunta: solo al inicio, aparece y desaparece rápido.
    dur_intro = p0["_a_salida"](cfg["frases"][0]["inicio"]) - p0["_t0"]
    t_fin = min(p0["_t1"], max(PREGUNTA_MIN, min(PREGUNTA_MAX, dur_intro + 1.0)))
    eventos += eventos_pregunta(cfg, p0, p0["_t0"] + 0.1, t_fin)

    # 2) Subtítulos.
    subs = []
    for p in planos:
        a, b = p["_t0"], p["_t1"]
        for frase in p["frases"]:
            for txt, t0, t1 in subtitulos(frase, p["_ruta"], p["_a_salida"]):
                t0, t1 = max(t0, a), min(t1, b)
                if t1 - t0 >= 0.12:
                    subs.append([txt, t0, t1])
    if subs:
        subs[-1][2] = dur_video          # las últimas palabras se quedan hasta el final
    tags = rf"\fs{FS_SUB}\fsp{FS_SUB * ESP_SUB:.1f}\fad(60,0)"
    for txt, t0, t1 in subs:
        eventos += con_sombra(1, t0, t1, W // 2, Y_SUB, tags, txt)

    # 3) Al final, «osana.es» pequeño y centrado debajo de las últimas palabras.
    if subs:
        t0 = max(subs[-1][1], dur_video - OSANA_ES)
        eventos += con_sombra(1, t0, dur_video, W // 2, Y_SUB + int(FS_SUB * 1.25),
                              rf"\fs{FS_WEB}\fsp{FS_WEB * ESP_WEB:.1f}\fad(300,0)", "osana.es")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(cabecera_ass() + "\n".join(eventos) + "\n")


def portada(cfg, p0, ruta, salida):
    """Portada del Reel: un fotograma del plano de la pregunta, con la pregunta.
    «portada» en la tabla = segundo del original con buena expresión."""
    t = cfg.get("portada", cfg["intro"])
    ass, png = salida + ".ass", salida + ".png"
    with open(ass, "w", encoding="utf-8") as f:
        f.write(cabecera_ass() + "\n".join(eventos_pregunta(cfg, p0, 0, 5, fundido=False)) + "\n")
    dt.procesar(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", ruta, "-frames:v", "1",
                 "-vf", filtro_plano(p0), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                 "-i", "-", png], W, H)
    br.run(["ffmpeg", "-v", "error", "-y", "-i", png,
            "-vf", f"subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}'", "-q:v", "2", salida])
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
    args = ap.parse_args()

    cfg = json.load(open(args.tabla, encoding="utf-8"))
    ruta = os.path.join(args.fuentes, cfg["archivo"])
    cache = args.cache or os.path.join(args.salida, ".cache-te-lo-cuento")
    os.makedirs(cache, exist_ok=True)
    os.makedirs(args.salida, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="tlc-")
    reloj = [("inicio", time.time())]

    planos = partir_largos(segmentos_y_planos(cfg), ruta)
    tipos_de_plano(planos)
    tomas = [dict(archivo=cfg["archivo"], inicio=p["inicio"], fin=p["fin"]) for p in planos]
    br.en_paralelo(lambda tm: br.analizar_con_cache(tm, args.fuentes, cache), tomas, hilos=4)
    br.completar_caras(tomas)
    for p, tm in zip(planos, tomas):
        p["_cara"], p["_ruta"] = tm["_cara"], ruta
        encuadre(p)
    reloj.append(("análisis", time.time()))
    portada_jpg = os.path.join(args.salida, cfg["salida"] + "-portada.jpg")
    if args.solo_portada:
        portada(cfg, planos[0], ruta, portada_jpg)
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
        out = os.path.join(cache, f"toma_{br.huella('tlc', VERSION_TOMA, dt.VERSION, cfg['archivo'], round(p['inicio'], 3), n, vf)}.mp4")
        piezas.append(out)
        if not os.path.exists(out):
            # Encuadre con ffmpeg → dientes en Python → codificación con ffmpeg.
            trabajos.append(("dientes",
                             ["ffmpeg", "-v", "error", "-ss", f"{p['inicio']:.3f}", "-i", ruta,
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
        wv = os.path.join(cache, f"voz_{br.huella('voz', cfg['archivo'], round(a, 3), round(dur, 4))}.wav")
        voces.append(wv)
        if not os.path.exists(wv):
            trabajos.append(("ffmpeg",
                             ["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-i", ruta,
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

    ass = os.path.join(tmp, "textos.ass")
    escribir_ass(ass, cfg, planos, dur_video)
    tasa = int(min(6000, 27e6 * 8 / dur_video / 1000 - 200))
    final = os.path.join(args.salida, cfg["salida"] + ".mp4")
    br.run(["ffmpeg", "-v", "error", "-y", "-i", base, "-i", voz,
            "-filter_complex", f"[0:v]subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}',format=yuv420p[v]",
            "-map", "[v]", "-map", "1:a",
            "-c:v", "libx264", "-preset", "medium", "-crf", "19",
            "-maxrate", f"{tasa}k", "-bufsize", f"{2 * tasa}k", "-profile:v", "high",
            "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart", "-t", f"{dur_video:.3f}", final])
    portada(cfg, planos[0], ruta, portada_jpg)
    reloj.append(("final", time.time()))
    print("Tiempos: " + ", ".join(f"{n} {t1 - t0:.0f} s" for (_, t0), (n, t1) in zip(reloj, reloj[1:])),
          file=sys.stderr)
    for p in planos:
        print(f"{p['_t0']:6.2f}-{p['_t1']:6.2f}s  {p['inicio']:7.2f}-{p['fin']:7.2f}  {p['tipo']:8s} "
              f"zoom={1 / p['_crop'][2]:.2f}", file=sys.stderr)
    print(f"Duración: {dur_video:.1f} s", file=sys.stderr)
    shutil.rmtree(tmp)
    print(final)


if __name__ == "__main__":
    main()
