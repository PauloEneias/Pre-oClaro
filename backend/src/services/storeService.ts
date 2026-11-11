/**
 * SERVICE — mercados próximos.
 * Consulta o OpenStreetMap sob demanda, grava o cadastro público das lojas e deixa o MySQL
 * calcular a distância. A posição do usuário é usada só nesta consulta e nunca é gravada.
 */
import type { LocationFilter } from '../location.js';
import { HttpError } from '../http/errors.js';
import { fetchRealStores } from '../osm.js';
import * as stores from '../repositories/storeRepository.js';

type Logger = { warn: (...args: unknown[]) => void };

/**
 * Mercados próximos: consulta o OpenStreetMap, grava/atualiza as lojas (upsert pelo osm_id)
 * e pede ao MySQL as lojas no raio. Se o OSM falhar, usa o que já está no banco e avisa;
 * sem nada no banco responde 503 — nunca inventa mercados.
 */
export async function nearby(location: LocationFilter, log: Logger) {
  let sourceStatus: 'updated' | 'mysql_cache' = 'updated';
  let sourceWarning: string | null = null;
  let fetched = 0;
  try {
    const found = await fetchRealStores(location.lat, location.lon, location.radiusKm);
    fetched = found.length;
    await stores.upsertOsmStores(found);
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Consulta OSM indisponível; usando lojas já cadastradas');
    sourceStatus = 'mysql_cache';
    sourceWarning = 'A consulta ao OpenStreetMap falhou. Exibindo somente lojas públicas importadas anteriormente, se houver.';
  }
  const rows = await stores.findNearbyStores(location);
  if (sourceStatus === 'mysql_cache' && rows.length === 0)
    throw new HttpError(503, 'Não foi possível consultar os mercados reais no OpenStreetMap agora. Verifique sua internet e tente novamente. Nenhum mercado fictício foi exibido.');
  return {
    isDemo: false, source: 'OpenStreetMap', sourceStatus, sourceWarning, fetched,
    // Distância em linha reta (não é percurso por ruas).
    measurement: 'straight_line_km', radiusKm: location.radiusKm,
    attribution: '© OpenStreetMap contributors · ODbL',
    stores: rows,
  };
}
