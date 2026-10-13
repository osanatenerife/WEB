#!/usr/bin/env python3
"""Candado de los formatos fijos de Osana (ver «Formatos fijos» en ESTILO.md).

La dueña quiere sus vídeos «iguales casi siempre»: la misma letra, los mismos tamaños,
colores, posiciones y ritmo. Esto falla si algo de eso cambia sin querer, o si la letra
no se encuentra (libass pondría otra sin avisar). Si el cambio es a propósito (porque
ella lo pide), se cambian a la vez el código, ESTILO.md y los valores de aquí.

Uso (antes de montar):
    python3 tools/reels/test_formatos.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import build_reel as br  # noqa: E402
import te_lo_cuento as tlc  # noqa: E402

# Formato 1 · Entrevista: «Te lo cuento», capítulo 1 (aprobado en octubre de 2026).
ENTREVISTA = {
    "FUENTES": {"Raleway SemiBold": ("Raleway-600.ttf", 0.717)},
    "MARRON": "&H3C5A6E&", "BLANCO": "&HFFFFFF&", "SOMBRA": "&H000000&", "SOMBRA_ALFA": "&HA6&",
    "X0": 72, "Y_PREGUNTA": 330, "FS_PREGUNTA_MAX": 104, "ESP_PREGUNTA": 0.06,
    "FS_SUB": 56, "ESP_SUB": 0.16, "SUB_MAX_PALABRAS": 3, "SUB_MAX_LETRAS": 18, "Y_SUB": 1300,
    "FS_WEB": 44, "ESP_WEB": 0.14, "LUZ_MARRON": 0.6,
    "PREGUNTA_MIN": 2.0, "PREGUNTA_MAX": 2.8, "OSANA_ES": 1.8,
    "PAUSA_MAX": 0.55, "PLANO_MAX": 5.2,
    "ZOOM": {"pregunta": 1.14, "abierto": 1.0, "cerrado": 1.14, "clave": 1.22},
}

# Formato 2 · Explicación con prueba: «¿Duele el láser SHR? Me lo pruebo yo» (octubre de 2026).
EXPLICACION = {
    "F_SUB": 80, "LH_SUB": 96, "SUB_MAX_CHARS": 16,
    "F_ROT": 58, "LH_ROT": 70, "ROT_MAX_CHARS": 20, "F_PRE": 104, "LH_PRE": 116,
    "PAD_X": 44, "PAD_Y": 30, "RADIO": 26, "CAJA_ALFA": "&H70&",
    "BLANCO": "&H00FFFFFF", "DORADO": "&H0062C6EE", "SOMBRA_ALFA": "&H99&",
    "LIMITE_SUP": 288, "LIMITE_INF": 1440, "PLANOS": [0.19, 0.245],
}

# Nombre en el ASS → nombre de la letra que tiene que elegir libass (no otra parecida).
LETRAS = {"Raleway SemiBold": "Raleway-SemiBold", "Montserrat ExtraBold": "Montserrat-ExtraBold"}


def _comparar(modulo, fijos):
    for nombre, valor in fijos.items():
        actual = getattr(modulo, nombre)
        assert actual == valor, (f"{modulo.__name__}.{nombre} = {actual!r}, pero el formato fijo es {valor!r} "
                                 "(si la dueña lo ha pedido, actualiza también ESTILO.md y este test)")


def test_entrevista():
    _comparar(tlc, ENTREVISTA)
    assert "Style: Base,Raleway SemiBold,56," in tlc.cabecera_ass()


def test_subtitulos_entrevista():
    # Mayúsculas y sin puntuación (salvo el punto de los miles), de 2 o 3 palabras.
    assert tlc.limpiar("y dije: «mira, lo abro y me arriesgo».") == "Y DIJE MIRA LO ABRO Y ME ARRIESGO"
    assert tlc.limpiar("20.000 ideas,") == "20.000 IDEAS"
    palabras, grupos = tlc.grupos_subtitulo("pero siempre tenía una libretita llena de 20.000 ideas, "
                                            "pero no encontraba como ese momento")
    for g in grupos:
        assert len(g) <= tlc.SUB_MAX_PALABRAS
        assert len(" ".join(palabras[j] for j in g)) <= tlc.SUB_MAX_LETRAS + 4


def test_explicacion():
    _comparar(br, EXPLICACION)
    with tempfile.TemporaryDirectory() as d:
        ass = os.path.join(d, "textos.ass")
        br.escribir_ass(ass, [], 1.0)
        cabecera = open(ass, encoding="utf-8").read()
    for estilo, fs in (("Rotulo", 58), ("Precio", 104), ("Sub", 80)):
        assert f"Style: {estilo},Montserrat ExtraBold,{fs}," in cabecera


def test_plantilla_explicacion():
    """La tabla del láser es la plantilla del formato 2: su voz, su luz y sin efectos."""
    cfg = json.load(open(os.path.join(AQUI, "reel-laser-shr-no-duele.json"), encoding="utf-8"))
    assert cfg.get("voz") is True, "formato 2: con su voz real"
    assert cfg.get("filtro") is False, "formato 2: su luz natural, sin filtro de color"
    assert not cfg.get("clics"), "formato 2: sin efectos de sonido"


def test_letras():
    """libass usa de verdad las letras de tools/reels/fonts (si no las encuentra, pone
    otra sin avisar y el vídeo sale con otra letra)."""
    if not shutil.which("ffmpeg"):
        print("  (sin ffmpeg: no se comprueban las letras)")
        return
    with tempfile.TemporaryDirectory() as d:
        ass = os.path.join(d, "letras.ass")
        eventos = "\n".join(rf"Dialogue: 0,0:00:00.00,0:00:01.00,Base,,0,0,0,,{{\fn{letra}\pos(100,{300 + 300 * k})}}OSANA"
                            for k, letra in enumerate(LETRAS))
        with open(ass, "w", encoding="utf-8") as f:
            f.write(tlc.cabecera_ass() + eventos + "\n")
        r = subprocess.run(["ffmpeg", "-v", "verbose", "-f", "lavfi", "-i", f"color=c=gray:s={br.W}x{br.H}:d=0.1",
                            "-vf", f"subtitles='{ass}':fontsdir='{br.FUENTES_TIPO}'",
                            "-frames:v", "1", "-f", "null", "-"], capture_output=True, text=True)
    for letra, esperada in LETRAS.items():
        m = re.search(rf"fontselect: \({re.escape(letra)}, \d+, \d+\) -> (.+)", r.stderr)
        assert m, f"libass no ha buscado la letra {letra!r}:\n{r.stderr[-800:]}"
        assert m.group(1).strip().endswith(esperada), f"{letra!r} se dibuja con otra letra: {m.group(1).strip()}"


if __name__ == "__main__":
    fallos = 0
    for nombre, prueba in list(globals().items()):
        if nombre.startswith("test_") and callable(prueba):
            try:
                prueba()
                print(f"ok     {nombre}")
            except AssertionError as e:
                fallos += 1
                print(f"FALLO  {nombre}: {e}")
    print("Formatos intactos." if not fallos else f"{fallos} comprobaciones fallidas.")
    sys.exit(1 if fallos else 0)
