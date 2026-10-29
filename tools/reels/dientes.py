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

VERSION = 5


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
    # Dientes: dentro de la boca, mucho más claros y menos saturados que la piel de
    # alrededor. Con umbrales flojos (v > 100, s < 150) entraba la piel de la barbilla y,
    # como la boca se detecta en unos fotogramas sí y en otros no, la piel «temblaba».
    piel = (labios == 0) & (boca == 0)
    v_piel = np.median(vv[piel]) if piel.any() else 150
    s_piel = np.median(ss[piel]) if piel.any() else 110
    dientes = ((boca > 0) & (labios == 0) & (vv > max(120, v_piel + 18)) & (ss < min(100, s_piel - 15))
               & ((hh <= 35) | (hh >= 160)))
    alto_boca = np.ptp(np.nonzero(boca)[0]) if boca.any() else 0
    if alto_boca > 0.22 * h:           # la «boca» detectada es demasiado grande: no es la boca
        return img
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
    nuevo[..., 2] = 128 + (nuevo[..., 2] - 128) * 0.75     # menos amarillo
    nuevo[..., 0] = np.where(L < l_med, l_med - (l_med - L) * 0.6, L)
    nuevo[..., 0] = np.minimum(nuevo[..., 0] * 1.05, 250)    # un punto más claros (lo pidió ella)
    mezcla = lab * (1 - m) + nuevo * m
    out = img.copy()
    out[y0:y1, x0:x1] = cv2.cvtColor(np.clip(mezcla, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    return out


# Hueco interior de los labios (puntos de MediaPipe FaceMesh): ahí solo hay dientes, encías
# y lengua, sea cual sea el color de la barra de labios. Con el detector de color anterior,
# los labios marrones no se reconocían y los dientes nunca se aclaraban.
LABIO_INTERIOR = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
_MARCAS = None


def _marcador():
    global _MARCAS
    if _MARCAS is None:
        import os
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision
        import gestos
        modelo = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".face_landmarker.task")
        if not os.path.exists(modelo):
            import urllib.request
            urllib.request.urlretrieve(gestos.MODELO_URL, modelo + ".tmp")
            os.replace(modelo + ".tmp", modelo)
        op = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=modelo), num_faces=1)
        _MARCAS = (mp, vision.FaceLandmarker.create_from_options(op))
    return _MARCAS


def boca_interior(img):
    """Polígono (N×2, píxeles) del hueco entre los labios, o None."""
    mp, det = _marcador()
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img[..., ::-1])))
    if not r.face_landmarks:
        return None
    h, w = img.shape[:2]
    pts = r.face_landmarks[0]
    return np.array([[pts[i].x * w, pts[i].y * h] for i in LABIO_INTERIOR], np.float32)


def aclarar(img, poligono, fuerza=1.0):
    """Dientes más blancos dentro del hueco de los labios: menos amarillo y algo más de luz,
    sin llegar a blanco artificial. Solo píxeles claros (dientes), no encía ni lengua."""
    if poligono is None:
        return img
    x0, y0 = np.maximum(poligono.min(0).astype(int) - 6, 0)
    x1, y1 = poligono.max(0).astype(int) + 6
    x1, y1 = min(x1, img.shape[1]), min(y1, img.shape[0])
    if x1 - x0 < 12 or y1 - y0 < 4:
        return img
    roi = img[y0:y1, x0:x1]
    hueco = np.zeros(roi.shape[:2], np.uint8)
    cv2.fillPoly(hueco, [np.round(poligono - [x0, y0]).astype(np.int32)], 255)
    if hueco.sum() < 255 * 40:
        return img
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    dentro = hueco > 0
    # Dientes: lo más claro del hueco y poco rojo (la encía y la lengua son rojas y oscuras).
    l_ref = np.percentile(L[dentro], 75)
    dientes = dentro & (L > max(95, l_ref - 35)) & (A < 150)
    if dientes.sum() < 25:
        return img
    m = cv2.GaussianBlur(dientes.astype(np.float32), (0, 0), 1.4)
    m = (m * (cv2.GaussianBlur(hueco.astype(np.float32) / 255, (0, 0), 1.2) > 0.5))[..., None] * fuerza
    nuevo = lab.copy()
    nuevo[..., 2] = 128 + (B - 128) * 0.45            # mucho menos amarillo
    nuevo[..., 1] = 128 + (A - 128) * 0.8
    nuevo[..., 0] = np.minimum(L * 1.1 + 6, 245)       # algo más claros
    mezcla = lab * (1 - m) + nuevo * m
    out = img.copy()
    out[y0:y1, x0:x1] = cv2.cvtColor(np.clip(mezcla, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    return out


def procesar(cmd_lectura, cmd_escritura, ancho, alto, cada=1, fuerza=1.0):
    """Lee fotogramas en bruto (bgr24) de un ffmpeg, aclara los dientes y los pasa a otro
    ffmpeg que codifica. Los puntos de la boca se suavizan entre fotogramas (sin temblor)."""
    lector = subprocess.Popen(cmd_lectura, stdout=subprocess.PIPE)
    escritor = subprocess.Popen(cmd_escritura, stdin=subprocess.PIPE)
    tam = ancho * alto * 3
    pol, k = None, 0
    try:
        while True:
            buf = lector.stdout.read(tam)
            if len(buf) < tam:
                break
            img = np.frombuffer(buf, np.uint8).reshape(alto, ancho, 3)
            if k % cada == 0:
                nuevo = boca_interior(img)
                if nuevo is None:
                    pol = None
                else:
                    pol = nuevo if pol is None else 0.4 * pol + 0.6 * nuevo
            img = aclarar(img, pol, fuerza)
            escritor.stdin.write(np.ascontiguousarray(img).tobytes())
            k += 1
    finally:
        escritor.stdin.close()
        lector.stdout.close()
        r1, r2 = lector.wait(), escritor.wait()
    if r1 or r2:
        raise RuntimeError(f"ffmpeg falló al aclarar los dientes ({r1}, {r2})")
    return k
