// Varios tratamientos reservados juntos (p.ej. una sesión de bono + un
// tratamiento suelto) comparten el mismo evento de Google Calendar — cada
// uno es una fila independiente en la Sheet, pero todos apuntan al mismo
// calendarId+eventId. Antes de borrar ese evento al cancelar/eliminar uno
// de ellos, hay que comprobar que no queda ningún otro tratamiento activo
// colgado del mismo evento, o se le borraría la cita a esos también aunque
// su fila siga diciendo "confirmed".
function hasOtherActiveBookingsOnSameEvent(booking, allBookings) {
  if (!booking.calendarId || !booking.eventId) return false;
  return allBookings.some((b) => (
    b.bookingId !== booking.bookingId
    && b.calendarId === booking.calendarId
    && b.eventId === booking.eventId
    && b.status === 'confirmed'
  ));
}

module.exports = { hasOtherActiveBookingsOnSameEvent };
