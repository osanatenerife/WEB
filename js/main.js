// ============================================================
// OSANA — Script compartido para todas las páginas
// ============================================================

// ── Menú móvil ──
function openMobileMenu() {
  document.getElementById('mobile-menu').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu() {
  document.getElementById('mobile-menu').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Reveal on scroll ──
document.addEventListener('DOMContentLoaded', () => {
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -5% 0px' });
    reveals.forEach(el => observer.observe(el));

    // Red de seguridad: si por un scroll muy rápido el observer no llega
    // a disparar para algún elemento, lo mostramos igualmente pasado un tiempo
    // para que el contenido nunca quede invisible de forma permanente.
    setTimeout(() => {
      document.querySelectorAll('.reveal:not(.visible)').forEach(el => el.classList.add('visible'));
    }, 1800);
  } else {
    reveals.forEach(el => el.classList.add('visible'));
  }
});

// ── Acordeón de servicios / formaciones ──
// Cada bloque .svc necesita un botón .svc-head[data-target="ID"] y un cuerpo #ID
function toggleSvc(id) {
  const body = document.getElementById('b' + id);
  const head = document.getElementById('h' + id);
  if (!body || !head) return;
  const isOpen = body.classList.contains('open');
  document.querySelectorAll('.svc-body.open').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.svc-head.open').forEach(h => h.classList.remove('open'));
  if (!isOpen) {
    body.classList.add('open');
    head.classList.add('open');
  }
}
