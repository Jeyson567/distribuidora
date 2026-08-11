# Isaac POS

Sistema POS con inventario, socios/áreas, crédito y caja para el proyecto Firebase `isaac-61efd`.

Web estática: HTML, CSS y JavaScript vanilla con módulos ES. Firebase se descarga del CDN
oficial. **No usa Node, npm, Vite ni ningún empaquetador.**

## Cómo abrir el sistema

Los módulos de JavaScript exigen una dirección `http(s)`, así que no funciona con `file://`
(en ese caso la propia página lo explica en pantalla). Sirve cualquiera de estas opciones:

- **GitHub Pages**: suba el repositorio y active Pages sobre la rama principal, carpeta raíz.
- **Live Server / Live Preview** de VS Code, o cualquier servidor estático local.
- **Firebase Hosting**: `firebase deploy --only hosting`.

`index.html` es la aplicación y `setup.html` la instalación inicial, que se abre a mano una
sola vez y no aparece en el menú.

## Activación

1. Despliegue reglas e índices: `firebase deploy --only firestore`.
2. En Firebase Authentication habilite **Email/Password**.
3. Abra `setup.html`. Ahí se crea la cuenta del administrador, los datos del negocio, el
   CLIENTE GENERAL, los correlativos y las unidades de medida estándar. Después de ejecutarse
   se bloquea solo y no permite crear otro administrador.
4. Deshabilite el registro de nuevas cuentas en la consola de Firebase.
5. Entre al sistema, registre socios, categorías y productos, abra la caja y comience a operar.

Los documentos de configuración que falten se pueden crear desde la propia aplicación; no hay
que tocar la consola de Firebase. No se incluyen datos de demostración. Las cantidades se
guardan como milésimas de la unidad base y los importes como centavos enteros.

## Sesión y permisos

El ingreso son dos preguntas distintas, resueltas por dos servicios distintos:

1. **¿Hay sesión?** La responde Firebase Authentication (`js/services/auth.js`). No tener
   sesión es el estado normal de partida y muestra el formulario de ingreso, nunca un error.
2. **¿Esa sesión puede operar?** La responde Firestore comparando el UID contra
   `configuracion/sistema.adminUid`.

Si la segunda pregunta no se puede responder —Firestore sin conexión, reglas sin desplegar—
la sesión **no** se cierra ni se finge un fallo de Authentication: se reintenta sola y, si aun
así no hay respuesta, se muestra el código real de Firebase con un botón para reintentar.

## Reglas de negocio

- Los registros financieros e inventario no se eliminan: se corrigen por reversos, anulaciones o devoluciones.
- Las compras actualizan el costo promedio ponderado; las líneas de venta conservan su costo histórico.
- Los socios son entidades de negocio, no cuentas de acceso. Cada producto pertenece a uno
  y la ganancia se reparte por socio dentro de una misma venta.
- Cada producto define sus unidades de venta y compra; la conversión a la unidad base se
  resuelve con el factor guardado en el producto, nunca con datos enviados por el navegador.
- Se requiere una caja abierta para ventas, cobros, pagos y gastos.

## Estructura

- `index.html`, `setup.html` — las dos páginas. Cada una declara el import map que resuelve
  `firebase/*` contra el CDN; ahí se cambia la versión del SDK.
- `js/firebase.js` — **configuración de Firebase**: el único archivo que hay que editar para
  apuntar a otro proyecto.
- `js/domain` — reglas de negocio puras. Cada operación devuelve un *plan* de escrituras.
- `js/services` — Firestore, autenticación, reportes e impresión. El ejecutor aplica los
  planes dentro de una transacción.
- `js/pages` y `js/ui` — pantallas y componentes de interfaz.
- `css/styles.css` — hoja de estilos ya compilada (Tailwind). Se edita directamente.
- `boot-check.js` — evita la pantalla en blanco si algo no carga.
