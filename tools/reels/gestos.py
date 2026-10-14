"""Gestos de la cara fotograma a fotograma: ojos cerrándose y boca abierta.

La dueña no quiere ningún corte que la deje con los ojos a medio cerrar, la boca
abierta en un silencio o un gesto raro. Con el modelo de puntos de la cara de
MediaPipe (FaceLandmarker, con «blendshapes») se mide en cada fotograma:
  - parpadeo: 0 = ojos abiertos … 1 = cerrados (el mayor de los dos ojos)
  - boca:     0 = cerrada … 1 = muy abierta

Requisitos: pip install mediapipe (y, en Linux sin pantalla, libegl1 libgles2).
El modelo (3,7 MB) se descarga la primera vez a la carpeta de caché.
"""
import os
import subprocess
import urllib.request

import numpy as np

MODELO_URL = ("https://storage.googleapis.com/mediapipe-models/face_landmarker/"
              "face_landmarker/float16/1/face_landmarker.task")
OJOS_MAL = 0.22      # por encima, los ojos se ven medio cerrados (aunque los esté abriendo)
OJOS_BIEN = 0.10     # por debajo, claramente abiertos (al mirar abajo, 0,15–0,2 ya parecen entornados)
BOCA_MAL = 0.15      # por encima, la boca se ve abierta (mal en un silencio)
ANCHO, ALTO = 540, 960


class Gestos:
    def __init__(self, ruta, cache):
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision
        modelo = os.path.join(cache, "face_landmarker.task")
        if not os.path.exists(modelo):
            urllib.request.urlretrieve(MODELO_URL, modelo + ".tmp")
            os.replace(modelo + ".tmp", modelo)
        opciones = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=modelo),
                                                output_face_blendshapes=True, num_faces=1)
        self._mp = mp
        self._det = vision.FaceLandmarker.create_from_options(opciones)
        self.ruta = ruta
        self._memo = {}

    def _medir(self, img):
        r = self._det.detect(self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=img))
        if not r.face_blendshapes:
            return 1.0, 1.0                     # sin cara: se trata como fotograma malo
        b = {c.category_name: c.score for c in r.face_blendshapes[0]}
        return max(b["eyeBlinkLeft"], b["eyeBlinkRight"]), b["jawOpen"]

    def tramo(self, a, b, fps=30):
        """{fotograma: (parpadeo, boca)} para los fotogramas entre a y b (s del original)."""
        k0, k1 = int(round(a * fps)), int(round(b * fps))
        faltan = [k for k in range(k0, k1 + 1) if k not in self._memo]
        if faltan:
            ka = faltan[0]
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{ka / fps:.4f}", "-i", self.ruta,
                                  "-frames:v", str(faltan[-1] - ka + 1), "-vf", f"scale={ANCHO}:{ALTO}",
                                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                 capture_output=True, check=True).stdout
            fr = np.frombuffer(raw, np.uint8).reshape(-1, ALTO, ANCHO, 3)
            for i, img in enumerate(fr):
                self._memo[ka + i] = self._medir(np.ascontiguousarray(img))
        return {k: self._memo.get(k, (1.0, 1.0)) for k in range(k0, k1 + 1)}

    def cerrar(self):
        self._det.close()

    def ojos_bien(self, k, margen=2, fps=30):
        """¿Ojos abiertos en el fotograma k y en los «margen» de alrededor?"""
        m = self.tramo((k - margen) / fps, (k + margen) / fps, fps)
        return all(v[0] <= OJOS_MAL for v in m.values())
