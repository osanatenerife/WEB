# Estilo de Reels de Osana

Guía fija para editar todos los vídeos de Instagram de Osana con el mismo
acabado profesional. La herramienta `build_reel.py` aplica todo esto de forma
automática a partir de una tabla de tomas en JSON.

## Cómo se trabaja

1. La dueña sube los vídeos originales (sin pasar por WhatsApp) a un *Release*
   de GitHub de `osanatenerife/WEB`, en la zona «Attach binaries» (admite hasta 2 GB por archivo).
   Se descargan por la API (`Accept: application/octet-stream`).
2. Se miran los clips (hojas de contacto con marca de tiempo) y se escribe la
   tabla de tomas: `reel-<tema>.json`, siguiendo `reel-cuanto-llevo-en-mi-cara.json`.
3. Se monta con:
   ```
   pip install numpy "opencv-python-headless<5"
   python3 tools/reels/build_reel.py tools/reels/reel-<tema>.json \
       --fuentes <carpeta-videos> --salida <carpeta-salida>
   ```
4. Se revisan fotogramas antes de entregar: textos nunca sobre la cara, color
   igual en todos los clips. El vídeo final debe pesar menos de 30 MB.

Referencias de edición: Reels de @goldenbrows_ («¿Cuánto dinero llevo en mi
cara?» y «¿Qué es un lifting de pestañas?»), guardados como borrador en los
Releases del repositorio.

## Imagen: cinematográfica y natural

- Exposición de la cara igualada entre clips: la piel queda al ~58 % de luminancia.
- Curva suave: sombras apenas levantadas y luces algo bajadas. Si se exagera,
  la piel se aplana y parece filtrada; a la dueña no le gusta.
- Piel **neutra, nunca amarilla**, con saturación casi natural (~0,97).
- Balance de blancos igualado con la pared como referencia.
- **Textura de piel real**: sin reducción de ruido, sin filtro de belleza y sin
  suavizado. Nitidez ligera y grano finísimo.
- Viñeta muy suave.

## Montaje

- Vertical 1080×1920, 30 fps.
- Cortes secos cada 2–4 s, sin transiciones. Fuera los momentos en que entra o
  sale de plano y los silencios.
- Encuadre que alterna **plano medio y plano cerrado** en cada corte (jump cut
  tipo dos cámaras), siempre centrado en la cara, con los ojos en el tercio superior.
- Entre bloques de tema: destello suave de 0,25 s con un «whoosh».
- **Sin cartela final ni logo.**

## Textos

- Zonas libres: 15 % superior y 25 % inferior de la pantalla.
- **Nunca sobre la cara.** La cara se detecta automáticamente en cada toma.
- **Subtítulos del diálogo**: grandes (Montserrat ExtraBold 80 px, blanco),
  justo **debajo de la barbilla**. Se construyen palabra a palabra, en grupos
  de hasta 3 palabras en una sola línea.
- **Tema / precio**: en un **recuadro negro semitransparente redondeado**, con
  el tema en mayúsculas blancas y el precio en **dorado** (#EEC662) entrando
  con un «pop». El recuadro va **encima de la cabeza** si hay sitio; si no,
  abajo, sin pasar del 75 % de la pantalla.
- Gancho del primer segundo: en el recuadro, efecto máquina de escribir.
  Palabra clave en dorado (en la tabla se escribe entre `*asteriscos*`).
- Todos los textos llevan sombra negra suave al 40 %. Si el fondo detrás de
  los subtítulos es claro, se añade una franja oscura difuminada.

## Audio

- **El vídeo se entrega sin audio.** La dueña añade al publicar en
  Instagram/Edits un audio en tendencia, que ayuda al alcance.
- Los efectos de sonido generados («pop», «whoosh») **no le gustaron**: no
  usarlos salvo que los pida (`--efectos`). Opcional `--musica`: pad suave.

## Consejos de grabación para la dueña

- **Luz**: una luz grande y suave (softbox o aro con difusor) **de frente**,
  un poco por encima de los ojos (20–30 cm), inclinada hacia abajo, más un
  **reflector blanco o una segunda luz suave a la altura del pecho**, que
  rellena las ojeras desde abajo. Si hay brillo: más distancia o más difusión,
  menos potencia y polvo matificante.
- **Fondo**: la silla a 1–2 m de la pared, para que la sombra caiga detrás y
  fuera de plano y el fondo quede más oscuro.
- **Manos**: gestos tranquilos por debajo del pecho, o sujetando un producto.
  Los subtítulos van a la altura del pecho y las manos los tapan si se mueven ahí.
- **Cámara**: 4K o 1080p a 30 fps, a la altura de los ojos, con el plano
  medio (cabeza a cintura). El reencuadre se hace en edición.
- **Voz**: micro de solapa. Si no hay voz real, el guion se escribe y los
  subtítulos se reparten por tiempo.
