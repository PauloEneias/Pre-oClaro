// Funções puras para testar nossa validação sem depender do MySQL.
export type LocationFilter = { lat: number; lon: number; radiusKm: number };

export function parseLocationFilter(query: Record<string, unknown>): LocationFilter | null {
  const latMissing = query.lat === undefined || query.lat === '';
  const lonMissing = query.lon === undefined || query.lon === '';
  if (latMissing && lonMissing) return null;
  if (latMissing || lonMissing) throw new Error('Informe lat e lon juntos.');
  if (!isValidDecimal(query.lat) || !isValidDecimal(query.lon)) throw new Error('Coordenadas inválidas.');
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('Coordenadas fora do intervalo permitido.');
  const rawRadius = query.radiusKm ?? '10';
  if (!isValidDecimal(rawRadius)) throw new Error('Raio inválido.');
  const radiusKm = Number(rawRadius);
  if (radiusKm <= 0 || radiusKm > 30) throw new Error('O raio deve ser maior que 0 e no máximo 30 km.');
  return { lat, lon, radiusKm };
}

function isValidDecimal(input: unknown): boolean {
  return typeof input === 'string' && /^-?\d+(?:\.\d+)?$/.test(input) && Number.isFinite(Number(input));
}

// Distância aproximada em linha reta, usada no teste unitário.
export function haversineKm(a: {lat:number;lon:number}, b: {lat:number;lon:number}) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
