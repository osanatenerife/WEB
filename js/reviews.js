// ============================================================
// OSANA — Carrusel de reseñas reales de Google (home)
// ============================================================
(function () {
  const track = document.getElementById('reviews-track');
  if (!track) return;
  const fallbackHtml = track.innerHTML; // reseñas estáticas ya escritas en el HTML, por si falla la API

  const LANG = document.documentElement.lang === 'en' ? 'en' : 'es';
  const prevBtn = document.getElementById('reviews-prev');
  const nextBtn = document.getElementById('reviews-next');

  const STR = {
    loading: { es: 'Cargando reseñas…', en: 'Loading reviews…' },
    countSuffix: { es: (n) => `· Valoración media en Google (${n} reseñas)`, en: (n) => `· Average rating on Google (${n} reviews)` },
  };

  function initial(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function starRow(rating) {
    const full = Math.round(rating || 0);
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
  }

  function renderReviews(data) {
    track.innerHTML = '';
    data.reviews.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'review-card' + (i % 2 === 1 ? ' alt' : '');
      const avatarHtml = r.profilePhotoUrl
        ? `<img class="review-avatar" src="${r.profilePhotoUrl}" alt="${r.authorName}" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="review-avatar-fallback">${initial(r.authorName)}</div>`;
      card.innerHTML = `
        <div class="review-top-row">
          ${avatarHtml}
          <div class="review-name-col">
            <span class="review-author-name">${r.authorName}</span>
            <span class="review-date">${r.relativeTime || ''} · Google</span>
          </div>
        </div>
        <div class="review-stars">${starRow(r.rating)}</div>
        <p class="review-text">"${r.text}"</p>
      `;
      track.appendChild(card);
    });

    const metaCount = document.getElementById('reviews-count-label');
    if (metaCount && data.totalReviews) {
      metaCount.textContent = STR.countSuffix[LANG](data.totalReviews);
    }
    const metaRating = document.getElementById('reviews-rating-label');
    if (metaRating && data.rating) {
      metaRating.textContent = data.rating.toFixed(1);
    }
  }

  function updateNavState() {
    if (!prevBtn || !nextBtn) return;
    prevBtn.disabled = track.scrollLeft <= 4;
    nextBtn.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
  }

  function scrollByCard(dir) {
    const card = track.querySelector('.review-card');
    const amount = card ? card.getBoundingClientRect().width + 2 : 320;
    track.scrollBy({ left: dir * amount, behavior: 'smooth' });
  }

  if (prevBtn) prevBtn.addEventListener('click', () => scrollByCard(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => scrollByCard(1));
  track.addEventListener('scroll', updateNavState, { passive: true });

  async function loadReviews() {
    track.innerHTML = `<p class="reviews-loading">${STR.loading[LANG]}</p>`;
    try {
      const res = await fetch(`${BOOKING_API_BASE}/reviews?lang=${LANG}`);
      if (!res.ok) throw new Error('reviews request failed');
      const data = await res.json();
      if (!data.reviews || !data.reviews.length) throw new Error('no reviews');
      renderReviews(data);
      updateNavState();
    } catch (e) {
      // Si falla la API de Google, dejamos las reseñas estáticas de respaldo que ya había en el HTML
      track.innerHTML = fallbackHtml;
      updateNavState();
    }
  }

  loadReviews();
})();
