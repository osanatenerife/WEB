# Guía de instalación — Tienda Shopify de Productos Naturales

Este paquete contiene el código de cada página, listo para copiar y pegar en tu tienda Shopify. Está pensado para que **no necesites tocar el código del theme**: todo se pega dentro de bloques "Liquid personalizado" desde el propio editor visual de Shopify.

## Antes de empezar

1. Necesitas un theme de Shopify **Online Store 2.0** (todos los themes gratuitos actuales de Shopify lo son: Dawn, Craft, Sense, Refresh, Origin...). Si tu theme es muy antiguo, el bloque "Liquid personalizado" puede no aparecer — en ese caso, cámbialo por uno de los gratuitos oficiales antes de continuar.
2. Ve a **Tienda online (Online Store) → Temas (Themes) → Personalizar (Customize)**.

## Cómo pegar el código en cada página

Para cada archivo de este paquete:

1. Dentro del editor de temas, selecciona la página correspondiente en el desplegable superior (Inicio / Página de producto / Colección / Página / Carrito...).
2. Haz clic en **"Añadir sección" (Add section)** en el punto donde quieres insertar el bloque.
3. Busca y selecciona **"Liquid personalizado" (Custom Liquid)**.
4. Haz clic dentro del cuadro de texto que aparece y pega **todo** el contenido del archivo correspondiente (Ctrl+V / Cmd+V).
5. Pulsa **Guardar (Save)** arriba a la derecha.
6. Repite para cada sección/archivo. Puedes arrastrar las secciones para reordenarlas con las flechas o el icono de arrastre (⠿).

## Orden recomendado

| Archivo | Página en Shopify | Dónde pegarlo |
|---|---|---|
| `01-home.html` | Inicio (Home) | Como una o varias secciones "Liquid personalizado", una debajo de otra, en el orden en que aparece el código (está dividido por comentarios `<!-- SECCIÓN: ... -->`) |
| `02-coleccion.html` | Página de colección/categoría (ej. "Todos los productos") | Justo encima o debajo de la cuadrícula de productos que ya trae el tema |
| `03-producto.html` | Plantilla de producto (Product) | Debajo de la información del producto (precio, botón de compra), como contenido adicional |
| `04-sobre-nosotros.html` | Página nueva "Sobre nosotros" (créala en Páginas → Añadir página, plantilla "page", y dale una URL tipo `/pages/sobre-nosotros`) | Todo el contenido de la página |
| `05-contacto.html` | Página nueva "Contacto" (Páginas → Añadir página) | Todo el contenido de la página |

## Colores y tipografía (sistema de marca)

- Fondo principal: crema `#F7F3EA`
- Beige: `#EAE0CC`
- Marrón tierra (texto/acento): `#5B4636`
- Terracota (botones/CTA): `#B97452`
- Verde salvia (detalles): `#8A9678`
- Tipografía de titulares: **Fraunces** (serif elegante, atemporal, unisex)
- Tipografía de texto: **Jost** (sans-serif limpia, minimalista)

Estas fuentes se cargan automáticamente desde Google Fonts dentro de cada bloque, así que no tienes que instalar nada.

## Consejos

- Cambia los textos entre corchetes `[ASÍ]` por los tuyos (nombre de marca, textos, enlaces).
- Sustituye las imágenes de ejemplo (Unsplash) por fotos reales de tus productos subidas a Shopify: sube la imagen en cualquier bloque de imagen del editor, haz clic derecho → "Copiar enlace de la imagen" y pégalo en el `src=""` correspondiente. O, más fácil: dime qué fotos quieres usar y te digo dónde ponerlas.
- El formulario de contacto y el de newsletter ya usan las etiquetas de formulario nativas de Shopify (`{% form %}`), así que funcionan de verdad en cuanto los pegues (los mensajes llegan al email de tu tienda y los suscriptores a tu lista de clientes).
- Si quieres, luego te ayudo a ajustar cualquier color, texto o proporción — solo dime qué cambiar.
