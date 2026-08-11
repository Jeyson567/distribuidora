/*
 * Script clásico (sin módulos) incluido por index.html y setup.html.
 *
 * El sistema es una web estática de módulos ES. Los módulos ES exigen ser
 * servidos por HTTP: si la página se abre con file:// el navegador los bloquea
 * y la pantalla queda en blanco sin ningún mensaje.
 *
 * Este guardián convierte ese fallo silencioso en una instrucción legible y
 * también avisa si el CDN de Firebase no está disponible. Nunca ejecuta lógica
 * de la aplicación: en cuanto arranca el punto de entrada real, se detiene.
 */
(function bootCheck() {
  var BOOT_TIMEOUT_MS = 8000;
  var placeholder = document.querySelector('[data-boot]');
  if (!placeholder) return;

  var reported = false;

  function paint(html) {
    placeholder.innerHTML = html;
  }

  function box(title, body) {
    return (
      '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:44rem;margin:3rem auto;' +
      'padding:1.75rem;border:1px solid #e2e8f0;border-radius:14px;background:#fff;color:#0f172a;' +
      'box-shadow:0 10px 30px rgba(15,23,42,.08);line-height:1.55">' +
      '<h1 style="margin:0 0 .75rem;font-size:1.25rem">' + title + '</h1>' + body + '</div>'
    );
  }

  paint(
    '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;display:grid;place-items:center;' +
    'min-height:60vh;color:#64748b">Cargando Isaac POS…</div>'
  );

  function report(title, explanation, reason) {
    if (reported) return;
    reported = true;
    document.title = title + ' \u00b7 Isaac POS';
    paint(box(
      title,
      explanation +
      '<p style="margin:0;color:#64748b;font-size:.875rem">Detalle t\u00e9cnico: ' + reason + '</p>'
    ));
  }

  function reportFileProtocol() {
    report(
      'Abra el sistema desde una direcci\u00f3n http',
      '<p style="margin:0 0 1rem">La p\u00e1gina se abri\u00f3 con <code>file://</code>. Los ' +
      'navegadores bloquean los m\u00f3dulos de JavaScript en ese modo por seguridad, as\u00ed que ' +
      'ning\u00fan sistema web moderno puede arrancar de esa forma.</p>' +
      '<p style="margin:0 0 .5rem;font-weight:600">Formas correctas de abrirlo:</p>' +
      '<ul style="margin:0 0 1rem;padding-left:1.25rem">' +
      '<li>Publicarlo en <strong>GitHub Pages</strong> y entrar por su direcci\u00f3n https.</li>' +
      '<li>Abrirlo con cualquier servidor est\u00e1tico local, por ejemplo la extensi\u00f3n ' +
      '<strong>Live Server</strong> de VS Code o <code>python -m http.server</code>.</li>' +
      '</ul>',
      'protocolo file://, sin servidor http.'
    );
  }

  function reportBootFailure(reason) {
    report(
      'El sistema no termin\u00f3 de cargar',
      '<p style="margin:0 0 1rem">No se pudieron descargar los archivos del sistema o los SDK de ' +
      'Firebase. Revise su conexi\u00f3n a internet (Firebase se descarga desde ' +
      '<code>gstatic.com</code>) y vuelva a cargar la p\u00e1gina.</p>' +
      '<p style="margin:0 0 1rem">Si el problema persiste, abra la consola del navegador con ' +
      '<code>F12</code> para ver el archivo exacto que fall\u00f3.</p>',
      reason
    );
  }

  if (location.protocol === 'file:') {
    reportFileProtocol();
    return;
  }

  // Un script de módulo que no carga (o cuyas importaciones fallan) dispara un
  // evento de error en el elemento, visible solo en fase de captura.
  window.addEventListener('error', function onError(event) {
    var target = event.target;
    if (target && target.tagName === 'SCRIPT' && target.type === 'module') {
      reportBootFailure('el navegador no pudo cargar <code>' + (target.getAttribute('src') || '') + '</code>.');
    }
  }, true);

  setTimeout(function onTimeout() {
    if (window.__ISAAC_POS_BOOTED__) return;
    reportBootFailure('la aplicaci\u00f3n no respondi\u00f3 despu\u00e9s de ' + (BOOT_TIMEOUT_MS / 1000) + ' segundos.');
  }, BOOT_TIMEOUT_MS);
})();
