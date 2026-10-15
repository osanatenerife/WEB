# Osana — notas para Claude

## Edición de vídeos de Instagram (Reels)

**Formatos fijos.** La dueña quiere que sus vídeos sean iguales casi siempre: no
cambiar letra, tamaños, colores, posiciones ni ritmo salvo que ella lo pida. Cada
vídeo nuevo usa uno de estos dos formatos tal cual; solo cambia el contenido:

1. **Entrevista / hablando a cámara** (el formato por defecto): `tools/reels/te_lo_cuento.py`
   con una tabla por clip (plantilla: `tools/reels/te-lo-cuento-c1-p1.json`). Letra
   **Raleway SemiBold** en mayúsculas espaciadas, pregunta breve al inicio en el marrón
   de la marca, subtítulos pequeños a la altura del pecho y «osana.es» al final.
   **Con imágenes de apoyo** (el formato de su guía: la imagen de cada caso en la mitad de
   abajo, difuminada por arriba): la misma herramienta con «imagenes» en las frases
   (plantilla: `tools/reels/piel-despues-del-verano.json`; tarjetas de la marca con
   `tools/reels/tarjetas.py` mientras ella no mande la foto o el vídeo del caso).
2. **Explicación con prueba de un tratamiento** (como «¿Duele el láser SHR? Me lo pruebo
   yo»): `tools/reels/build_reel.py` (plantilla: `tools/reels/reel-laser-shr-no-duele.json`).
   Letra Montserrat ExtraBold, recuadro oscuro con «Paso N · *Nombre*» y subtítulos
   grandes bajo la barbilla.

Cualquier otro vídeo nuevo, con Raleway SemiBold (la letra de la marca); nunca dorado
ni amarillo fuera del formato 2. Medidas, colores, cortes y audio: `tools/reels/ESTILO.md`
(sección «Formatos fijos»). Antes de montar, `python3 tools/reels/test_formatos.py`
comprueba que nada de eso ha cambiado.

**Temas:** solo depilación láser, eliminación de tatuajes y de micro, micropigmentación de
cejas y piel, más su historia. Nunca pestañas, lifting, laminado, hilo ni corporales (ver
«Temas» en `tools/reels/ESTILO.md`). Como mucho un reel de láser por semana.

Los vídeos originales los sube la dueña a los Releases de GitHub del repositorio.
Montajes dinámicos sin voz: `tools/reels/montaje_dinamico.py`. Los de tratamiento para su
Instagram (tomas cortas, sin texto ni sonido, ella pone la música) llevan `"modo": "limpio"`
(plantilla: `tools/reels/montaje-laser-piernas-1.json`; ver «Montaje de tratamiento limpio» en ESTILO.md).
