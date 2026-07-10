const ExcelJS = require('exceljs');
const { accountingCategoryFor } = require('../config/accountingCategories');

// ============================================================
// Informe trimestral en Excel — misma estructura que la plantilla de
// contabilidad real (una pestaña por mes, una fila por día, columnas
// de categoría C-G y de forma de pago H-J), para que se pueda entregar
// directamente al asesor cada trimestre.
// ============================================================

const MONTH_NAMES_ES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

const CATEGORY_COL = { laser: 'C', corporal: 'D', facial: 'E', cejas: 'F', venta: 'G' };
const PAIDHOW_COL = { efectivo: 'H', tarjeta: 'I', bizum: 'J' };

function round2(n) {
  return Math.round(n * 100) / 100;
}

function monthsForQuarter(quarter) {
  // quarter 1-4 → [monthIndex0, monthIndex0+1, monthIndex0+2]
  const start = (quarter - 1) * 3;
  return [start, start + 1, start + 2];
}

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function firstServiceId(serviceId) {
  return String(serviceId || '').split(',')[0].trim();
}

function normalizePaidHow(paidHow) {
  const p = String(paidHow || '').toLowerCase().trim();
  return PAIDHOW_COL[p] ? p : 'tarjeta'; // por defecto, si no se sabe cómo se pagó se asume tarjeta (como en su plantilla)
}

// Construye, por mes, un mapa día → { laser, corporal, facial, cejas, venta, efectivo, tarjeta, bizum }
function buildMonthlyAggregates({ year, quarter, bookings, sessionBonos, productSales }) {
  const months = monthsForQuarter(quarter);
  const byMonth = {};
  months.forEach((m) => { byMonth[m] = {}; });

  function dayBucket(monthIndex0, day) {
    if (!byMonth[monthIndex0][day]) {
      byMonth[monthIndex0][day] = {
        laser: 0, corporal: 0, facial: 0, cejas: 0, venta: 0,
        efectivo: 0, tarjeta: 0, bizum: 0,
      };
    }
    return byMonth[monthIndex0][day];
  }

  function addRevenue(dateStr, category, amount, paidHow) {
    if (!amount || amount <= 0) return;
    const d = new Date(`${dateStr}T12:00:00`);
    if (Number.isNaN(d.getTime())) return;
    const y = d.getFullYear();
    const m = d.getMonth();
    if (y !== year || !months.includes(m)) return;
    const bucket = dayBucket(m, d.getDate());
    bucket[category] += amount;
    bucket[normalizePaidHow(paidHow)] += amount;
  }

  // 1) Reservas normales + 1ª sesión de cada bono (donde se cobra el pago online)
  (bookings || []).forEach((b) => {
    if (b.status === 'cancelled_refunded') return; // dinero devuelto, no cuenta como facturación
    if (b.bonoId && String(b.sessionNumber) !== '1') return; // sesiones siguientes del bono, ya cobradas antes

    const category = accountingCategoryFor(firstServiceId(b.serviceId));
    const onlinePaid = Number(b.amountPaid) || 0;
    if (!b.date) return;
    addRevenue(b.date, category, onlinePaid, 'tarjeta'); // el pago online siempre es tarjeta (Stripe)

    const finalAmount = b.finalAmount !== undefined && b.finalAmount !== '' ? Number(b.finalAmount) : null;
    if (finalAmount !== null) {
      const remainder = round2(finalAmount - onlinePaid);
      if (remainder > 0) addRevenue(b.date, category, remainder, b.remainderPaidHow);
    }
  });

  // 2) Resto de un bono pagado en el centro (importe y fecha de creación del bono como aproximación,
  //    ya que no se guarda la fecha exacta en la que se cobró el resto)
  (sessionBonos || []).forEach((bo) => {
    const remainingAmount = Number(bo.remainingAmount) || 0;
    if (remainingAmount <= 0 || !bo.remainingPaidHow) return;
    const category = accountingCategoryFor(bo.serviceId);
    const dateStr = String(bo.createdAt || '').slice(0, 10);
    if (!dateStr) return;
    addRevenue(dateStr, category, remainingAmount, bo.remainingPaidHow);
  });

  // 3) Ventas de producto sueltas
  (productSales || []).forEach((s) => {
    const amount = Number(s.amount) || 0;
    if (amount <= 0 || !s.date) return;
    addRevenue(s.date, 'venta', amount, s.paidHow);
  });

  return byMonth;
}

