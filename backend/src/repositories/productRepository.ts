/**
 * MODEL/REPOSITORY — produtos, ofertas geolocalizadas e histórico (tabelas produtos,
 * ofertas, historico_precos, precos_online, produto_imagens).
 * Todas as consultas são parametrizadas; nenhum texto do usuário entra no SQL.
 */
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import type { LocationFilter } from '../location.js';
import type { PriceMode } from '../comparison.js';
import { ACCENT_INSENSITIVE, likeTerm } from './catalogRepository.js';

export type OfferRow = {
  id: number; productId: number; storeId: number;
  product: { id: number; name: string; brand: string; size: string; image: string | null; gtin: string | null };
  store: { id: number; name: string; neighborhood: string };
  price: number; sourceType: string; sourceUrl: string | null; offerConditions: string | null;
  observedAt: Date; minimumQuantity: number; distanceKm: number | null;
};
export type ProductSearch = {
  q: string; mode: PriceMode; quantity: number; location: LocationFilter | null;
  storeId: number | null; maxPrice: number | null; freshHours: number | null;
  sort: 'price' | 'distance' | 'name' | 'relevance';
};

/**
 * Imagem do produto: arquivo local dos itens de demonstração ou foto oficial ligada ao
 * MESMO código de barras (produto_imagens). Sem foto confiável o resultado é NULL e a
 * interface mostra um marcador neutro — nunca a foto de outro produto.
 */
export const IMAGE_SQL = `COALESCE(p.imagem,
  (SELECT i.url FROM produto_imagens i WHERE i.gtin=p.gtin
   ORDER BY FIELD(i.fonte,'ATACADAO_SITE','MATEUS_MAIS_SITE'), i.id LIMIT 1))`;

const OFFER_SELECT = `SELECT o.id,p.id AS productId,p.nome AS name,p.marca AS brand,
  p.embalagem AS size,${IMAGE_SQL} AS image,p.gtin,e.id AS storeId,
  e.nome AS storeName,e.bairro AS neighborhood,o.preco AS price,
  o.tipo_fonte AS sourceType,o.fonte_url AS sourceUrl,o.condicao_oferta AS offerConditions,
  o.consultado_em AS observedAt,o.quantidade_minima AS minimumQuantity`;
const OFFER_FROM = `FROM ofertas o JOIN produtos p ON p.id=o.produto_id
  JOIN estabelecimentos e ON e.id=o.estabelecimento_id`;
const DISTANCE = 'ST_Distance_Sphere(POINT(e.longitude,e.latitude),POINT(?,?))/1000';

/** Demonstração e dados reais nunca se misturam na mesma resposta. */
function modeFilter(mode: PriceMode): string {
  return mode === 'demo'
    ? "o.tipo_fonte = 'DEMO'"
    : "o.tipo_fonte IN ('ONLINE','LOJA') AND e.demonstracao = FALSE AND e.osm_id IS NOT NULL AND o.fonte_url IS NOT NULL";
}

function toOffer(r: RowDataPacket): OfferRow {
  return {
    id: Number(r.id), productId: Number(r.productId), storeId: Number(r.storeId),
    product: { id: Number(r.productId), name: r.name, brand: r.brand, size: r.size, image: r.image ?? null, gtin: r.gtin ?? null },
    store: { id: Number(r.storeId), name: r.storeName, neighborhood: r.neighborhood },
    price: Number(r.price), sourceType: r.sourceType, sourceUrl: r.sourceUrl ?? null,
    offerConditions: r.offerConditions ?? null, observedAt: r.observedAt,
    minimumQuantity: Number(r.minimumQuantity), distanceKm: r.distanceKm === null || r.distanceKm === undefined ? null : Number(r.distanceKm),
  };
}

/**
 * Condições comuns à contagem, à página de produtos e à busca das ofertas.
 * `groups` são os termos já interpretados pela relevância (searchRelevance.parseQuery): cada grupo
 * é obrigatório e, dentro dele, basta uma forma (plural, sinônimo). A comparação ignora
 * maiúsculas e acentos ("acucar" encontra "Açúcar"); o GTIN faz parte do texto pesquisado.
 */
