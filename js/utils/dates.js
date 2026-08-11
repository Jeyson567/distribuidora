const startOfDay = (date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};
const endOfDay = (date) => {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
};
const addDays = (date, days) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};

/** Monday-based week start, which is how the business counts its weeks. */
const startOfWeek = (date) => {
  const value = startOfDay(date);
  const weekday = (value.getDay() + 6) % 7;
  return addDays(value, -weekday);
};

/** First or second half of the month, matching local "quincena" payroll use. */
const startOfFortnight = (date) => {
  const value = startOfDay(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() <= 15 ? 1 : 16);
};

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date) => endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));

export const RANGE_PRESETS = [
  ['hoy', 'Hoy'],
  ['ayer', 'Ayer'],
  ['7dias', 'Últimos 7 días'],
  ['semana', 'Esta semana'],
  ['quincena', 'Esta quincena'],
  ['mes', 'Este mes'],
  ['mesAnterior', 'Mes anterior'],
  ['anio', 'Este año'],
  ['personalizado', 'Personalizado'],
];

/**
 * Resolves a preset into an inclusive [from, to] range using real calendar
 * arithmetic, so months of 28, 30 and 31 days all behave correctly.
 */
export function resolveRange(preset, custom = {}, reference = new Date()) {
  const today = startOfDay(reference);
  switch (preset) {
    case 'ayer':
      return { from: addDays(today, -1), to: endOfDay(addDays(today, -1)) };
    case '7dias':
      return { from: addDays(today, -6), to: endOfDay(today) };
    case 'semana':
      return { from: startOfWeek(today), to: endOfDay(today) };
    case 'quincena':
      return { from: startOfFortnight(today), to: endOfDay(today) };
    case 'mes':
      return { from: startOfMonth(today), to: endOfDay(today) };
    case 'mesAnterior': {
      const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: previous, to: endOfMonth(previous) };
    }
    case 'anio':
      return { from: new Date(today.getFullYear(), 0, 1), to: endOfDay(today) };
    case 'personalizado':
      return {
        from: custom.from ? startOfDay(new Date(`${custom.from}T00:00:00`)) : null,
        to: custom.to ? endOfDay(new Date(`${custom.to}T00:00:00`)) : null,
      };
    case 'hoy':
    default:
      return { from: today, to: endOfDay(today) };
  }
}

export const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Whole days a due date is overdue; negative values are still in the future. */
export const daysOverdue = (dueDate, reference = new Date()) => {
  const due = toDate(dueDate);
  if (!due) return null;
  return Math.floor((startOfDay(reference) - startOfDay(due)) / 86400000);
};

export const dueLabel = (dueDate) => {
  const days = daysOverdue(dueDate);
  if (days === null) return 'Sin vencimiento';
  if (days > 0) return `Vencido ${days} día${days === 1 ? '' : 's'}`;
  if (days === 0) return 'Vence hoy';
  return `Faltan ${Math.abs(days)} día${Math.abs(days) === 1 ? '' : 's'}`;
};

export const inputDate = (value) => {
  const date = toDate(value);
  if (!date) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};
