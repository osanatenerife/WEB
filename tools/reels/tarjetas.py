#!/usr/bin/env python3
"""Tarjetas de la marca para las imágenes de apoyo de los vídeos hablando a cámara
(«imagenes» en las tablas de te_lo_cuento.py): un icono de línea en el marrón de
OSANA sobre crema y una palabra en Raleway SemiBold, con el borde de arriba
difuminado para fundirse con el vídeo. Se usan cuando no hay foto o vídeo propio del
caso que nombra; en cuanto la dueña manda la foto, se cambia por ella.

Uso:
    python3 tools/reels/tarjetas.py            # genera tools/reels/tarjetas/*.png
    python3 tools/reels/tarjetas.py calima     # solo las que se nombran

Necesita Chromium (en las sesiones en la nube está en /opt/pw-browsers).
"""
import glob
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, "tarjetas")
W, H = 1080, 960            # la mitad de abajo del vídeo vertical
FUNDIDO = 260               # px difuminados arriba (como en te_lo_cuento.FUNDIDO_IMAGEN)
MARRON = "#6E5A3C"          # el marrón de la marca de los textos (te_lo_cuento.MARRON)

# Iconos de línea en una cuadrícula de 24×24 (trazo, sin relleno salvo los puntos).
ICONOS = {
    "mensajes": """
        <path d="M3.5 4.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5l-3.5 3v-3h-1.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/>
        <path d="M17.5 8.5h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3.5-3h-3.5a2 2 0 0 1-1.7-1"/>
        <circle cx="5.8" cy="9" r=".45" class="p"/><circle cx="8.5" cy="9" r=".45" class="p"/>
        <circle cx="11.2" cy="9" r=".45" class="p"/>""",
    "calima": """
        <circle cx="12" cy="8.5" r="3.4"/>
        <path d="M3.5 14h7M13.5 14h7M5.5 17h13M8 20h8"/>
        <circle cx="4.5" cy="5.5" r=".35" class="p"/><circle cx="19.5" cy="4.5" r=".35" class="p"/>
        <circle cx="18" cy="10.5" r=".35" class="p"/><circle cx="6" cy="10" r=".35" class="p"/>
        <circle cx="16" cy="2.8" r=".35" class="p"/><circle cx="8.5" cy="3" r=".35" class="p"/>""",
    "calor": """
        <path d="M13.5 13.8V5a1.5 1.5 0 0 0-3 0v8.8a3.5 3.5 0 1 0 3 0z"/>
        <path d="M12 16.5v-5"/>
        <path d="M17.5 5.5h2M17.5 8.5h2M17.5 11.5h2"/>""",
    "deshidratacion": """
        <path d="M12 3.2l4.9 5.1a6.9 6.9 0 1 1-9.8 0z"/>
        <path d="M4.5 4.5l15 15.5"/>""",
    "granitos": """
        <circle cx="12" cy="12" r="8.5"/>
        <circle cx="9" cy="9.2" r="1.1"/><circle cx="14.8" cy="8.6" r=".8"/>
        <circle cx="10.4" cy="14.8" r=".9"/><circle cx="15.2" cy="14.2" r="1.2"/>""",
    "poros": """
        <circle cx="10.5" cy="10.5" r="6.3"/><path d="M15.2 15.2l5 5"/>
        <circle cx="8.3" cy="8.8" r=".5" class="p"/><circle cx="11.6" cy="8.2" r=".5" class="p"/>
        <circle cx="9.6" cy="11.7" r=".5" class="p"/><circle cx="12.8" cy="11.6" r=".5" class="p"/>
        <circle cx="7.8" cy="13.4" r=".4" class="p"/>""",
    "piel-seca": """
        <rect x="3.5" y="4.5" width="17" height="15" rx="3"/>
        <path d="M8.5 4.5l1.3 3.8-2.4 3 2.1 4.2-1 4M15.5 4.5l-1 3.6 2.4 2.9-1.6 3.2 1.3 4.8M9.8 8.3l2.7.7M7.4 11.3l-2 .8"/>""",
    "productos": """
        <path d="M6 9.5h4.5v10a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19.5z"/>
        <path d="M7.2 9.5V7.5h2.1v2M8.25 7.5V4.5M7.2 4.5h2.1"/>
        <path d="M13.5 13h6.5v6.5a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5z"/>
        <path d="M14.2 13v-2h5v2"/>""",
    "protector-solar": """
        <path d="M9.2 3h5.6l-.7 2.5H9.9z"/>
        <path d="M8.5 5.5h7l1 14.3a1.8 1.8 0 0 1-1.8 1.9H9.3a1.8 1.8 0 0 1-1.8-1.9z"/>
        <circle cx="12" cy="12.8" r="1.8"/>
        <path d="M12 9.2v1M12 15.6v1M8.6 12.8h1M14.4 12.8h1"/>""",
    "playa": """
        <circle cx="16.5" cy="6.5" r="2.8"/>
        <path d="M16.5 1.8v.9M21.2 6.5h-.9M12.7 2.7l.6.6M20.3 2.7l-.6.6"/>
        <path d="M2.5 14c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.5 1.2 2.5 1.2"/>
        <path d="M2.5 18c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.5 1.2 2.5 1.2"/>""",
    "regeneracion": """
        <path d="M19.5 10.5a7.5 7.5 0 0 0-13.3-3.6L4.5 8.5"/><path d="M4.5 4.5v4h4"/>
        <path d="M4.5 13.5a7.5 7.5 0 0 0 13.3 3.6l1.7-1.6"/><path d="M19.5 19.5v-4h-4"/>
        <path d="M12 9.6v4.8M9.6 12h4.8"/>""",
    "hidratacion": """
        <path d="M12 3.2l4.9 5.1a6.9 6.9 0 1 1-9.8 0z"/>
        <path d="M12 11.6v5M9.5 14.1h5"/>""",
    "mascarilla": """
        <ellipse cx="12" cy="12" rx="6.6" ry="8.6"/>
        <path d="M5.6 11.2c2.3 1 10.5 1 12.8 0v1.6c0 4.3-2.9 7.8-6.4 7.8s-6.4-3.5-6.4-7.8z" class="r"/>
        <path d="M8.1 8.9q1.25 1 2.5 0M13.4 8.9q1.25 1 2.5 0M10.7 16.1q1.3 .8 2.6 0"/>
        <circle cx="20.4" cy="5.6" r=".45" class="p"/><circle cx="3.6" cy="7.4" r=".35" class="p"/>
        <circle cx="21.2" cy="9.4" r=".3" class="p"/>""",
}

