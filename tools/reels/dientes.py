"""Blanqueado natural de dientes en vídeo.

Con luz cálida los dientes salen amarillentos o con manchas. Aquí se corrigen solo
los dientes: se busca la boca bajo la cara detectada, se separan los labios (la
barra de labios tiene un tono magenta distinto del de la piel), y dentro del hueco
que encierran se igualan las manchas (zonas más amarillas u oscuras) al tono de sus
propios dientes. Nada de blanco artificial: un blanqueado fuerte le parece «filtro».
"""
import subprocess

import cv2
import numpy as np

import build_reel as br

VERSION = 2


def caja_cara(img):
    """Caja de la cara (x, y, ancho, alto) en píxeles del fotograma, o None."""
    alto, ancho = img.shape[:2]
    g = cv2.cvtColor(cv2.resize(img, (ancho // 2, alto // 2)), cv2.COLOR_BGR2GRAY)
    caras = br.CARAS.detectMultiScale(g, 1.1, 6, minSize=(24, 24))
    if not len(caras):
        return None
    return np.array(max(caras, key=lambda r: r[2] * r[3]), float) * 2


def blanquear(img, caja):
    """Devuelve el fotograma con los dientes más blancos (solo dentro de la boca)."""
    x, y, w, h = caja
    x0, x1 = max(int(x + 0.12 * w), 0), min(int(x + 0.88 * w), img.shape[1])
    y0, y1 = max(int(y + 0.55 * h), 0), min(int(y + 1.08 * h), img.shape[0])
    if x1 - x0 < 20 or y1 - y0 < 20:
        return img
    roi = img[y0:y1, x0:x1]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    hh, ss, vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # Labios: tono magenta-rojo, distinto de la piel (más naranja).
    labios = (((hh >= 158) | (hh <= 2)) & (ss > 70) & (vv > 35)).astype(np.uint8) * 255
    labios = cv2.morphologyEx(labios, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 7)))
    contornos, _ = cv2.findContours(labios, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        return img
    c = max(contornos, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.02 * labios.size:
        return img
    boca = np.zeros_like(labios)
    cv2.drawContours(boca, [cv2.convexHull(c)], -1, 255, -1)
    # Un poco hacia dentro, para no tocar la piel que rodea los labios.
    boca = cv2.erode(boca, np.ones((7, 7), np.uint8))
    dientes = (boca > 0) & (labios == 0) & (vv > 100) & (ss < 150) & ((hh <= 35) | (hh >= 160))
    if dientes.sum() < 30:
        return img
    m = cv2.GaussianBlur(dientes.astype(np.float32), (0, 0), 1.6)[..., None]
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
    # Solo se igualan las manchas (zonas más amarillas o más oscuras que el resto del
    # diente) hacia el tono medio de sus propios dientes; el color general apenas cambia,
    # para que no parezca un filtro.
    L, B = lab[..., 0], lab[..., 2]
    l_med, b_med = np.median(L[dientes]), np.median(B[dientes])
    nuevo = lab.copy()
    nuevo[..., 2] = np.where(B > b_med, b_med + (B - b_med) * 0.3, B)
    nuevo[..., 2] = 128 + (nuevo[..., 2] - 128) * 0.85     # un poco menos amarillo
    nuevo[..., 0] = np.where(L < l_med, l_med - (l_med - L) * 0.6, L)
    mezcla = lab * (1 - m) + nuevo * m
    out = img.copy()
    out[y0:y1, x0:x1] = cv2.cvtColor(np.clip(mezcla, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    return out


def procesar(cmd_lectura, cmd_escritura, ancho, alto, cada=3):
    """Lee fotogramas en bruto (bgr24) de un ffmpeg, blanquea los dientes y los pasa a
    otro ffmpeg que codifica. La cara se busca cada «cada» fotogramas y se suaviza."""
    lector = subprocess.Popen(cmd_lectura, stdout=subprocess.PIPE)
    escritor = subprocess.Popen(cmd_escritura, stdin=subprocess.PIPE)
    tam = ancho * alto * 3
    caja, k = None, 0
    try:
        while True:
            buf = lector.stdout.read(tam)
            if len(buf) < tam:
                break
            img = np.frombuffer(buf, np.uint8).reshape(alto, ancho, 3)
            if k % cada == 0:
                nueva = caja_cara(img)
                if nueva is not None:
                    caja = nueva if caja is None else 0.5 * caja + 0.5 * nueva
            if caja is not None:
                img = blanquear(img, caja)
            escritor.stdin.write(np.ascontiguousarray(img).tobytes())
            k += 1
    finally:
        escritor.stdin.close()
        lector.stdout.close()
        r1, r2 = lector.wait(), escritor.wait()
    if r1 or r2:
        raise RuntimeError(f"ffmpeg falló al blanquear los dientes ({r1}, {r2})")
    return k