function searchWhere(f: ProductSearch, groups: string[][] = []): { sql: string; args: (string | number)[] } {
  const parts = [`e.ativo=TRUE AND o.disponivel=TRUE AND ${modeFilter(f.mode)} AND o.quantidade_minima <= ?`];
  const args: (string | number)[] = [f.quantity];
  for (const group of groups) {
    parts.push(`(${group.map(() => `CONCAT_WS(' ', p.nome, p.marca, p.embalagem, p.gtin) ${ACCENT_INSENSITIVE} LIKE ?`).join(' OR ')})`);
    args.push(...group.map(likeTerm));
  }
  if (f.location) {
    parts.push(`${DISTANCE} <= ?`);
    args.push(f.location.lon, f.location.lat, f.location.radiusKm);
  }
  if (f.storeId) {
    parts.push('e.id = ?');
    args.push(f.storeId);
  }
  if (f.maxPrice !== null) {
    parts.push('o.preco <= ?');
    args.push(f.maxPrice);
  }
  if (f.freshHours !== null) {
    parts.push('o.consultado_em >= UTC_TIMESTAMP() - INTERVAL ? HOUR');
    args.push(f.freshHours);
  }
  return { sql: parts.join(' AND '), args };
}

/** Total real de produtos distintos que atendem aos filtros. */
export async function countProducts(f: ProductSearch): Promise<number> {
  const where = searchWhere(f);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT p.id) AS total ${OFFER_FROM} WHERE ${where.sql}`,
    where.args
  );
  return Number(rows[0]?.total ?? 0);
}

export type ProductCandidate = {
  productId: number; name: string; brand: string; size: string; gtin: string | null;
  best: number; nearest: number | null;
};
/** Teto de candidatos de uma pesquisa (a resposta avisa quando ele é atingido). */
export const PRODUCT_CANDIDATE_LIMIT = 6000;

/**
 * Todos os produtos que passam no pré-filtro da pesquisa, com menor preço e menor distância,
 * SEM paginação: a relevância e a ordenação são decididas no serviço antes de paginar.
 */
export async function searchCandidates(f: ProductSearch, groups: string[][]): Promise<{ rows: ProductCandidate[]; truncated: boolean }> {
  const where = searchWhere(f, groups);
  const nearest = f.location ? `MIN(${DISTANCE})` : 'NULL';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id AS productId, MIN(p.nome) AS name, MIN(p.marca) AS brand, MIN(p.embalagem) AS size, MIN(p.gtin) AS gtin,
       MIN(o.preco) AS best, ${nearest} AS nearest
     ${OFFER_FROM} WHERE ${where.sql} GROUP BY p.id LIMIT ${PRODUCT_CANDIDATE_LIMIT + 1}`,
    [...(f.location ? [f.location.lon, f.location.lat] : []), ...where.args]
  );
  return {
    truncated: rows.length > PRODUCT_CANDIDATE_LIMIT,
    rows: rows.slice(0, PRODUCT_CANDIDATE_LIMIT).map((r) => ({
      productId: Number(r.productId), name: String(r.name), brand: String(r.brand ?? ''), size: String(r.size ?? ''),
      gtin: r.gtin ?? null, best: Number(r.best), nearest: r.nearest === null || r.nearest === undefined ? null : Number(r.nearest),
    })),
  };
}

/** Ids dos produtos de uma página, em ordem determinística (desempate pelo id). Usado sem pesquisa. */
export async function pageOfProductIds(f: ProductSearch, limit: number, offset: number): Promise<number[]> {
  const where = searchWhere(f);
  const byDistance = f.sort === 'distance' && f.location;
  const order = byDistance ? 'nearest ASC, best ASC' : f.sort === 'name' ? 'productName ASC' : 'best ASC';
  const nearest = byDistance ? `, MIN(${DISTANCE}) AS nearest` : '';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id AS productId, MIN(o.preco) AS best, MIN(p.nome) AS productName${nearest}
     ${OFFER_FROM} WHERE ${where.sql}
     GROUP BY p.id ORDER BY ${order}, p.id ASC LIMIT ? OFFSET ?`,
    [...(byDistance ? [f.location!.lon, f.location!.lat] : []), ...where.args, limit, offset]
  );
  return rows.map((r) => Number(r.productId));
}

/** Todas as ofertas elegíveis dos produtos da página (uma consulta só, sem N+1). Os ids já vêm escolhidos. */
export async function offersForProducts(f: ProductSearch, productIds: number[]): Promise<OfferRow[]> {
  if (!productIds.length) return [];
  const where = searchWhere(f);
  const distance = f.location ? { sql: DISTANCE, args: [f.location.lon, f.location.lat] } : { sql: 'NULL', args: [] };
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${OFFER_SELECT},${distance.sql} AS distanceKm ${OFFER_FROM}
     WHERE ${where.sql} AND p.id IN (${productIds.map(() => '?').join(',')})
     ORDER BY o.preco ASC, o.id ASC`,
    [...distance.args, ...where.args, ...productIds]
  );
  return rows.map(toOffer);
}