# Tarjeta → (icono, rótulo). La de «comenta» es especial: un bocadillo con la palabra; la
# de «fondo», solo el crema (debajo de la pregunta del inicio, que escribe te_lo_cuento.py).
TARJETAS = {
    "fondo": (None, None),
    "mensajes": ("mensajes", "VUESTROS MENSAJES"),
    "calima": ("calima", "CALIMA"),
    "calor": ("calor", "CALOR INTENSO"),
    "deshidratacion": ("deshidratacion", "PIEL DESHIDRATADA"),
    "granitos": ("granitos", "GRANITOS"),
    "poros": ("poros", "POROS DILATADOS"),
    "piel-seca": ("piel-seca", "PIEL SECA Y REACTIVA"),
    "productos": ("productos", "PRODUCTOS"),
    "protector-solar": ("protector-solar", "PROTECTOR SOLAR"),
    "playa": ("playa", "PLAYA"),
    "regeneracion": ("regeneracion", "REGENERACIÓN CELULAR"),
    "hidratacion": ("hidratacion", "HIDRATACIÓN"),
    "mascarilla": ("mascarilla", "MASCARILLA PARA MANCHAS"),
    "comenta-manchas": (None, "MANCHAS"),
}

CSS = f"""
@font-face {{ font-family: Raleway; font-weight: 600;
  src: url("file://{os.path.join(AQUI, 'fonts', 'Raleway-600.ttf')}"); }}
html, body {{ margin: 0; width: {W}px; height: {H}px; overflow: hidden; }}
body {{ background: linear-gradient(180deg, #f8f4ec 0%, #f3ece0 100%); font-family: Raleway; }}
.halo {{ position: absolute; left: 270px; top: 130px; width: 540px; height: 540px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 68%); }}
svg.icono {{ position: absolute; left: 410px; top: 270px; width: 260px; height: 260px; overflow: visible; }}
svg.icono * {{ fill: none; stroke: {MARRON}; stroke-width: 1.15; stroke-linecap: round; stroke-linejoin: round; }}
svg.icono .p {{ fill: {MARRON}; stroke: none; }}
svg.icono .r {{ fill: {MARRON}; fill-opacity: .16; }}
.rotulo {{ position: absolute; top: 560px; left: 0; width: 100%; text-align: center; font-size: 52px;
  letter-spacing: .16em; color: {MARRON}; padding-left: .16em; box-sizing: border-box; }}
.bocadillo {{ position: absolute; left: 50%; top: 370px; transform: translateX(-50%); padding: 34px 64px 30px 78px;
  border: 7px solid {MARRON}; border-radius: 56px; font-size: 92px; letter-spacing: .16em; color: {MARRON};
  background: #fbf8f2; white-space: nowrap; }}
.cola {{ position: absolute; left: 86px; bottom: -41px; overflow: visible; }}
.encima {{ position: absolute; top: 286px; left: 0; width: 100%; text-align: center; font-size: 46px;
  letter-spacing: .2em; color: {MARRON}; padding-left: .2em; box-sizing: border-box; }}
"""


