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
    obj = cfg.get("piel", {"r_g": 1.18, "r_b": 1.42, "fuerza": 0.75})
    dims, receta = {}, {}
    for archivo in sorted({tm["archivo"] for tm in tomas}):
        ruta = os.path.join(args.fuentes, archivo)
        dims[archivo] = dimensiones(ruta)
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
            trabajos.append((["ffmpeg", "-v", "error", "-y", "-ss", f"{tm['inicio']:.3f}",
                              "-i", os.path.join(args.fuentes, tm["archivo"]),
                              "-frames:v", str(n), "-an", "-vf", vf,
                              "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", out + ".tmp.mp4"], out))

    def ejecutar(trabajo):
        cmd, destino = trabajo
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
    ass = os.path.join(tmp, "textos.ass")
    escribir_ass(ass, tomas, cfg.get("texto"))
    filtro += f"[{previo}]subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}',format=yuv420p[v]"

    os.makedirs(args.salida, exist_ok=True)
    final = os.path.join(args.salida, cfg["salida"] + ".mp4")
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