function writeMonthSheet(workbook, { year, monthIndex0, aggregates }) {
  const sheet = workbook.addWorksheet(MONTH_NAMES_ES[monthIndex0]);
  sheet.getColumn('B').width = 12;
  ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].forEach((col) => { sheet.getColumn(col).width = 11; });

  sheet.getCell('B2').value = 'OSANA';
  sheet.getCell('B2').font = { bold: true };

  sheet.getCell('B4').value = 'FECHA';
  sheet.getCell('C4').value = 'TRATAMIENTO';
  sheet.getCell('H4').value = 'EFECTIVO';
  sheet.getCell('I4').value = 'TARJETA';
  sheet.getCell('J4').value = 'BIZUM';
  sheet.getCell('K4').value = 'TOTAL';
  ['B4', 'C4', 'H4', 'I4', 'J4', 'K4'].forEach((ref) => { sheet.getCell(ref).font = { bold: true }; });

  sheet.getCell('C5').value = 'Láser';
  sheet.getCell('D5').value = 'Corporal';
  sheet.getCell('E5').value = 'Facial';
  sheet.getCell('F5').value = 'Depilacion';
  sheet.getCell('G5').value = 'Venta';
  ['C5', 'D5', 'E5', 'F5', 'G5'].forEach((ref) => { sheet.getCell(ref).font = { italic: true }; });

  const numDays = daysInMonth(year, monthIndex0);
  const firstRow = 6;
  const lastRow = firstRow + numDays - 1;

  for (let day = 1; day <= numDays; day += 1) {
    const row = firstRow + day - 1;
    const agg = aggregates[day];
    sheet.getCell(`B${row}`).value = new Date(year, monthIndex0, day);
    sheet.getCell(`B${row}`).numFmt = 'dd/mm/yyyy';
    if (agg) {
      if (agg.laser) sheet.getCell(`C${row}`).value = agg.laser;
      if (agg.corporal) sheet.getCell(`D${row}`).value = agg.corporal;
      if (agg.facial) sheet.getCell(`E${row}`).value = agg.facial;
      if (agg.cejas) sheet.getCell(`F${row}`).value = agg.cejas;
      if (agg.venta) sheet.getCell(`G${row}`).value = agg.venta;
      if (agg.efectivo) sheet.getCell(`H${row}`).value = agg.efectivo;
      if (agg.tarjeta) sheet.getCell(`I${row}`).value = agg.tarjeta;
      if (agg.bizum) sheet.getCell(`J${row}`).value = agg.bizum;
    }
    sheet.getCell(`K${row}`).value = { formula: `SUM(H${row}:J${row})` };
  }

  const totalRow = lastRow + 1;
  sheet.getCell(`B${totalRow}`).value = 'TOTAL';
  sheet.getCell(`B${totalRow}`).font = { bold: true };
  ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach((col) => {
    sheet.getCell(`${col}${totalRow}`).value = { formula: `SUM(${col}${firstRow}:${col}${lastRow})` };
    sheet.getCell(`${col}${totalRow}`).font = { bold: true };
  });
  sheet.getCell(`K${totalRow}`).value = { formula: `SUM(H${totalRow}:J${totalRow})` };
  sheet.getCell(`K${totalRow}`).font = { bold: true };

  sheet.views = [{ state: 'frozen', ySplit: 5 }];
}

async function buildQuarterlyReportWorkbook({ year, quarter, bookings, sessionBonos, productSales }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Osana — informe automático';
  workbook.created = new Date();

  const byMonth = buildMonthlyAggregates({ year, quarter, bookings, sessionBonos, productSales });
  monthsForQuarter(quarter).forEach((monthIndex0) => {
    writeMonthSheet(workbook, { year, monthIndex0, aggregates: byMonth[monthIndex0] });
  });

  return workbook;
}

module.exports = { buildQuarterlyReportWorkbook, MONTH_NAMES_ES, monthsForQuarter };
