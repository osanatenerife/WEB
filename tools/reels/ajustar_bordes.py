#!/usr/bin/env python3
"""Ajusta una tabla de te_lo_cuento.py para que no haya esperas largas entre frases.

- Cada frase empieza y acaba donde empieza y acaba de verdad la voz (energía).
- Si dentro de una frase hay un silencio de más de PAUSA_LARGA s, se parte en dos frases
  (el texto se reparte por palabras según lo que dura cada trozo), así el montaje la quita.
- En los bordes de cada tramo se fija `corte_inicio` / `corte_fin` con poco aire (AIRE_ANTES,
  AIRE_DESPUES), para que entre una frase y la siguiente queden ~0,3-0,4 s en total.

Uso: python3 ajustar_bordes.py tabla.json --fuentes CARPETA [--salida otra.json]
"""
import argparse
import json
import subprocess

import numpy as np

PASO = 0.02
PAUSA_LARGA = 0.5
AIRE_ANTES, AIRE_DESPUES = 0.1, 0.2
HUECO_TRAMO = 0.55          # como PAUSA_MAX de te_lo_cuento.py


def energia(ruta):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", ruta, "-ac", "1", "-ar", "16000", "-af", "highpass=f=80",
                          "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    hop = int(16000 * PASO)
    n = len(x) // hop
    e = np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1))
    db = 20 * np.log10(e / (np.percentile(np.abs(x), 99) + 1e-9) + 1e-9)
    return np.convolve(db, np.ones(3) / 3, "same")


def voz(db, a, b):
    """Tramos con voz entre a y b (s): [(ini, fin), ...]."""
    i0, i1 = max(int(a / PASO), 0), min(int(b / PASO), len(db))
    seg = db[i0:i1]
    if not len(seg):
        return []
    suelo = np.percentile(seg, 10)
    umbral = min(-34.0, suelo + 8)          # bajo: no comerse finales suaves («-ción»)
    activo = seg > umbral
    tramos, k = [], 0
    while k < len(activo):
        if activo[k]:
            j = k
            while j < len(activo) and activo[j]:
                j += 1
            tramos.append([(i0 + k) * PASO, (i0 + j) * PASO])
            k = j
        else:
            k += 1
    # Une huecos cortos (dentro de una palabra o entre palabras seguidas).
    unidos = []
    for t in tramos:
        if unidos and t[0] - unidos[-1][1] < 0.2:
            unidos[-1][1] = t[1]
        else:
            unidos.append(t)
    return [t for t in unidos if t[1] - t[0] >= 0.1]


def partir_texto(texto, duraciones):
    palabras = texto.split()
    total = sum(duraciones)
    trozos, usadas = [], 0
    for k, d in enumerate(duraciones):
        if k == len(duraciones) - 1:
            n = len(palabras) - usadas
        else:
            n = max(1, round(len(palabras) * d / total))
            n = min(n, len(palabras) - usadas - (len(duraciones) - k - 1))
        trozos.append(" ".join(palabras[usadas:usadas + n]))
        usadas += n
    return trozos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True)
    ap.add_argument("--salida")
    a = ap.parse_args()
    cfg = json.load(open(a.tabla, encoding="utf-8"))
    energias = {}
    nuevas = []
    for f in cfg["frases"]:
        arch = f.get("archivo", cfg["archivo"])
        if arch not in energias:
            energias[arch] = energia(f"{a.fuentes}/{arch}")
        db = energias[arch]
        partes = voz(db, f["inicio"] - 0.08, f["fin"] + 0.08)
        if not partes:
            nuevas.append(dict(f))
            continue
        # Agrupa en bloques separados por silencios largos.
        bloques = [list(partes[0])]
        for p in partes[1:]:
            if p[0] - bloques[-1][1] > PAUSA_LARGA:
                bloques.append(list(p))
            else:
                bloques[-1][1] = p[1]
        textos = partir_texto(f["texto"], [b - c for c, b in bloques]) if len(bloques) > 1 else [f["texto"]]
        for (ini, fin), texto in zip(bloques, textos):
            g = {k: v for k, v in f.items() if k not in ("inicio", "fin", "texto", "corte_inicio", "corte_fin", "clave")}
            g.update(inicio=round(ini, 2), fin=round(fin, 2), texto=texto)
            nuevas.append(g)
        if f.get("clave"):
            nuevas[-1]["clave"] = True
    # Frases seguidas de la misma toma que se solapan unas centésimas: el límite, en medio.
    for f, g in zip(nuevas, nuevas[1:]):
        if f.get("archivo", cfg["archivo"]) == g.get("archivo", cfg["archivo"]) and -0.5 < g["inicio"] - f["fin"] < 0:
            m = round((f["fin"] + g["inicio"]) / 2, 2)
            f["fin"] = g["inicio"] = m
    # Bordes de tramo: poco aire, fijado.
    for k, f in enumerate(nuevas):
        previa = nuevas[k - 1] if k else None
        siguiente = nuevas[k + 1] if k + 1 < len(nuevas) else None
        mismo = lambda x, y: x.get("archivo", cfg["archivo"]) == y.get("archivo", cfg["archivo"])
        if previa is None or not mismo(previa, f) or f["inicio"] - previa["fin"] > HUECO_TRAMO or previa["fin"] > f["inicio"] + 0.5:
            db = energias[f.get("archivo", cfg["archivo"])]
            antes = voz(db, f["inicio"] - 0.6, f["inicio"] - 0.04)
            limite = antes[-1][1] + 0.03 if antes else -1      # sin coger el final de otra toma
            f["corte_inicio"] = round(max(f["inicio"] - AIRE_ANTES, limite), 2)
        if siguiente is None or not mismo(f, siguiente) or siguiente["inicio"] - f["fin"] > HUECO_TRAMO or f["fin"] > siguiente["inicio"] + 0.5:
            db = energias[f.get("archivo", cfg["archivo"])]
            despues = voz(db, f["fin"] + 0.04, f["fin"] + 0.6)
            limite = despues[0][0] - 0.03 if despues else 1e9  # sin coger el arranque de la siguiente
            f["corte_fin"] = round(min(f["fin"] + AIRE_DESPUES, limite), 2)
    cfg["frases"] = nuevas
    cfg["intro"] = round(nuevas[0]["inicio"] - 0.25, 2)
    cfg["fin"] = nuevas[-1]["corte_fin"]
    json.dump(cfg, open(a.salida or a.tabla, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for f in nuevas:
        print(f"{f.get('corte_inicio', '')!s:>7} {f['inicio']:7.2f}-{f['fin']:7.2f} {f.get('corte_fin', '')!s:>7} {f['texto'][:60]}")


if __name__ == "__main__":
    main()
