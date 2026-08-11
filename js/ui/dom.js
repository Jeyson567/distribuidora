import { explainError } from '../services/errors.js';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ENTITIES[character]);

export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

export function notice(message, tone = 'ok') {
  const host = qs('#toasts') || document.body;
  const node = document.createElement('div');
  node.className = `pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
    tone === 'error' ? 'bg-red-700' : tone === 'warn' ? 'bg-amber-600' : 'bg-teal-700'}`;
  node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  node.textContent = message;
  host.append(node);
  setTimeout(() => node.remove(), tone === 'error' ? 7000 : 4000);
}

/**
 * Shows a readable message to the operator and keeps the technical detail in
 * the console for diagnosis.
 */
export function reportError(error, fallback) {
  console.error(error);
  notice(explainError(error, fallback).message, 'error');
}

export function closeDialogs() {
  qsa('dialog[data-app-dialog]').forEach((dialog) => {
    dialog.close();
    dialog.remove();
  });
}

/**
 * Opens a modal form. `onSubmit` receives the FormData; while it runs the
 * submit button is disabled so a double click cannot duplicate a document.
 */
export function openModal({ title, body, submitLabel = 'Guardar', size = 'md', onSubmit, onReady }) {
  const widths = { sm: '28rem', md: '38rem', lg: '52rem', xl: '68rem' };
  const dialog = document.createElement('dialog');
  dialog.dataset.appDialog = 'true';
  dialog.className = 'w-[calc(100vw-2rem)] rounded-xl p-0 shadow-2xl backdrop:bg-slate-900/60';
  dialog.style.maxWidth = widths[size] || widths.md;
  dialog.innerHTML = `
    <form method="dialog" class="flex max-h-[85vh] flex-col">
      <header class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <h2 class="text-lg font-bold">${esc(title)}</h2>
        <button type="button" data-close class="rounded-lg px-2 text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Cerrar">&times;</button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">${body}</div>
      <p data-error class="mx-6 hidden rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"></p>
      <footer class="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button type="button" data-close class="btn-secondary">Cancelar</button>
        <button type="submit" data-submit class="btn-primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  document.body.append(dialog);

  const form = qs('form', dialog);
  const submit = qs('[data-submit]', dialog);
  const errorBox = qs('[data-error]', dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  qsa('[data-close]', dialog).forEach((button) => { button.onclick = close; });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    errorBox.classList.add('hidden');
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Guardando…';
    try {
      await onSubmit(new FormData(form), { form, dialog, close });
      close();
    } catch (error) {
      console.error(error);
      const { message, link } = explainError(error, 'No se pudo completar la operación. No se realizaron cambios.');
      errorBox.innerHTML = link
        ? `${esc(message)} <a href="${esc(link)}" target="_blank" rel="noopener" class="font-semibold underline">Crear el índice</a>`
        : esc(message);
      errorBox.classList.remove('hidden');
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  dialog.showModal();
  onReady?.({ dialog, form, close });
  return { dialog, form, close };
}

/** Confirmation for destructive or financially relevant actions. */
export function confirmAction({ title, message, confirmLabel = 'Confirmar', tone = 'primary' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.dataset.appDialog = 'true';
    dialog.className = 'w-[calc(100vw-2rem)] max-w-md rounded-xl p-0 shadow-2xl backdrop:bg-slate-900/60';
    dialog.innerHTML = `
      <div class="p-6">
        <h2 class="text-lg font-bold">${esc(title)}</h2>
        <p class="mt-2 text-sm text-slate-600">${esc(message)}</p>
        <div class="mt-6 flex justify-end gap-2">
          <button type="button" data-cancel class="btn-secondary">Cancelar</button>
          <button type="button" data-ok class="${tone === 'danger' ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.append(dialog);
    const finish = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    qs('[data-cancel]', dialog).onclick = () => finish(false);
    qs('[data-ok]', dialog).onclick = () => finish(true);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.showModal();
  });
}

/** Disables a button while an async action runs to avoid duplicate documents. */
export async function withBusy(button, label, action) {
  if (!button) return action();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