export type ProductRow = { id: number; name: string; brand: string; size: string; gtin: string | null; image: string | null };

export async function findProduct(id: number): Promise<ProductRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id,p.nome AS name,p.marca AS brand,p.embalagem AS size,p.gtin,${IMAGE_SQL} AS image FROM produtos p WHERE p.id=?`,
    [id]
  );
  const r = rows[0];
  return r ? { id: Number(r.id), name: r.name, brand: r.brand, size: r.size, gtin: r.gtin ?? null, image: r.image ?? null } : null;
}

export async function offersForProduct(productId: number, mode: PriceMode, quantity: number, location: LocationFilter | null): Promise<OfferRow[]> {
  const distance = location ? { sql: DISTANCE, args: [location.lon, location.lat] } : { sql: 'NULL', args: [] };
  const geo = location ? `AND ${DISTANCE}<=?` : '';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${OFFER_SELECT},${distance.sql} AS distanceKm ${OFFER_FROM}
     WHERE p.id=? AND e.ativo=TRUE AND o.disponivel=TRUE AND ${modeFilter(mode)} AND o.quantidade_minima<=? ${geo}
     ORDER BY o.preco ASC,e.nome ASC LIMIT 100`,
    [...distance.args, productId, quantity, ...(location ? [location.lon, location.lat, location.radiusKm] : [])]
  );
  return rows.map(toOffer);
}

export type HistoryRow = { id: number; price: number; observedAt: Date; sourceType: string; storeName: string; minimumQuantity: number };

/** Observações realmente registradas; o histórico nunca é inventado nem interpolado. */
export async function historyForProduct(productId: number, mode: PriceMode, quantity: number, location: LocationFilter | null): Promise<HistoryRow[]> {
  const geo = location ? `AND ${DISTANCE}<=?` : '';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT h.id,h.preco AS price,h.observado_em AS observedAt,
       h.tipo_fonte AS sourceType,h.quantidade_minima AS minimumQuantity,e.nome AS storeName
     FROM historico_precos h JOIN ofertas o ON o.id=h.oferta_id
     JOIN estabelecimentos e ON e.id=o.estabelecimento_id
     WHERE o.produto_id=? AND ${modeFilter(mode)} AND e.ativo=TRUE AND h.quantidade_minima<=? ${geo}
     ORDER BY h.observado_em DESC, h.id DESC LIMIT 80`,
    [productId, quantity, ...(location ? [location.lon, location.lat, location.radiusKm] : [])]
  );
  return rows.map((r) => ({
    id: Number(r.id), price: Number(r.price), observedAt: r.observedAt, sourceType: r.sourceType,
    storeName: r.storeName, minimumQuantity: Number(r.minimumQuantity),
  }));
}

export type OnlinePriceRow = {
  id: number; gtin: string; productName: string; network: string; storeName: string; state: string;
  channel: string; price: number; available: boolean; source: string; observedAt: Date; syncedAt: Date;
};

export async function onlinePrices(gtin: string, uf: string): Promise<OnlinePriceRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, gtin, produto_nome AS productName, rede AS network,
       estabelecimento AS storeName, uf AS state, canal AS channel,
       preco AS price, disponivel AS available, fonte AS source,
       observado_em AS observedAt, sincronizado_em AS syncedAt
     FROM precos_online WHERE gtin=? AND uf=? AND disponivel=TRUE
     ORDER BY preco ASC, observado_em DESC LIMIT 60`,
    [gtin, uf]
  );
  return rows.map((r) => ({ ...(r as unknown as OnlinePriceRow), id: Number(r.id), price: Number(r.price), available: Boolean(r.available) }));
}

/** Quantos produtos têm ao menos uma foto confiável (relatório e health check). */
export async function imageCoverage(): Promise<{ products: number; withImage: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS products, SUM(${IMAGE_SQL} IS NOT NULL) AS withImage FROM produtos p`
  );
  return { products: Number(rows[0]?.products ?? 0), withImage: Number(rows[0]?.withImage ?? 0) };
}
