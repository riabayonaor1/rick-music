# Rick Music

Editor independiente de partituras que funciona en el navegador, en ordenador, tableta y móvil.

**[Abrir Rick Music](https://riabayonaor1.github.io/rick-music/)** · [Repositorio](https://github.com/riabayonaor1/rick-music)

## Uso

1. Selecciona un compás de la partitura.
2. Elige la duración e introduce notas con el teclado en pantalla o con las teclas A–G. La opción **Octava** cambia el registro.
3. Usa **Reproducir** para escuchar el documento. El navegador puede requerir una primera interacción para activar el audio.
4. Pulsa **Guardar** para descargar una copia editable `.rickmusic`. **Abrir** permite volver a cargarla.

La recuperación automática se guarda en ese navegador y dispositivo. Conserva también una copia descargada: borrar los datos del navegador elimina esa recuperación.

### En móvil

- **Herramientas** abre la paleta de notación; **Documento** abre los datos de la obra, los instrumentos y las propiedades de la nota seleccionada. Puedes cerrar cada panel para volver a la partitura.
- **Ajustar** adapta la hoja al ancho disponible. El selector de zoom permite ampliarla cuando necesites editar con más precisión.
- Con un zoom mayor, desplaza la partitura horizontal y verticalmente dentro de su área. Las barras de controles también se pueden desplazar cuando no caben en pantalla.
- Gira el teléfono para disponer de más espacio horizontal y usa el teclado en pantalla para introducir notas.
- Para formar un acorde, selecciona una nota, activa **＋ Acorde** y toca el piano para añadir alturas. Desactiva el botón para seguir introduciendo notas individuales.
- En **HyperScribe** o **Transcripción**, inicia la grabación y toca el piano en pantalla: mantener y soltar una tecla registra su duración. Pulsa **Finalizar grabación** para convertir la interpretación en notas.

### Archivos y exportación

- Documento editable: `.rickmusic`; también se leen `.partitura` y `.json` compatibles.
- Intercambio: MusicXML (`.musicxml`, `.xml`, `.mxl`) y MIDI (`.mid`, `.midi`). Los datos visuales que cada formato no admite pueden perderse al exportar.
- Audio: exportación MP3 con la síntesis de la edición web; máximo de 5 minutos por archivo en dispositivos táctiles y 30 minutos en escritorio.
- Impresión: **Imprimir / PDF** abre el diálogo del navegador. La opción de guardar en PDF depende del sistema.
- MUSX: importación compatible y devolución del archivo original sin cambios; la escritura de documentos nuevos o modificados permanece limitada hasta validarla en Finale.

Hay ejemplos de documentos y formatos de intercambio en [`Ejemplos/`](Ejemplos/).

## Alcance de la edición web

La reproducción utiliza sonido sintetizado localmente y timbres aproximados. En Safari para iPhone se solicita el modo de reproducción musical para que el interruptor de silencio no silencie la partitura. Si el navegador no admite esa opción, desactiva el modo silencio; comprueba también el volumen multimedia y la salida de audio seleccionada. La aplicación nativa de macOS usa otro motor de audio; sus timbres y funciones del sistema no se trasladan al navegador.

La entrada desde un teclado MIDI externo depende de que el navegador implemente **Web MIDI**, del dispositivo conectado y del permiso concedido. La introducción con el teclado en pantalla y A–G sigue disponible. HyperScribe y Transcripción convierten una interpretación de notas en notación; no transcriben grabaciones acústicas.

El editor admite hasta 8 pentagramas, 128 compases y 4 capas por pentagrama. El catálogo incluye 146 perfiles instrumentales. Esta es una implementación independiente con un alcance parcial de notación; consulta [`FUNCIONES.txt`](FUNCIONES.txt) y [`LEEME.txt`](LEEME.txt) para conocer los límites de las herramientas y formatos.

## Desarrollo local

Requiere Node.js 24 y npm. Para utilizar el servidor local incluido, instala también Python 3.

```sh
npm ci
npm test
npm run build
npm start
```

Abre [http://localhost:8765](http://localhost:8765). Tras modificar `src/`, vuelve a ejecutar `npm run build` y recarga el navegador. La interfaz y los recursos estáticos están en `dist/`; el motor se compila desde `src/app.js` a `dist/app.js`.

`npm test` ejecuta las pruebas JavaScript del modelo, los formatos y los motores de la aplicación. Las pruebas nativas de macOS son independientes y no forman parte del despliegue web.

Para verificar también la interfaz compilada con Chromium:

```sh
npx playwright install --with-deps chromium
npm run test:web
```

Ejecuta primero `npm run build` para que la verificación use los últimos cambios. Las pruebas web comprueban el funcionamiento en tamaños de escritorio y móvil.

## Publicación en GitHub Pages

El workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) se ejecuta al subir cambios a `main` o al iniciarlo manualmente desde **Actions**. Instala las dependencias con `npm ci`, ejecuta `npm test`, compila con `npm run build`, instala Chromium y ejecuta `npm run test:web`. Si las comprobaciones terminan correctamente, publica únicamente `dist/`.

En **Settings → Pages → Build and deployment**, la fuente debe ser **GitHub Actions**. La URL del proyecto es:

**[https://riabayonaor1.github.io/rick-music/](https://riabayonaor1.github.io/rick-music/)**

Los recursos usan rutas relativas para funcionar bajo `/rick-music/`. No hacen falta claves API ni un servidor de aplicación para la edición y el audio del navegador. GitHub Pages sirve la web mediante HTTPS.

## Créditos y licencias

Los avisos de las dependencias se conservan en [`TERCEROS.txt`](TERCEROS.txt) y [`LICENSES/`](LICENSES/). Los archivos en `native/` y los scripts de compilación de macOS corresponden a la edición de escritorio.
