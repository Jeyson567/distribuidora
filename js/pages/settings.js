import {
  baselineStatus, COL, createMissingBaseline, recent, saveBusinessSettings,
} from '../services/db.js';
import { dataTable, field, pageHeader, statCard, textInput } from '../ui/components.js';
import { esc, notice, qs, reportError } from '../ui/dom.js';
import { dateTime } from '../utils/format.js';

/**
 * Nothing here should ever require opening the Firebase console: the screen
 * lists the documents the system needs and offers to create the missing ones.
 */
function baselineSection(baseline) {
  const missing = baseline.filter((item) => !item.ok);
  const rows = baseline.map((item) => `
    <li class="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
      <span>
        <span class="font-medium">${esc(item.label)}</span>
        <span class="block text-xs text-slate-500">${esc(item.path)}</span>
      </span>
      <span class="rounded-full px-2 py-1 text-xs font-semibold ${item.ok ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-800'}">
        ${item.ok ? 'Creado' : 'Falta'}
      </span>
    </li>`).join('');

  return `
    <section class="card mt-8 max-w-3xl">
      <h2 class="text-lg font-bold">Documentos iniciales</h2>
      <p class="mt-1 text-sm text-slate-600">
        ${missing.length
    ? 'Faltan documentos que el sistema necesita. Créelos desde aquí, sin usar la consola de Firebase.'
    : 'Todos los documentos que el sistema necesita ya existen.'}
      </p>
      <ul class="mt-4 text-sm">${rows}</ul>
      ${missing.length
    ? '<button id="create-baseline" class="btn-primary mt-4">Crear configuración faltante</button>'
    : ''}
    </section>`;
}

export default {
  async load() {
    return { baseline: await baselineStatus() };
  },

  render({ baseline }, ctx) {
    const business = ctx.business || {};
    return `
      ${pageHeader('Configuración del negocio', 'Estos datos aparecen en los comprobantes y reportes impresos.')}
      <form id="settings-form" class="card max-w-3xl space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          ${field('Nombre del negocio', textInput('nombre', { required: true, value: business.nombre || '' }))}
          ${field('Teléfono', textInput('telefono', { value: business.telefono || '' }))}
          ${field('NIT', textInput('nit', { value: business.nit || '' }))}
          ${field('Correo', textInput('correo', { type: 'email', value: business.correo || '' }))}
          ${field('Prefijo de ventas', textInput('prefijoVentas', { value: business.prefijoVentas || 'V', required: true }))}
          ${field('Prefijo de compras', textInput('prefijoCompras', { value: business.prefijoCompras || 'C', required: true }))}
        </div>
        ${field('Dirección', `<textarea name="direccion" class="field mt-1" rows="2">${esc(business.direccion || '')}</textarea>`)}
        ${field('Mensaje al pie del comprobante', textInput('mensajeTicket', { value: business.mensajeTicket || '' }))}
        ${field('URL del logotipo (opcional)', textInput('logoUrl', { value: business.logoUrl || '', placeholder: 'https://…' }))}
        <p class="text-xs text-slate-500">Moneda: quetzales (Q). Los importes se guardan en centavos y las cantidades en milésimas para evitar errores de redondeo.</p>
        <button class="btn-primary">Guardar configuración</button>
      </form>

      ${baselineSection(baseline)}

      <section class="mt-8 grid gap-4 sm:grid-cols-3">
        ${statCard('Socios', String(ctx.catalogs.partners.length))}
        ${statCard('Productos', String(ctx.catalogs.products.length))}
        ${statCard('Clientes', String(ctx.catalogs.customers.length))}
      </section>`;
  },

  bind(_data, ctx) {
    const createButton = qs('#create-baseline');
    if (createButton) {
      createButton.onclick = async () => {
        createButton.disabled = true;
        try {
          const created = await createMissingBaseline();
          notice(created.length
            ? `Configuración creada: ${created.join(', ')}.`
            : 'No faltaba ningún documento.');
          await ctx.refresh();
        } catch (error) {
          createButton.disabled = false;
          reportError(error, 'No se pudo crear la configuración inicial.');
        }
      };
    }

    qs('#settings-form').onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await saveBusinessSettings({
          nombre: (form.get('nombre') || '').trim(),
          telefono: (form.get('telefono') || '').trim(),
          nit: (form.get('nit') || '').trim(),
          correo: (form.get('correo') || '').trim(),
          direccion: (form.get('direccion') || '').trim(),
          mensajeTicket: (form.get('mensajeTicket') || '').trim(),
          logoUrl: (form.get('logoUrl') || '').trim(),
          prefijoVentas: (form.get('prefijoVentas') || 'V').trim().toUpperCase(),
          prefijoCompras: (form.get('prefijoCompras') || 'C').trim().toUpperCase(),
          moneda: 'GTQ',
          simboloMoneda: 'Q',
        });
        notice('Configuración guardada.');
        await ctx.refresh();
      } catch (error) {
        reportError(error, 'No se pudo guardar la configuración.');
      }
    };
  },
};

/** Immutable log of every operation that changes money or inventory. */
export const auditPage = {
  async load() {
    return { entries: await recent(COL.audit, 300) };
  },

  render({ entries }) {
    return `
      ${pageHeader('Auditoría', 'Registro de las operaciones del sistema. No se puede modificar ni borrar.')}
      ${dataTable({
        columns: [
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Módulo', format: (row) => esc(row.modulo || '—') },
          { label: 'Acción', format: (row) => esc(row.accion || '—') },
          { label: 'Documento', format: (row) => esc(row.documentoId || '—') },
          {
            label: 'Detalle',
            format: (row) => esc(Object.entries(row.valores || {})
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ') || '—'),
          },
        ],
        rows: entries,
        empty: 'Todavía no hay operaciones registradas.',
        dense: true,
      })}`;
  },

  bind() {},
};
