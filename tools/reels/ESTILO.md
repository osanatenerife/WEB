# Estilo de Reels de Osana

Guía fija para editar todos los vídeos de Instagram de Osana con el mismo
acabado profesional. La herramienta `build_reel.py` aplica todo esto de forma
automática a partir de una tabla de tomas en JSON.

## Cómo se trabaja

1. La dueña sube los vídeos originales (sin pasar por WhatsApp) a un *Release*
   de GitHub de `osanatenerife/WEB`, en la zona «Attach binaries» (admite hasta 2 GB por archivo).
   Se descargan por la API (`Accept: application/octet-stream`).
2. Se miran los clips (hojas de contacto con marca de tiempo) y se escribe la
   tabla de tomas: `reel-<tema>.json`. Ejemplos: `reel-cuanto-llevo-en-mi-cara.json`
   (sin voz, diálogo inventado) y `reel-laser-shr-no-duele.json` (con voz real).
   **Si hay voz**: se transcribe todo con `transcribir.py` (ver abajo), se elige
   la mejor toma de cada frase (la dueña repite varias veces la misma frase) y
   se corta en las pausas reales entre palabras. Los subtítulos usan sus palabras
   exactas. Nunca se añaden promociones o datos que ella no diga.
3. Se monta con:
   ```
   pip install numpy "opencv-python-headless<5"
   python3 tools/reels/build_reel.py tools/reels/reel-<tema>.json \
       --fuentes <carpeta-videos> --salida <carpeta-salida>
   ```
   Transcripción (los hosts de modelos habituales están bloqueados; GitHub no):
   ```
   pip install sherpa-onnx soundfile
   curl -L -o w.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2
   curl -L -o silero_vad.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
   python3 tools/reels/transcribir.py <carpeta-modelos> <audio-16k.wav> <salida.json>
   ```
4. Se revisan fotogramas antes de entregar: textos nunca sobre la cara, color
   igual en todos los clips. El vídeo final debe pesar menos de 30 MB.

Referencias de edición: Reels de @goldenbrows_ («¿Cuánto dinero llevo en mi
cara?» y «¿Qué es un lifting de pestañas?»), guardados como borrador en los
Releases del repositorio.

## Imagen: cinematográfica y natural

- **Si la luz de la grabación ya es buena, no se aplica ningún filtro.** Dos veces le
  ha parecido que el filtro le dejaba la cara «blanca», «poco cálida» y falsa: ella
  prefiere su luz natural. Nunca enfriar ni blanquear la piel.
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
  Las frases largas se parten en dos tomas seguidas con distinto encuadre.
- En demostraciones (máquina, brazo, cabezal) el encuadre se fija en la tabla
  con `zoom` y `centro_x` para que se vea la acción, no solo la cara.
- **No ir con prisa en los pasos y demostraciones**: después de cada paso, un
  plano de recurso de 2,5–3 s sin diálogo mostrando la acción (extender el gel,
  ponerse las gafas, coger el cabezal…), y la prueba del tratamiento alargada
  (~5–8 s en total). La dueña quiere que se vea bien el tratamiento. En la
  tabla: toma sin `dialogo`, con `volumen` ~0,6 para el sonido ambiente.
- En los planos de recurso, zoom moderado (~1,4) para que se vean a la vez la
  cara y la acción; con zoom mayor la cara queda cortada en el borde.
- **Nunca un plano en silencio con la boca abierta o un gesto raro** (se nota
  y queda mal). Si en un recurso pasa eso, encuadrar solo el detalle (manos,
  cabezal, máquina) con `centro_y` (~0,6) y sin la cara.
- Entre bloques de tema: destello suave de 0,25 s con un «whoosh».
- **Sin cartela final ni logo.**

## Montaje dinámico sin voz (anuncios, TikTok)

- Herramienta: `montaje_dinamico.py` con una tabla como `montaje-laser-shr-hombre.json`.
- **Dinámico pero sin prisa** (la primera versión, muy acelerada, no le gustó):
  planos de 1,5–2,5 s, el láser a velocidad normal («que se vea que es rápido, no
  acelerarlo»), el gel como mucho ×1,2, zoom suave (7 %) y un destello corto solo
  cuando cambia el texto. El resplandor rojo del láser hace de destello natural.
- **Para su Instagram, sin textos** (`--sin-texto`): los recuadros de texto «no
  gustan» en su cuenta. El mensaje (beneficios y llamada a reservar) va en el pie
  del Reel. Los destellos se quedan donde cambiaba el texto. Sin audio: ella pone
  la canción o la voz en off.
- Si alguna vez se piden textos: **beneficios**, no «Paso 1, Paso 2». Recuadro oscuro
  (`&H40&`) con letra grande (84 px), gancho arriba con máquina de escribir y cierre
  con «Reserva en osana.es».
