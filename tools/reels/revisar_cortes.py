#!/usr/bin/env python3
"""Comprueba que ningún corte de una tabla de te_lo_cuento.py se coma ni arrastre sonido.

Mide la energía de la voz en los 80 ms de cada borde de tramo (inicio y fin). Si un
borde suena (más de -25 dB respecto al pico), el corte deja media palabra, el arranque
de la siguiente o un ruido: hay que ajustar «corte_inicio» / «corte_fin».

Uso: python3 revisar_cortes.py tabla.json --fuentes CARPETA
"""
import argparse
import json
import subprocess

import numpy as np

import te_lo_cuento as t

LIMITE_DB = -25


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tabla")
    ap.add_argument("--fuentes", required=True)
    a = ap.parse_args()
    cfg = json.load(open(a.tabla, encoding="utf-8"))
    planos = t.partir_largos(t.segmentos_y_planos(cfg), a.fuentes)
    audios, malos = {}, 0
    tramos = {}
    for p in planos:
        tramos.setdefault(p["tramo"], []).append(p)
    for n, ps in sorted(tramos.items()):
        arch = ps[0]["archivo"]
        if arch not in audios:
            raw = subprocess.run(["ffmpeg", "-v", "error", "-i", f"{a.fuentes}/{arch}", "-ac", "1", "-ar", "16000",
                                  "-f", "f32le", "-"], capture_output=True).stdout
            x = np.frombuffer(raw, np.float32)
            audios[arch] = (x, np.percentile(np.abs(x), 99) + 1e-9)
        x, ref = audios[arch]
        def db(i, f):
            s = x[int(i * 16000):int(f * 16000)]
            return 20 * np.log10(np.sqrt((s ** 2).mean()) / ref + 1e-9)
        ini, fin = ps[0]["inicio"], ps[-1]["fin"]
        for nombre, valor in (("inicio", db(ini, ini + 0.08)), ("fin", db(fin - 0.08, fin))):
            marca = "REVISAR" if valor > LIMITE_DB else "ok"
            malos += marca != "ok"
            print(f"tramo {n} {nombre} {ini if nombre == 'inicio' else fin:.2f}: {valor:.0f} dB {marca}")
    print("Cortes limpios." if not malos else f"{malos} corte(s) por revisar.")


if __name__ == "__main__":
    main()
