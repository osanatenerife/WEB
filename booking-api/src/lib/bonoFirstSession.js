// Bonos comprados online "para agendar después": el pago online quedó
// guardado en el bono (amountPaidOnline / paymentIntentId) y no en ninguna
// reserva. Cuando se agenda su 1ª sesión — desde Mis reservas o desde el
// panel — esa reserva hereda el pago, igual que si se hubiera agendado al
// comprar. Así:
//  - el informe trimestral cuenta ese ingreso (lee amountPaid de la sesión 1),
//  - al cerrar la cita en el panel se ve lo ya pagado y el resto a cobrar,
//  - y los puntos de fidelidad se calculan sobre lo realmente pagado.
// Solo se hereda una vez: si ya hay una reserva de ese bono con ese pago
// (p.ej. una sesión 1 que luego se canceló y vuelve a agendarse), no se
// repite, para no contar el mismo dinero dos veces.
const { getAllBookings, findBookingById, updateBookingRow } = require('./sheets');
const { earnLoyalty } = require('./loyaltyEarn');

async function firstSessionPaymentFields(bono, sessionNumber) {
  if (Number(sessionNumber) !== 1 || !bono || !bono.paymentIntentId) return {};
  const all = await getAllBookings();
  const alreadyCarried = all.some((b) => b.bonoId === bono.bonoId && b.paymentIntentId === bono.paymentIntentId);
  if (alreadyCarried) return {};
  return {
    price: Number(bono.totalPrice) || '',
    amountPaid: Number(bono.amountPaidOnline) || 0,
    paymentType: bono.paymentType || 'bono',
    paymentIntentId: bono.paymentIntentId,
  };
}

// Si el bono se pagó entero online, la sesión 1 se cierra sola y acumula
// sus puntos (igual que hace el webhook cuando se agenda al comprar).
async function closeFirstSessionIfFullyPaid(bookingId, fields) {
  if (!fields || !fields.paymentIntentId || fields.paymentType !== 'total') return;
  try {
    const saved = await findBookingById(bookingId);
    if (saved) {
      await updateBookingRow(saved._sheetRow, saved, { finalAmount: fields.amountPaid, remainderPaidHow: '' });
      await earnLoyalty({ booking: saved, portionAmount: fields.amountPaid, paidHow: 'tarjeta' });
    }
  } catch (err) {
    console.error('No se pudo cerrar automáticamente la 1ª sesión del bono:', err);
  }
}

module.exports = { firstSessionPaymentFields, closeFirstSessionIfFullyPaid };
