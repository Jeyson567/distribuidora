import { esc, qs } from './dom.js';

const toasts = `
  <div id="toasts" class="pointer-events-none fixed right-4 top-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"></div>`;

/**
 * Shown whenever Firebase Authentication reports no session. Having no session
 * is the normal starting point, so `message` stays empty unless something
 * actually went wrong.
 */
export function loginScreen(root, { message = '', onSubmit }) {
  root.innerHTML = `
    <main class="grid min-h-screen place-items-center bg-slate-100 p-4">
      <form id="login-form" class="card w-full max-w-md space-y-5">
        <div class="text-center">
          <span class="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-700 text-xl font-bold text-white">I</span>
          <h1 class="mt-3 text-2xl font-bold">Isaac POS</h1>
          <p class="mt-1 text-sm text-slate-500">Ingreso del administrador</p>
        </div>
        <p id="login-message" class="${message ? '' : 'hidden '}rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">${esc(message)}</p>
        <label class="block text-sm font-medium">Correo
          <input class="field mt-1" required type="email" name="email" autocomplete="username">
        </label>
        <label class="block text-sm font-medium">Contraseña
          <input class="field mt-1" required type="password" name="password" autocomplete="current-password">
        </label>
        <button class="btn-primary w-full py-2.5">Ingresar</button>
        <p class="text-center text-xs text-slate-500">
          ¿Primera vez? Configure el sistema en <a class="font-semibold text-teal-700 underline" href="./setup.html">setup.html</a>.
        </p>
      </form>
      ${toasts}
    </main>`;

  const form = qs('#login-form', root);
  const button = qs('button', form);
  const box = qs('#login-message', root);

  // A failed login must leave a message that stays on screen: a toast that
  // fades away on its own looks exactly like nothing having happened.
  const showError = (text) => {
    box.textContent = text;
    box.className = 'rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800';
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    box.classList.add('hidden');
    button.disabled = true;
    button.textContent = 'Ingresando…';
    try {
      await onSubmit(new FormData(form), { showError });
    } finally {
      button.disabled = false;
      button.textContent = 'Ingresar';
    }
  };
}

/**
 * The session is valid but the operator cannot be let in yet. Signing them out
 * would disguise an infrastructure problem as a login problem, so the session
 * is kept and the real reason is shown with a way to try again.
 */
export function blockedScreen(root, { title, detail, onRetry, onSignOut }) {
  root.innerHTML = `
    <main class="grid min-h-screen place-items-center bg-slate-100 p-4">
      <div class="card w-full max-w-md text-center">
        <h1 class="text-lg font-bold">${esc(title)}</h1>
        <p id="blocked-detail" class="mt-2 text-sm text-slate-600">${esc(detail)}</p>
        <div class="mt-6 flex justify-center gap-2">
          ${onRetry ? '<button id="retry" class="btn-primary">Reintentar</button>' : ''}
          <button id="signout" class="btn-secondary">Cerrar sesión</button>
        </div>
      </div>
      ${toasts}
    </main>`;
  if (onRetry) qs('#retry', root).onclick = onRetry;
  qs('#signout', root).onclick = onSignOut;
}
