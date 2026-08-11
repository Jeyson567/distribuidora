export const COL = {
  settings: 'configuracion',
  partners: 'socios',
  categories: 'categorias',
  units: 'unidades',
  products: 'productos',
  inventory: 'movimientosInventario',
  sales: 'ventas',
  purchases: 'compras',
  customers: 'clientes',
  receivables: 'cuentasPorCobrar',
  customerPayments: 'pagosClientes',
  suppliers: 'proveedores',
  payables: 'cuentasPorPagar',
  supplierPayments: 'pagosProveedores',
  expenses: 'gastos',
  waste: 'mermas',
  returns: 'devoluciones',
  cashRegisters: 'cajas',
  cashMoves: 'movimientosCaja',
  audit: 'auditoria',
};

export const SETTINGS_DOC = {
  system: 'sistema',
  business: 'negocio',
  counters: 'correlativos',
  activeCash: 'cajaActiva',
};

export const MOVEMENT = {
  initial: 'INVENTARIO_INICIAL',
  purchase: 'COMPRA',
  sale: 'VENTA',
  saleReturn: 'DEVOLUCION_VENTA',
  supplierReturn: 'DEVOLUCION_PROVEEDOR',
  waste: 'MERMA',
  adjustIn: 'AJUSTE_POSITIVO',
  adjustOut: 'AJUSTE_NEGATIVO',
};

export const PAYMENT = {
  cash: 'EFECTIVO',
  card: 'TARJETA',
  transfer: 'TRANSFERENCIA',
  credit: 'CREDITO',
};

export const PAYMENT_METHODS = [PAYMENT.cash, PAYMENT.card, PAYMENT.transfer, PAYMENT.credit];
export const SETTLED_METHODS = [PAYMENT.cash, PAYMENT.card, PAYMENT.transfer];

export const CASH_MOVE = {
  opening: 'APERTURA',
  sale: 'VENTA',
  customerPayment: 'COBRO_CREDITO',
  supplierPayment: 'PAGO_PROVEEDOR',
  purchase: 'COMPRA',
  expense: 'GASTO',
  withdrawal: 'RETIRO',
  deposit: 'INGRESO',
  saleReturn: 'DEVOLUCION',
  supplierReturn: 'DEVOLUCION_PROVEEDOR',
};

export const STATUS = {
  active: 'ACTIVA',
  cancelled: 'ANULADA',
  open: 'ABIERTA',
  closed: 'CERRADA',
  pending: 'PENDIENTE',
  partial: 'PARCIAL',
  settled: 'PAGADA',
};

export const WASTE_REASONS = ['Podrido', 'Dañado', 'Vencido', 'Derrame', 'Pérdida', 'Error de inventario', 'Otro'];

export const EXPENSE_CATEGORIES = [
  'Transporte', 'Combustible', 'Electricidad', 'Agua', 'Alquiler',
  'Mantenimiento', 'Salarios', 'Compras pequeñas', 'Otros',
];

export const UNIT_DIMENSIONS = {
  PESO: { label: 'Peso', reference: 'libra' },
  VOLUMEN: { label: 'Volumen', reference: 'litro' },
  CONTEO: { label: 'Conteo', reference: 'unidad' },
};

// equivalenciaMilli: thousandths of the dimension reference unit contained in
// one unit. Editable from the Unidades screen when a business uses different
// local equivalences (for example a 50 lb sack instead of a 100 lb one).
export const DEFAULT_UNITS = [
  { nombre: 'Unidad', abreviatura: 'u', dimension: 'CONTEO', equivalenciaMilli: 1000 },
  { nombre: 'Docena', abreviatura: 'doc', dimension: 'CONTEO', equivalenciaMilli: 12000 },
  { nombre: 'Caja', abreviatura: 'caja', dimension: 'CONTEO', equivalenciaMilli: 24000 },
  { nombre: 'Libra', abreviatura: 'lb', dimension: 'PESO', equivalenciaMilli: 1000 },
  { nombre: 'Kilogramo', abreviatura: 'kg', dimension: 'PESO', equivalenciaMilli: 2205 },
  { nombre: 'Arroba', abreviatura: '@', dimension: 'PESO', equivalenciaMilli: 25000 },
  { nombre: 'Quintal', abreviatura: 'qq', dimension: 'PESO', equivalenciaMilli: 100000 },
  { nombre: 'Saco', abreviatura: 'saco', dimension: 'PESO', equivalenciaMilli: 100000 },
  { nombre: 'Litro', abreviatura: 'L', dimension: 'VOLUMEN', equivalenciaMilli: 1000 },
  { nombre: 'Galón', abreviatura: 'gal', dimension: 'VOLUMEN', equivalenciaMilli: 3785 },
];
