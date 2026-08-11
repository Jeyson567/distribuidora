// The currency symbol is written by hand: browsers and Node place the "Q"
// differently for GTQ, and every amount in the system must read the same way.
const AMOUNT = new Intl.NumberFormat('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QUANTITY = new Intl.NumberFormat('es-GT', { maximumFractionDigits: 3 });
const DATE_TIME = new Intl.DateTimeFormat('es-GT', { dateStyle: 'short', timeStyle: 'short' });
const DATE = new Intl.DateTimeFormat('es-GT', { dateStyle: 'short' });

const toDate = (value) => {
  if (value?.toDate) return value.toDate();
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? null : date;
};

export const money = (cents = 0) => {
  const amount = (Number(cents) || 0) / 100;
  return `${amount < 0 ? '-' : ''}Q${AMOUNT.format(Math.abs(amount))}`;
};

export const quantity = (milli = 0) => QUANTITY.format((Number(milli) || 0) / 1000);

export const dateTime = (value) => {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : '—';
};

export const dateOnly = (value) => {
  const date = toDate(value);
  return date ? DATE.format(date) : '—';
};
