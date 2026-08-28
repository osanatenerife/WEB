const express = require('express');

const router = express.Router();

// Cache en memoria para no llamar a Google en cada visita (y respetar cuota/coste)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
const cache = {}; // { es: { data, fetchedAt }, en: { data, fetchedAt } }

async function fetchGoogleReviews(lang) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (!apiKey || !placeId) {
    throw new Error('Faltan GOOGLE_PLACES_API_KEY o GOOGLE_PLACE_ID en las variables de entorno');
  }
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,rating,user_ratings_total,reviews');
  url.searchParams.set('language', lang === 'en' ? 'en' : lang === 'it' ? 'it' : 'es');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Google Places API: ${data.status} ${data.error_message || ''}`.trim());
  }

  const result = data.result || {};
  return {
    rating: result.rating || null,
    totalReviews: result.user_ratings_total || 0,
    reviews: (result.reviews || []).map((r) => ({
      authorName: r.author_name,
      profilePhotoUrl: r.profile_photo_url,
      rating: r.rating,
      text: r.text,
      relativeTime: r.relative_time_description,
      time: r.time,
    })),
  };
}

router.get('/reviews', async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : req.query.lang === 'it' ? 'it' : 'es';
  const cached = cache[lang];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.json(cached.data);
  }
  try {
    const data = await fetchGoogleReviews(lang);
    cache[lang] = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (err) {
    console.error(err);
    // Si falla y tenemos algo cacheado (aunque esté caducado), lo servimos antes que dar error
    if (cached) return res.json(cached.data);
    res.status(500).json({ error: err.message || 'No se pudieron obtener las reseñas.' });
  }
});

module.exports = router;