def html(nombre):
    icono, rotulo = TARJETAS[nombre]
    if rotulo is None:
        cuerpo = ""
    elif icono is None:
        cola = (f'<svg class="cola" width="56" height="48"><path d="M3 0 L20 41 L48 0" fill="#fbf8f2" '
                f'stroke="{MARRON}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/></svg>')
        cuerpo = f'<div class="encima">COMENTA</div><div class="bocadillo">{rotulo}{cola}</div>'
    else:
        cuerpo = (f'<div class="halo"></div><svg class="icono" viewBox="0 0 24 24">{ICONOS[icono]}</svg>'
                  f'<div class="rotulo">{rotulo}</div>')
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{cuerpo}</body></html>'


def chromium():
    for patron in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome", "/usr/bin/chromium*", "/usr/bin/google-chrome*"):
        hallados = sorted(glob.glob(patron))
        if hallados:
            return hallados[-1]
    sys.exit("No encuentro Chromium para dibujar las tarjetas.")


def generar(nombres):
    os.makedirs(SALIDA, exist_ok=True)
    navegador = chromium()
    with tempfile.TemporaryDirectory() as tmp:
        for nombre in nombres:
            pagina, png = os.path.join(tmp, nombre + ".html"), os.path.join(tmp, nombre + ".png")
            with open(pagina, "w", encoding="utf-8") as f:
                f.write(html(nombre))
            subprocess.run([navegador, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                            "--force-device-scale-factor=1", f"--window-size={W},{H + 200}",
                            f"--screenshot={png}", "file://" + pagina],
                           check=True, capture_output=True, timeout=120)
            # La ventana sin pantalla deja ~90 px menos de página que su alto (abajo saldría
            # una franja blanca): se captura más alta y se recorta.
            im = np.array(Image.open(png).convert("RGB"))[:H]
            assert im.shape[0] == H and not (im[-1] == 255).all(), "la tarjeta no ha salido entera"
            # Borde de arriba difuminado (canal alfa) para que la tarjeta se funda con el vídeo.
            y = np.arange(H, dtype=np.float32)[:, None]
            s = np.clip(y / FUNDIDO, 0, 1)
            alfa = (s * s * (3 - 2 * s) * 255).astype(np.uint8)          # suave al principio y al final
            rgba = np.dstack([im, np.repeat(alfa, W, axis=1)])
            Image.fromarray(rgba, "RGBA").save(os.path.join(SALIDA, nombre + ".png"), optimize=True)
            print(os.path.join(SALIDA, nombre + ".png"))


if __name__ == "__main__":
    generar(sys.argv[1:] or list(TARJETAS))