- Se puede decir **«láser»** e **«indoloro»** (confirmado por la dueña). Evitar otras
  afirmaciones absolutas o comparativas que no se puedan demostrar («100 %», «más
  efectivo que el diodo», «la mitad de sesiones», «definitiva»), salvo que ella aporte
  datos del fabricante: en publicidad tienen que poder demostrarse.
- Piel: cada clip se lleva a un mismo tono natural (R/G 1,18, R/B 1,42, al 75 %);
  los clips con gel salen muy naranjas sin esta corrección.
- Las personas de los vídeos de láser de octubre son **modelos**: se pueden mostrar.
  Con clientes reales, solo con su permiso por escrito.
- Pie del Reel: breve, gancho en la primera línea, beneficios, sesión de prueba
  gratis y cómo reservar; como mucho **5 hashtags** (límite de Instagram desde
  diciembre de 2025).

## Serie «Te lo cuento» (entrevista)

Estilo **natural**, como las referencias de entrevista que eligió la dueña
(@karbonblackcapilar): su luz tal cual, pocos textos y subtítulos discretos.

- Herramienta: `te_lo_cuento.py` con una tabla por pregunta (`te-lo-cuento-c1-p1.json`…).
  Una pregunta, un clip de 30–60 s. Si hay varias tomas de la misma respuesta, se
  elige la más clara y que no repita lo que ya cuenta otra pregunta (ni frases
  repetidas dentro del mismo clip, como «un buen ambiente, un buen ambiente»).
  Requisitos: `pip install mediapipe` y, en Linux sin pantalla, `apt-get install libegl1 libgles2`.
- **Sin filtro**: la luz y el color como se grabaron. El filtro anterior le dejaba la
  piel blanca y poco cálida y le oscurecía los ojos («un manchón negro»).
- **Sin «Capítulo 1, 2…»** ni etiqueta de serie en el vídeo (si acaso, en el pie de foto).
- La pregunta **solo al inicio**, aparece y desaparece rápido (unos 2–3 s), en el
  silencio antes de responder: mayúsculas espaciadas en **Raleway** (la letra de la
  web) y en el **marrón de la marca** (#6E5A3C, el #8A7350 de la web algo más oscuro
  para que se lea sobre la cortina clara), a la izquierda de la cara. **Nada de
  dorado ni amarillo**: no son los colores de Osana. El primer plano va algo cerrado y
  desplazado para dejar ese hueco.
- Cortes: fuera las pausas de más de ~0,5 s; en cada corte se alterna plano abierto
  (100 %) y cerrado (114 %), con los ojos en el tercio superior. Los planos de más de
  ~5 s se parten en dos encuadres sin cortar el audio. La frase clave va algo más
  cerca (122 %), sin rótulo. Los puntos de corte se comprueban transcribiendo el
  audio unido, para que no se coma ninguna sílaba; titubeos y frases a medias se
  quitan con `corte_inicio` / `corte_fin`.
- Subtítulos pequeños **en mayúsculas espaciadas** (Raleway SemiBold, blancos, sombra
  muy suave), de 2 o 3 palabras y sin puntuación, a la altura del pecho, como en las
  referencias.
- Al final, **«osana.es» pequeño y centrado debajo de las últimas palabras**, que se
  quedan en pantalla hasta el final. Nada de buscador ni cartela.
- **La cara, siempre bien en cada corte**: nunca ojos a medio cerrar, boca abierta en
  un silencio ni gestos raros. `gestos.py` mide ojos y boca en cada fotograma
  (MediaPipe) y el montaje mueve cada corte unos fotogramas hasta uno bueno, sin
  comerse la voz; si parpadea justo al acabar la última palabra, se congela el último
  fotograma bueno (1–3 fotogramas, ya en silencio). Aun así, revisar a ojo el primer y
  el último fotograma de cada plano.
- El clip termina justo al acabar de hablar, con los ojos abiertos y antes de que cambie
  la cara; el primer fotograma, con la expresión que lleva la respuesta (p. ej. la
  cara extrañada de «¿qué es lo que nunca…?»), no sonriendo para luego cambiar.
- Sin música (la pone ella al publicar) y voz sin reducción de ruido.

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

- **Con voz real** (`"voz": true` en la tabla): se mantiene su voz natural,
  comprimida suavemente y a -14 LUFS. Ella añade la música en tendencia muy
  baja por debajo de la voz al publicar.
- **Sin voz**: el vídeo se entrega sin audio y ella añade la música al publicar
  en Instagram/Edits (ayuda al alcance).
- **Ningún efecto de sonido**: ni los sintéticos («pop», «whoosh») ni los clics
  de `tools/reels/sonidos/` le gustaron («son horribles»). No añadir efectos
  salvo que ella misma los pida y los apruebe con una muestra.
- **Sin reducción de ruido en la voz** (afftdn): se comía las sílabas finales
  suaves («potenc…» en vez de «potencia»). Solo filtro de graves, compresión
  ligera y -14 LUFS.

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
