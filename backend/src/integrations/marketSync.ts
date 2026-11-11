/**
 * backend/src/integrations/marketSync.ts
 *
 * Coleta automática e gravação de preços do PreçoClaro (MySQL).
 *
 * O QUE ESTE ARQUIVO GARANTE
 *  1. Preço antigo nunca substitui preço novo: toda gravação compara a data REAL da
 *     coleta com a que já está no banco e ignora o que for mais antigo.
 *  2. O catálogo inicial (seedSaoLuis.ts) é só fallback histórico: entra uma vez,
 *     com a data original, por INSERT IGNORE, e nunca vira "observação de hoje".
 *  3. Cada observação guarda fonte, URL, data efetiva, unidade, preço e quantidade
 *     mínima (tabela observacoes_preco: uma linha por MUDANÇA de preço).
 *  4. Falha de rede não grava nada e não mexe em datas: o último preço válido
 *     continua no banco com a data em que foi realmente visto.
 *  5. Oferta geolocalizada só é ligada a loja com identificador verdadeiro do
 *     OpenStreetMap (node|way|relation/<número>); nenhum osm_id é inventado.
 *
 * FONTES
 *  - Atacadão São Luís: ligado por padrão (ATACADAO_SYNC_ENABLED=false desliga).
 *  - Mateus Mais: DESLIGADO por padrão — os Termos de Uso proíbem scripts de coleta.
 *    Só liga com MATEUS_SYNC_ENABLED=true (após autorização por escrito).
 *  - Data Market (API contratada): como antes, com MARKET_SYNC_ENABLED=true e chave.
 *
 * O React continua lendo apenas o MySQL pelas rotas da API; nada aqui é chamado pelo navegador.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db.js';
import { fetchMarketQuotes, type OnlineQuote } from './dataMarket.js';
import { gtinValid } from '../csv.js';
import type { CatalogEntry } from '../catalogCsv.js';
import { fetchRealStores } from '../osm.js';
import { haversineKm } from '../location.js';
import { PoliteClient } from './politeHttp.js';
import { atacadaoNotice, collectAtacadao, type EanInfo } from './atacadao.js';
import { collectMateusMais, mateusNotice } from './mateusMais.js';
import {
  SOURCE_LABEL,
  saoLuisDate,
  validateOffer,
  type CollectedOffer,
  type PriceSource,
} from './offerValidation.js';
import { SAO_LUIS_CATALOG_SEED, SEED_REFERENCE_DATE } from './seedSaoLuis.js';

export type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };

/** ISO 8601 → "AAAA-MM-DD HH:MM:SS" em UTC (formato aceito por colunas DATETIME). */
export function mysqlUTC(date: string): string {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

const cents = (value: number) => Math.round(Number(value) * 100);
const samePrice = (a: number, b: number) => cents(a) === cents(b);
const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`));

// ---------------------------------------------------------------------------
// Preços online por UF (tabelas precos_online / historico_precos_online)
// ---------------------------------------------------------------------------

type Current = RowDataPacket & { observado_em: Date; preco: number };

/**
 * Grava cotações online. Só substitui a linha atual se a cotação for MAIS NOVA,
 * e só acrescenta ponto ao histórico quando o preço muda (ou é o primeiro).
 */
export async function saveOnlineQuotes(quotes: OnlineQuote[]): Promise<number> {
  if (!quotes.length) return 0;
  const conn = await pool.getConnection();
  let saved = 0;
  try {
    await conn.beginTransaction();
    for (const q of quotes) {
      const observedAt = mysqlUTC(q.observedAt);
      const [current] = await conn.execute<Current[]>(
        `SELECT observado_em, preco FROM precos_online
         WHERE gtin=? AND estabelecimento=? AND uf=? AND canal=? AND fonte=? FOR UPDATE`,
        [q.gtin, q.storeName, q.state, q.channel, q.source]
      );
      const old = current[0];
      if (old && asDate(old.observado_em).getTime() >= new Date(q.observedAt).getTime()) continue;
      await conn.execute<ResultSetHeader>(
        `INSERT INTO precos_online
         (gtin,produto_nome,rede,estabelecimento,uf,canal,preco,disponivel,fonte,observado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE produto_nome=VALUES(produto_nome),rede=VALUES(rede),
           preco=VALUES(preco),disponivel=VALUES(disponivel),observado_em=VALUES(observado_em),sincronizado_em=NOW()`,
        [q.gtin, q.productName, q.network, q.storeName, q.state, q.channel, q.price, true, q.source, observedAt]
      );
      if (!old || !samePrice(old.preco, q.price)) {
        await conn.execute<ResultSetHeader>(
          `INSERT INTO historico_precos_online
           (gtin,estabelecimento,uf,canal,preco,fonte,observado_em)
           VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
          [q.gtin, q.storeName, q.state, q.channel, q.price, q.source, observedAt]
        );
      }
      saved++;
    }
    await conn.commit();
    return saved;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Atualiza os preços online por UF de um GTIN (provedor Data Market). Exige GTIN válido e a
 * chave DATA_MARKET_API_KEY; devolve quantas cotações vieram e quantas linhas mudaram.
 */
export async function syncMarketGtin(gtin: string): Promise<{ matched: number; updated: number }> {
  if (!gtinValid(gtin)) throw new Error(`GTIN inválido: ${gtin}`);
  const apiKey = process.env.DATA_MARKET_API_KEY?.trim() || '';
  const quotes = await fetchMarketQuotes(gtin, apiKey, 'MA');
  return { matched: quotes.length, updated: await saveOnlineQuotes(quotes) };
}

// ---------------------------------------------------------------------------
// Esquema e lojas
// ---------------------------------------------------------------------------

const REQUIRED_TABLES = ['observacoes_preco', 'mercado_sku_gtin', 'coleta_execucoes'];

/** Falha com instrução clara se a migração 09 ainda não foi aplicada. */
export async function assertCollectionSchema(): Promise<void> {
  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)`,
    [REQUIRED_TABLES]
  );
  const [columns] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND COLUMN_NAME='codigo_externo'`
  );
  if (tables.length !== REQUIRED_TABLES.length || columns.length === 0)
    throw new Error('Migração 09 não aplicada. Execute: npm run db:migrate (ou rode sql/09-coleta-automatica.sql no Workbench).');
}

/** Localização publicada pela própria rede, usada só para achar a loja já cadastrada. */
export type StoreLocation = {
  externalId: string;
  network: 'Atacadão' | 'Mateus Mais';
  name: string;
  latitude: number;
  longitude: number;
};

const REAL_OSM_ID = '^(node|way|relation)/[0-9]+$';
/** Distância máxima entre a coordenada publicada pela rede e a loja do OpenStreetMap. */
const MATCH_RADIUS_M = 250;
const NETWORK_NAME: Record<StoreLocation['network'], RegExp> = {
  Atacadão: /atacad[aã]o/i,
  'Mateus Mais': /mateus/i,
};

type StoreCandidate = RowDataPacket & { id: number; nome: string; meters: number };

/** Escolhe a loja mais próxima com o nome da rede; recusa quando há duas praticamente à mesma distância. */
function pickCandidate(candidates: { id: number; nome: string; meters: number }[], network: StoreLocation['network']) {
  const matching = candidates.filter((c) => NETWORK_NAME[network].test(c.nome)).sort((a, b) => a.meters - b.meters);
  if (matching.length === 0) return null;
  if (matching.length > 1 && matching[1].meters - matching[0].meters < 100) return null;
  return matching[0];
}

/**
 * Devolve o id do estabelecimento REAL (com osm_id verdadeiro) da unidade, ou null.
 * Ordem: vínculo já gravado → loja OSM já cadastrada a até 500 m → consulta ao OpenStreetMap.
 * Nunca cria loja com identificador inventado; sem correspondência, a oferta geolocalizada não é gravada.
 */
export async function resolveStoreId(location: StoreLocation, log?: Logger): Promise<number | null> {
  const [linked] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM estabelecimentos WHERE codigo_externo=? LIMIT 1',
    [location.externalId]
  );
  if (linked[0]) return Number(linked[0].id);

  const findNearby = async () => {
    const [rows] = await pool.execute<StoreCandidate[]>(
      `SELECT id, nome, ST_Distance_Sphere(POINT(longitude, latitude), POINT(?, ?)) AS meters
       FROM estabelecimentos
       WHERE demonstracao=FALSE AND ativo=TRUE AND codigo_externo IS NULL AND osm_id REGEXP ?
       HAVING meters <= ? ORDER BY meters ASC LIMIT 20`,
      [location.longitude, location.latitude, REAL_OSM_ID, MATCH_RADIUS_M]
    );
    return pickCandidate(rows.map((r) => ({ id: Number(r.id), nome: String(r.nome), meters: Number(r.meters) })), location.network);
  };

  let match = await findNearby();
  if (!match) {
    try {
      const found = (await fetchRealStores(location.latitude, location.longitude, 0.5)).filter(
        (s) =>
          NETWORK_NAME[location.network].test(s.name) &&
          haversineKm({ lat: location.latitude, lon: location.longitude }, { lat: s.latitude, lon: s.longitude }) * 1000 <=
            MATCH_RADIUS_M
      );
      for (const s of found) {
        // Mesmo cadastro público que a rota /api/stores/nearby faz.
        await pool.execute(
          `INSERT INTO estabelecimentos
             (nome,bairro,cidade,uf,latitude,longitude,demonstracao,ativo,osm_id,endereco,fonte_localizacao,atualizado_em)
           VALUES(?,?,?,?,?,?,FALSE,TRUE,?,?,'OpenStreetMap',NOW())
           ON DUPLICATE KEY UPDATE nome=VALUES(nome),latitude=VALUES(latitude),longitude=VALUES(longitude),
             endereco=VALUES(endereco),fonte_localizacao='OpenStreetMap',demonstracao=FALSE,ativo=TRUE,atualizado_em=NOW()`,
          [s.name, s.neighborhood, s.city, s.state, s.latitude, s.longitude, s.osmId, s.address]
        );
      }
      if (found.length) match = await findNearby();
    } catch (err) {
      log?.warn(`[Lojas] OpenStreetMap indisponível ao localizar "${location.name}": ${(err as Error).message}`);
    }
  }
  if (!match) {
    log?.warn(
      `[Lojas] "${location.name}" não tem loja correspondente no OpenStreetMap a até ${MATCH_RADIUS_M} m; ` +
        'os preços entram no catálogo e no histórico, mas não como oferta geolocalizada.'
    );
    return null;
  }
  await pool.execute('UPDATE estabelecimentos SET codigo_externo=? WHERE id=? AND codigo_externo IS NULL', [
    location.externalId,
    match.id,
  ]);
  log?.info(`[Lojas] "${location.name}" ligada à loja OSM "${match.nome}" (${Math.round(match.meters)} m).`);
  try {
    const backfilled = await backfillGeolocatedOffers(location.externalId, match.id);
    if (backfilled) log?.info(`[Lojas] ${backfilled} ofertas já coletadas de "${location.name}" passaram a ser geolocalizadas.`);
  } catch (err) {
    log?.warn(`[Lojas] não foi possível preencher as ofertas já coletadas de "${location.name}": ${(err as Error).message}`);
  }
  return match.id;
}

/**
 * Quando uma unidade só é ligada à loja do OpenStreetMap DEPOIS de já ter preços coletados
 * (ex.: o OSM estava fora do ar na coleta), cria as ofertas geolocalizadas a partir da
 * observação mais recente de cada produto, mantendo a data em que o preço foi visto.
 * Não altera ofertas que já existem.
 */
export async function backfillGeolocatedOffers(externalId: string, storeId: number): Promise<number> {
  const latest = `SELECT o.gtin, o.preco, o.fonte_url, o.confirmado_em, o.canal_codigo, o.canal_nome
    FROM observacoes_preco o
    JOIN (SELECT gtin, MAX(coletado_em) AS ultimo FROM observacoes_preco
          WHERE loja_codigo_externo=? AND quantidade_minima=1 AND fonte IN ('ATACADAO_SITE','MATEUS_MAIS_SITE')
          GROUP BY gtin) u ON u.gtin=o.gtin AND u.ultimo=o.coletado_em
    WHERE o.loja_codigo_externo=? AND o.quantidade_minima=1 AND o.fonte IN ('ATACADAO_SITE','MATEUS_MAIS_SITE')`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO produtos(nome,marca,embalagem,gtin)
       SELECT MIN(c.produto_nome), MIN(c.marca), MIN(c.embalagem), c.gtin
       FROM (${latest}) l
       JOIN catalogo_ofertas_documentadas c ON c.gtin=l.gtin COLLATE utf8mb4_unicode_ci AND c.canal_codigo=l.canal_codigo COLLATE utf8mb4_unicode_ci
       LEFT JOIN produtos p ON p.gtin=c.gtin COLLATE utf8mb4_unicode_ci
       WHERE p.id IS NULL GROUP BY c.gtin`,
      [externalId, externalId]
    );
    const [inserted] = await conn.query<ResultSetHeader>(
      `INSERT IGNORE INTO ofertas
         (produto_id,estabelecimento_id,preco,disponivel,tipo_fonte,fonte_url,condicao_oferta,quantidade_minima,consultado_em)
       SELECT p.id, ?, l.preco, TRUE, 'ONLINE', l.fonte_url,
              CONCAT('Coleta automática (', l.canal_nome, '). Preço unitário.'), 1, l.confirmado_em
       FROM (${latest}) l JOIN produtos p ON p.gtin=l.gtin COLLATE utf8mb4_unicode_ci`,
      [storeId, externalId, externalId]
    );
    await conn.query(
      `INSERT IGNORE INTO historico_precos(oferta_id,preco,quantidade_minima,tipo_fonte,fonte_url,observado_em)
       SELECT o.id, o.preco, 1, 'ONLINE', o.fonte_url, o.consultado_em
       FROM ofertas o LEFT JOIN historico_precos h ON h.oferta_id=o.id
       WHERE o.estabelecimento_id=? AND o.tipo_fonte='ONLINE' AND h.id IS NULL`,
      [storeId]
    );
    await conn.commit();
    return inserted.affectedRows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Gravação das observações
// ---------------------------------------------------------------------------

export type PersistItem = CollectedOffer & {
  notice: string;
  /** Tipo gravado em catalogo_ofertas_documentadas.tipo_consulta. */
  referenceType: 'CONSULTA_INDEXADA' | 'CONFERENCIA_MANUAL' | 'COLETA_AUTOMATICA';
};

export type PersistSummary = {
  received: number;
  /** Primeiro preço conhecido do produto naquela unidade/faixa. */
  created: number;
  /** Preço diferente do último conhecido: novo ponto no histórico. */
  changed: number;
  /** Mesmo preço: só a data de confirmação avança. */
  confirmed: number;
  /** Coleta mais antiga (ou igual) que a já gravada: nada é alterado. */
  staleIgnored: number;
  catalogSaved: number;
  onlineSaved: number;
  realOffersSaved: number;
};

type LastObservation = { id: number; price: number; confirmedAt: number; source: string };
type LatestCatalog = { id: number; price: number; referenceDate: string; referenceType: string };
type CurrentOffer = { id: number; price: number; observedAt: number; sourceType: string };

const tierKey = (gtin: string, qty: number) => `${gtin}|${qty}`;

async function loadLastObservations(channelCode: string): Promise<Map<string, LastObservation>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.id, o.gtin, o.quantidade_minima AS qty, o.preco, o.confirmado_em, o.fonte
     FROM observacoes_preco o
     JOIN (SELECT gtin, quantidade_minima, MAX(coletado_em) AS ultimo FROM observacoes_preco
           WHERE canal_codigo=? GROUP BY gtin, quantidade_minima) u
       ON u.gtin=o.gtin AND u.quantidade_minima=o.quantidade_minima AND u.ultimo=o.coletado_em
     WHERE o.canal_codigo=?`,
    [channelCode, channelCode]
  );
  return new Map(
    rows.map((r) => [
      tierKey(String(r.gtin), Number(r.qty)),
      { id: Number(r.id), price: Number(r.preco), confirmedAt: asDate(r.confirmado_em).getTime(), source: String(r.fonte) },
    ])
  );
}

async function loadLatestCatalog(channelCode: string): Promise<Map<string, LatestCatalog>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, c.gtin, c.quantidade_minima AS qty, c.preco, c.tipo_consulta,
            DATE_FORMAT(c.referencia_em,'%Y-%m-%d') AS referenceDate
     FROM catalogo_ofertas_documentadas c
     JOIN (SELECT gtin, quantidade_minima, MAX(referencia_em) AS ultima FROM catalogo_ofertas_documentadas
           WHERE canal_codigo=? GROUP BY gtin, quantidade_minima) u
       ON u.gtin=c.gtin AND u.quantidade_minima=c.quantidade_minima AND u.ultima=c.referencia_em
     WHERE c.canal_codigo=?`,
    [channelCode, channelCode]
  );
  return new Map(
    rows.map((r) => [
      tierKey(String(r.gtin), Number(r.qty)),
      { id: Number(r.id), price: Number(r.preco), referenceDate: String(r.referenceDate), referenceType: String(r.tipo_consulta) },
    ])
  );
}

async function loadCurrentOffers(storeId: number): Promise<Map<string, CurrentOffer>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.id, p.gtin, o.preco, o.consultado_em, o.tipo_fonte
     FROM ofertas o JOIN produtos p ON p.id=o.produto_id
     WHERE o.estabelecimento_id=? AND p.gtin IS NOT NULL`,
    [storeId]
  );
  return new Map(
    rows.map((r) => [
      String(r.gtin),
      { id: Number(r.id), price: Number(r.preco), observedAt: asDate(r.consultado_em).getTime(), sourceType: String(r.tipo_fonte) },
    ])
  );
}

async function productIdFor(conn: PoolConnection, cache: Map<string, number>, item: PersistItem): Promise<number> {
  const known = cache.get(item.gtin);
  if (known) return known;
  const [found] = await conn.execute<RowDataPacket[]>('SELECT id FROM produtos WHERE gtin=? LIMIT 1', [item.gtin]);
  let id = Number(found[0]?.id ?? 0);
  if (!id) {
    const [inserted] = await conn.execute<ResultSetHeader>(
      'INSERT INTO produtos(nome,marca,embalagem,gtin) VALUES(?,?,?,?)',
      [item.productName, item.brand, item.size, item.gtin]
    );
    id = Number(inserted.insertId);
  }
  cache.set(item.gtin, id);
  return id;
}

/**
 * Grava ofertas já validadas. Cada oferta carrega a data real em que foi coletada;
 * é essa data — nunca "agora" — que decide se ela entra ou é ignorada.
 *
 * - observacoes_preco: nova linha só quando o preço muda; senão avança confirmado_em.
 * - catalogo_ofertas_documentadas: mesma regra, usando referencia_em (data de São Luís).
 *   Linhas manuais ou do catálogo inicial nunca são alteradas pela coleta.
 * - ofertas + historico_precos: só a faixa unitária e só com loja OSM verdadeira.
 * - precos_online + historico_precos_online: faixa unitária, com a fonte correta.
 */
export async function persistCollectedOffers(
  items: PersistItem[],
  options: { stores?: Map<string, number | null>; online?: boolean; log?: Logger } = {}
): Promise<PersistSummary> {
  const summary: PersistSummary = {
    received: items.length, created: 0, changed: 0, confirmed: 0, staleIgnored: 0,
    catalogSaved: 0, onlineSaved: 0, realOffersSaved: 0,
  };
  const accepted: PersistItem[] = [];
  const byChannel = new Map<string, PersistItem[]>();
  for (const item of items) {
    const list = byChannel.get(item.channelCode) ?? [];
    list.push(item);
    byChannel.set(item.channelCode, list);
  }
  const productIds = new Map<string, number>();

  for (const [channelCode, channelItems] of byChannel) {
    const observations = await loadLastObservations(channelCode);
    const catalog = await loadLatestCatalog(channelCode);
    const storeId = options.stores?.get(channelItems[0].storeExternalId) ?? null;
    const offers = storeId ? await loadCurrentOffers(storeId) : new Map<string, CurrentOffer>();
    // Ordem cronológica: se o lote trouxer duas datas do mesmo produto, a mais nova vence.
    const ordered = [...channelItems].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));

    for (let start = 0; start < ordered.length; start += 250) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const item of ordered.slice(start, start + 250)) {
          const key = tierKey(item.gtin, item.minimumQuantity);
          const collectedMs = new Date(item.collectedAt).getTime();
          const collectedSql = mysqlUTC(item.collectedAt);
          const automatic = item.referenceType === 'COLETA_AUTOMATICA';

          // 1) Histórico confiável
          const last = observations.get(key);
          if (last && collectedMs <= last.confirmedAt) {
            summary.staleIgnored++;
            continue;
          }
          // Mesmo preço vindo de OUTRA fonte (ex.: site confirmando o catálogo inicial) também vira
          // linha nova, para a fonte gravada ser sempre a de quem realmente observou.
          const sameSource = last?.source === item.source;
          if (!last || !samePrice(last.price, item.price) || !sameSource) {
            const [inserted] = await conn.execute<ResultSetHeader>(
              `INSERT INTO observacoes_preco
                 (gtin,produto_nome,rede,canal_codigo,canal_nome,loja_codigo_externo,preco,preco_lista,
                  quantidade_minima,fonte,fonte_url,coletado_em,confirmado_em)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [item.gtin, item.productName, item.network, item.channelCode, item.channelName, item.storeExternalId,
                item.price, item.listPrice, item.minimumQuantity, item.source, item.sourceUrl, collectedSql, collectedSql]
            );
            observations.set(key, { id: Number(inserted.insertId), price: item.price, confirmedAt: collectedMs, source: item.source });
            if (!last) summary.created++;
            else if (samePrice(last.price, item.price)) summary.confirmed++;
            else summary.changed++;
          } else {
            await conn.execute('UPDATE observacoes_preco SET confirmado_em=?, preco_lista=?, fonte_url=? WHERE id=?', [
              collectedSql, item.listPrice, item.sourceUrl, last.id,
            ]);
            last.confirmedAt = collectedMs;
            summary.confirmed++;
          }
          accepted.push(item);

          // 2) Catálogo comparável (rotas /api/catalog/*)
          const referenceDate = saoLuisDate(item.collectedAt);
          const latest = catalog.get(key);
          if (!latest || referenceDate > latest.referenceDate) {
            if (automatic && latest && latest.referenceType === 'COLETA_AUTOMATICA' && samePrice(latest.price, item.price)) {
              await conn.execute(
                `UPDATE catalogo_ofertas_documentadas
                 SET referencia_em=?, fonte_url=?, observacao=?, canal_nome=? WHERE id=?`,
                [referenceDate, item.sourceUrl, item.notice, item.channelName, latest.id]
              );
              latest.referenceDate = referenceDate;
            } else {
              const [inserted] = await conn.execute<ResultSetHeader>(
                `INSERT IGNORE INTO catalogo_ofertas_documentadas
                   (gtin,produto_nome,marca,embalagem,rede,canal_codigo,canal_nome,cidade,uf,preco,
                    quantidade_minima,fonte_url,referencia_em,tipo_consulta,observacao)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [item.gtin, item.productName, item.brand, item.size, item.network, item.channelCode, item.channelName,
                  item.city, item.state, item.price, item.minimumQuantity, item.sourceUrl, referenceDate,
                  item.referenceType, item.notice]
              );
              if (inserted.affectedRows > 0)
                catalog.set(key, { id: Number(inserted.insertId), price: item.price, referenceDate, referenceType: item.referenceType });
            }
            summary.catalogSaved++;
          } else if (automatic && referenceDate === latest.referenceDate && latest.referenceType === 'COLETA_AUTOMATICA') {
            // Segunda coleta no mesmo dia: a linha automática do dia recebe o preço mais recente.
            if (!samePrice(latest.price, item.price)) {
              await conn.execute(
                'UPDATE catalogo_ofertas_documentadas SET preco=?, fonte_url=?, observacao=? WHERE id=?',
                [item.price, item.sourceUrl, item.notice, latest.id]
              );
              latest.price = item.price;
            }
            summary.catalogSaved++;
          }

          // 3) Oferta geolocalizada: só faixa unitária e só com loja OSM verdadeira
          if (storeId && item.minimumQuantity === 1) {
            const current = offers.get(item.gtin);
            if (current?.sourceType === 'DEMO' || (current && collectedMs <= current.observedAt)) continue;
            let offerId: number;
            if (current) {
              offerId = current.id;
              await conn.execute(
                `UPDATE ofertas SET preco=?, disponivel=TRUE, tipo_fonte='ONLINE', fonte_url=?, condicao_oferta=?,
                   quantidade_minima=1, consultado_em=? WHERE id=?`,
                [item.price, item.sourceUrl, item.notice, collectedSql, offerId]
              );
            } else {
              const productId = await productIdFor(conn, productIds, item);
              const [inserted] = await conn.execute<ResultSetHeader>(
                `INSERT INTO ofertas
                   (produto_id,estabelecimento_id,preco,disponivel,tipo_fonte,fonte_url,condicao_oferta,quantidade_minima,consultado_em)
                 VALUES(?,?,?,TRUE,'ONLINE',?,?,1,?)`,
                [productId, storeId, item.price, item.sourceUrl, item.notice, collectedSql]
              );
              offerId = Number(inserted.insertId);
            }
            if (!current || !samePrice(current.price, item.price)) {
              await conn.execute(
                `INSERT INTO historico_precos(oferta_id,preco,quantidade_minima,tipo_fonte,fonte_url,observado_em)
                 VALUES(?,?,1,'ONLINE',?,?) ON DUPLICATE KEY UPDATE id=id`,
                [offerId, item.price, item.sourceUrl, collectedSql]
              );
            }
            offers.set(item.gtin, { id: offerId, price: item.price, observedAt: collectedMs, sourceType: 'ONLINE' });
            summary.realOffersSaved++;
          }
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  // Fotos oficiais: uma por GTIN e fonte, sempre ligadas ao código de barras informado
  // pela própria rede (tabela produto_imagens). Falha aqui não invalida os preços gravados.
  try {
    const images = new Map<string, PersistItem>();
    for (const item of accepted) if (item.imageUrl) images.set(`${item.gtin}|${item.source}`, item);
    const rows = [...images.values()];
    for (let start = 0; start < rows.length; start += 500) {
      await pool.query(
        `INSERT INTO produto_imagens(gtin,url,fonte,pagina_origem,coletada_em) VALUES ?
         ON DUPLICATE KEY UPDATE url=VALUES(url), pagina_origem=VALUES(pagina_origem), coletada_em=VALUES(coletada_em)`,
        [rows.slice(start, start + 500).map((i) => [i.gtin, i.imageUrl, i.source, i.sourceUrl, mysqlUTC(i.collectedAt)])]
      );
    }
  } catch (err) {
    options.log?.warn(`[Imagens] fotos não gravadas nesta execução: ${(err as Error).message}`);
  }

  // 4) Preços online por UF, com a fonte verdadeira (nunca "Data Market" para dado do site)
  if (options.online !== false) {
    const quotes: OnlineQuote[] = accepted
      .filter((item) => item.minimumQuantity === 1)
      .map((item) => ({
        gtin: item.gtin,
        productName: item.productName,
        network: item.network === 'Mateus Mais' ? 'Mateus' : 'Atacadão',
        storeName: item.channelName,
        state: item.state,
        channel: 'e-commerce',
        price: item.price,
        available: true,
        observedAt: item.collectedAt,
        source: SOURCE_LABEL[item.source],
      }));
    for (let start = 0; start < quotes.length; start += 250)
      summary.onlineSaved += await saveOnlineQuotes(quotes.slice(start, start + 250));
  }
  return summary;
}

function entryToItem(entry: CatalogEntry, source: PriceSource, notice: string): PersistItem | null {
  if (entry.network !== 'Atacadão' && entry.network !== 'Mateus Mais') return null;
  const checked = validateOffer({
    gtin: entry.gtin,
    productName: entry.productName,
    brand: entry.brand,
    size: entry.size,
    network: entry.network,
    channelCode: entry.channelCode,
    channelName: entry.channelName,
    storeExternalId: `CANAL:${entry.channelCode}`,
    city: entry.city,
    state: entry.state,
    price: entry.price,
    listPrice: null,
    minimumQuantity: entry.minimumQuantity,
    sourceUrl: entry.sourceUrl,
    source,
    // Meio-dia UTC = 9h em São Luís: mantém a data de referência original do registro.
    collectedAt: `${entry.referenceDate}T12:00:00.000Z`,
    externalSku: '',
  });
  if (!checked.ok) return null;
  return {
    ...checked.offer,
    notice: notice.slice(0, 255),
    referenceType: entry.referenceType === 'CONFERENCIA_MANUAL' ? 'CONFERENCIA_MANUAL' : 'CONSULTA_INDEXADA',
  };
}

/**
 * Grava referências documentadas (CatalogEntry) usando a `referenceDate` de cada uma
 * como data da observação. Entradas mais antigas que o que já existe são ignoradas;
 * nada é regravado como se fosse de hoje. Mantida para compatibilidade com o projeto.
 */
export async function persistEntriesToMySQL(
  entries: CatalogEntry[],
  log?: Logger
): Promise<{ catalogSaved: number; onlineSaved: number; realOffersSaved: number }> {
  await assertCollectionSchema();
  const items: PersistItem[] = [];
  let invalid = 0;
  for (const entry of entries) {
    const item = entryToItem(entry, 'CATALOGO_DOCUMENTADO', entry.notice);
    if (item) items.push(item);
    else invalid++;
  }
  const summary = await persistCollectedOffers(items, { log });
  if (invalid || summary.staleIgnored)
    log?.warn(`[Catálogo] ${invalid} entradas inválidas e ${summary.staleIgnored} mais antigas que o banco foram ignoradas.`);
  return { catalogSaved: summary.catalogSaved, onlineSaved: summary.onlineSaved, realOffersSaved: summary.realOffersSaved };
}

/**
 * Carrega o catálogo inicial uma única vez, com a data ORIGINAL (SEED_REFERENCE_DATE).
 * É fallback histórico: não gera oferta geolocalizada, não entra em precos_online
 * e é ignorado para todo produto que já tenha observação mais nova.
 */
export async function ensureSeedFallback(log?: Logger): Promise<number> {
  await assertCollectionSchema();
  const items: PersistItem[] = [];
  for (const seed of SAO_LUIS_CATALOG_SEED) {
    const item = entryToItem(
      { ...seed, referenceDate: SEED_REFERENCE_DATE },
      'CATALOGO_INICIAL',
      `[Catálogo inicial de ${SEED_REFERENCE_DATE}, não reconferido] ${seed.notice}`
    );
    if (item) items.push(item);
  }
  const summary = await persistCollectedOffers(items, { online: false, log });
  if (summary.created)
    log?.info(`[Catálogo inicial] ${summary.created} referências históricas de ${SEED_REFERENCE_DATE} carregadas como fallback.`);
  return summary.created;
}

// ---------------------------------------------------------------------------
// Execuções da coleta
// ---------------------------------------------------------------------------

export type RunStatus = 'SUCESSO' | 'PARCIAL' | 'FALHA' | 'IGNORADA';
export type RunSummary = {
  source: 'ATACADAO_SITE' | 'MATEUS_MAIS_SITE';
  status: RunStatus;
  found: number;
  valid: number;
  created: number;
  changed: number;
  confirmed: number;
  ignored: number;
  errors: number;
  message: string;
};

export type CollectionOptions = {
  log?: Logger;
  /** Ignora o intervalo mínimo entre execuções bem-sucedidas. */
  force?: boolean;
  /** Não repete a coleta se a última bem-sucedida terminou há menos que isso. */
  minIntervalHours?: number;
  /** Limita as páginas (Atacadão) ou consultas (Mateus Mais) — testes e execuções parciais. */
  maxPages?: number;
  sources?: RunSummary['source'][];
  /** Mateus Mais: limita as unidades (slug ou código do canal). */
  mateusMarkets?: string[];
  /** Cliente HTTP alternativo (os testes usam para simular queda de rede). */
  client?: PoliteClient;
};

async function recentSuccess(source: string, hours: number): Promise<Date | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT finalizado_em FROM coleta_execucoes
     WHERE fonte=? AND status='SUCESSO' AND finalizado_em >= UTC_TIMESTAMP() - INTERVAL ? MINUTE
     ORDER BY finalizado_em DESC LIMIT 1`,
    [source, Math.round(hours * 60)]
  );
  return rows[0] ? asDate(rows[0].finalizado_em) : null;
}

async function openRun(source: string): Promise<number> {
  await pool.execute(
    `UPDATE coleta_execucoes SET status='FALHA', finalizado_em=UTC_TIMESTAMP(),
       mensagem='Execução interrompida antes de terminar (servidor reiniciado).'
     WHERE fonte=? AND status='EM_ANDAMENTO'`,
    [source]
  );
  const [inserted] = await pool.execute<ResultSetHeader>(
    'INSERT INTO coleta_execucoes(fonte,iniciado_em) VALUES(?,UTC_TIMESTAMP())',
    [source]
  );
  return Number(inserted.insertId);
}

async function closeRun(id: number, run: RunSummary): Promise<void> {
  await pool.execute(
    `UPDATE coleta_execucoes SET finalizado_em=UTC_TIMESTAMP(), status=?, encontrados=?, validos=?, novos=?,
       alterados=?, confirmados=?, ignorados=?, erros=?, mensagem=? WHERE id=?`,
    [run.status === 'IGNORADA' ? 'SUCESSO' : run.status, run.found, run.valid, run.created, run.changed,
      run.confirmed, run.ignored, run.errors, run.message.slice(0, 1000), id]
  );
}

const describeRejected = (rejected: Record<string, number>) =>
  Object.entries(rejected)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count}× ${reason}`)
    .join('; ');

async function loadEanCache(network: string): Promise<Map<string, EanInfo>> {
  // EAN ausente é reconsultado depois de 30 dias (o cadastro do site pode ter sido corrigido).
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sku, gtin, produto_nome FROM mercado_sku_gtin
     WHERE rede=? AND (gtin IS NOT NULL OR verificado_em >= UTC_TIMESTAMP() - INTERVAL 30 DAY)`,
    [network]
  );
  return new Map(rows.map((r) => [String(r.sku), { ean: r.gtin ? String(r.gtin) : null, name: String(r.produto_nome) }]));
}

async function saveEans(network: string, eans: Map<string, EanInfo>): Promise<void> {
  const entries = [...eans];
  for (let start = 0; start < entries.length; start += 200) {
    const batch = entries.slice(start, start + 200);
    await pool.query(
      `INSERT INTO mercado_sku_gtin(rede,sku,gtin,produto_nome,verificado_em) VALUES ?
       ON DUPLICATE KEY UPDATE gtin=VALUES(gtin), produto_nome=VALUES(produto_nome), verificado_em=VALUES(verificado_em)`,
      [batch.map(([sku, info]) => [network, sku, info.ean, info.name.slice(0, 180), mysqlUTC(new Date().toISOString())])]
    );
  }
}

async function runAtacadao(options: CollectionOptions): Promise<RunSummary> {
  const { log } = options;
  const run: RunSummary = {
    source: 'ATACADAO_SITE', status: 'FALHA', found: 0, valid: 0, created: 0, changed: 0,
    confirmed: 0, ignored: 0, errors: 0, message: '',
  };
  const runId = await openRun(run.source);
  const startedAt = new Date();
  try {
    const client = options.client ?? new PoliteClient();
    const eanCache = await loadEanCache('Atacadão');
    const result = await collectAtacadao({
      client,
      slug: process.env.ATACADAO_STORE_SLUG?.trim() || 'sao-luis',
      maxPages: options.maxPages,
      eanCache,
      log,
    });
    await saveEans('Atacadão', result.newEans);
    const storeId = await resolveStoreId(
      {
        externalId: result.store.externalId,
        network: 'Atacadão',
        name: result.store.channelName,
        latitude: result.store.latitude,
        longitude: result.store.longitude,
      },
      log
    ).catch((err) => {
      log?.warn(`[Lojas] "${result.store.channelName}" sem loja no mapa nesta execução: ${(err as Error).message}`);
      return null;
    });
    const items: PersistItem[] = result.offers.map((offer) => ({
      ...offer,
      notice: atacadaoNotice(offer),
      referenceType: 'COLETA_AUTOMATICA',
    }));
    const saved = await persistCollectedOffers(items, {
      stores: new Map([[result.store.externalId, storeId]]),
      log,
    });
    const rejectedCount = Object.values(result.stats.rejected).reduce((sum, n) => sum + n, 0);
    const limited = options.maxPages !== undefined && !result.stats.complete;
    run.found = result.stats.found;
    run.valid = result.offers.length;
    run.created = saved.created;
    run.changed = saved.changed;
    run.confirmed = saved.confirmed;
    run.ignored = rejectedCount + result.stats.withoutOffer + result.stats.tiersDropped + saved.staleIgnored;
    run.errors = result.stats.errors.length + result.stats.eanFailures;
    run.status = result.stats.complete ? 'SUCESSO' : 'PARCIAL';
    if (limited) run.message = `leitura limitada a ${options.maxPages} páginas; `;
    if (result.stats.errors.length) run.message += `${result.stats.errors.join('; ')}; `;
    if (result.stats.eanFailures) run.message += `${result.stats.eanFailures} produtos sem EAN por erro do catálogo do site; `;
    run.message +=
      `${result.store.channelName} (${result.store.city}/${result.store.state}, vendedor ${result.store.seller}); ` +
      `${result.stats.pages} páginas; ${result.stats.found}/${result.stats.expected} produtos; ` +
      `ofertas geolocalizadas: ${saved.realOffersSaved}; ignorados: ${describeRejected(result.stats.rejected) || 'nenhum'}` +
      (result.stats.withoutOffer ? `; ${result.stats.withoutOffer}× sem preço da loja` : '') +
      (saved.staleIgnored ? `; ${saved.staleIgnored}× mais antigos que o banco` : '');

    // Só numa leitura COMPLETA é seguro dizer que um produto saiu da vitrine.
    if (result.stats.complete && storeId) {
      const [gone] = await pool.execute<ResultSetHeader>(
        `UPDATE ofertas SET disponivel=FALSE
         WHERE estabelecimento_id=? AND tipo_fonte='ONLINE' AND disponivel=TRUE
           AND fonte_url LIKE 'https://www.atacadao.com.br/%' AND consultado_em < ?`,
        [storeId, mysqlUTC(startedAt.toISOString())]
      );
      if (gone.affectedRows) run.message += `; ${gone.affectedRows} ofertas fora da vitrine marcadas como indisponíveis`;
    }
  } catch (err) {
    // Nada foi gravado para o que não chegou: o último preço válido segue no banco com a data original.
    run.status = 'FALHA';
    run.errors = 1;
    run.message = `Coleta interrompida: ${(err as Error).message}`;
  }
  await closeRun(runId, run);
  return run;
}

async function runMateus(options: CollectionOptions): Promise<RunSummary> {
  const { log } = options;
  const run: RunSummary = {
    source: 'MATEUS_MAIS_SITE', status: 'FALHA', found: 0, valid: 0, created: 0, changed: 0,
    confirmed: 0, ignored: 0, errors: 0, message: '',
  };
  const runId = await openRun(run.source);
  const startedAt = new Date();
  try {
    const result = await collectMateusMais({
      client: options.client ?? new PoliteClient(),
      authorized: process.env.MATEUS_SYNC_ENABLED === 'true',
      onlyMarkets: options.mateusMarkets ?? (process.env.MATEUS_MARKETS || '').split(',').map((m) => m.trim()).filter(Boolean),
      maxRequests: options.maxPages ?? (Number(process.env.MATEUS_MAX_REQUESTS) || undefined),
      log,
    });
    const stores = new Map<string, number | null>();
    for (const market of result.markets) {
      stores.set(
        market.externalId,
        market.latitude !== null && market.longitude !== null
          ? await resolveStoreId(
              { externalId: market.externalId, network: 'Mateus Mais', name: market.name, latitude: market.latitude, longitude: market.longitude },
              log
            ).catch((err) => {
              log?.warn(`[Lojas] "${market.name}" sem loja no mapa nesta execução: ${(err as Error).message}`);
              return null;
            })
          : null
      );
    }
    const items: PersistItem[] = result.offers.map((offer) => ({
      ...offer,
      notice: mateusNotice(offer),
      referenceType: 'COLETA_AUTOMATICA',
    }));
    const saved = await persistCollectedOffers(items, { stores, log });
    const rejectedCount = Object.values(result.stats.rejected).reduce((sum, n) => sum + n, 0);
    run.found = result.stats.found;
    run.valid = result.offers.length;
    run.created = saved.created;
    run.changed = saved.changed;
    run.confirmed = saved.confirmed;
    run.ignored = rejectedCount + saved.staleIgnored;
    run.errors = result.stats.errors.length;
    run.status = result.stats.complete ? 'SUCESSO' : 'PARCIAL';
    run.message =
      (result.stats.errors.length ? `${result.stats.errors.join('; ')}; ` : '') +
      `${result.markets.length} unidades de São Luís/MA (` +
      result.stats.perMarket.map((m) => `${m.name}: ${m.valid}`).join(', ') +
      `); ${result.stats.requests} consultas; ofertas geolocalizadas: ${saved.realOffersSaved}; ` +
      `ignorados: ${describeRejected(result.stats.rejected) || 'nenhum'}` +
      (result.stats.truncatedListings ? `; ${result.stats.truncatedListings} consultas cortadas pelo site` : '') +
      (saved.staleIgnored ? `; ${saved.staleIgnored}× mais antigos que o banco` : '');

    // Só para unidade lida por inteiro é seguro dizer que um produto saiu da vitrine.
    let gone = 0;
    for (const market of result.markets) {
      const storeId = stores.get(market.externalId);
      if (!market.complete || !storeId) continue;
      const [updated] = await pool.execute<ResultSetHeader>(
        `UPDATE ofertas SET disponivel=FALSE
         WHERE estabelecimento_id=? AND tipo_fonte='ONLINE' AND disponivel=TRUE
           AND fonte_url LIKE 'https://mateusmais.com.br/%' AND consultado_em < ?`,
        [storeId, mysqlUTC(startedAt.toISOString())]
      );
      gone += updated.affectedRows;
    }
    if (gone) run.message += `; ${gone} ofertas fora da vitrine marcadas como indisponíveis`;
  } catch (err) {
    run.status = 'FALHA';
    run.errors = 1;
    run.message = `Coleta interrompida: ${(err as Error).message}`;
  }
  await closeRun(runId, run);
  return run;
}

let collecting = false;

/**
 * Executa a coleta das fontes habilitadas e devolve um resumo por fonte.
 * Nunca lança por falha de rede: a falha vira status FALHA no resumo e em coleta_execucoes.
 */
export async function runMarketCollection(options: CollectionOptions = {}): Promise<RunSummary[]> {
  const { log } = options;
  await assertCollectionSchema();
  if (collecting) {
    log?.warn('[Coleta] já existe uma coleta em andamento neste servidor; esta chamada foi ignorada.');
    return [];
  }
  collecting = true;
  // Trava no MySQL: vale também entre processos (API + worker, ou dois workers por engano).
  const lock = await pool.getConnection();
  try {
    const [held] = await lock.query<RowDataPacket[]>("SELECT GET_LOCK(CONCAT(DATABASE(), '_coleta'), 0) AS ok");
    if (Number(held[0]?.ok) !== 1) {
      log?.warn('[Coleta] outro processo já está coletando; esta chamada foi ignorada.');
      return [];
    }
    const enabled: RunSummary['source'][] = [];
    if (process.env.LIVE_SCRAPE_ENABLED !== 'false') {
      if (process.env.ATACADAO_SYNC_ENABLED !== 'false') enabled.push('ATACADAO_SITE');
      if (process.env.MATEUS_SYNC_ENABLED === 'true') enabled.push('MATEUS_MAIS_SITE');
    }
    const wanted = options.sources ? enabled.filter((s) => options.sources!.includes(s)) : enabled;
    if (options.sources?.includes('MATEUS_MAIS_SITE') && !wanted.includes('MATEUS_MAIS_SITE'))
      log?.warn('[Mateus Mais] coleta desligada: os Termos de Uso do site proíbem scripts de obtenção de dados (MATEUS_SYNC_ENABLED≠true).');
    const runs: RunSummary[] = [];
    for (const source of wanted) {
      if (!options.force && options.minIntervalHours) {
        const last = await recentSuccess(source, options.minIntervalHours);
        if (last) {
          log?.info(`[Coleta] ${source}: última coleta completa em ${last.toISOString()}; ainda dentro do intervalo, nada a fazer.`);
          runs.push({ source, status: 'IGNORADA', found: 0, valid: 0, created: 0, changed: 0, confirmed: 0, ignored: 0, errors: 0, message: 'Dentro do intervalo mínimo.' });
          continue;
        }
      }
      const run = source === 'ATACADAO_SITE' ? await runAtacadao(options) : await runMateus(options);
      const line =
        `[Coleta] ${source} → ${run.status} | encontrados ${run.found} | válidos ${run.valid} | novos ${run.created} | ` +
        `alterados ${run.changed} | confirmados ${run.confirmed} | ignorados ${run.ignored} | erros ${run.errors} | ${run.message}`;
      if (run.status === 'SUCESSO') log?.info(line);
      else log?.warn(line);
      runs.push(run);
    }
    return runs;
  } finally {
    await lock.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), '_coleta'))").catch(() => undefined);
    lock.release();
    collecting = false;
  }
}

/**
 * Consulta as fontes ao vivo agora (sem respeitar o intervalo mínimo) e devolve
 * quantas ofertas foram efetivamente vistas e gravadas/confirmadas.
 */
export async function refreshLivePricesFromWeb(log?: Logger): Promise<number> {
  const runs = await runMarketCollection({ log, force: true });
  return runs.reduce((sum, run) => sum + run.created + run.changed + run.confirmed, 0);
}

// ---------------------------------------------------------------------------
// Agendador
// ---------------------------------------------------------------------------

let lastDataMarketRun = 0;

async function runDataMarket(log: Logger): Promise<void> {
  if (process.env.MARKET_SYNC_ENABLED !== 'true') return;
  const eans = (process.env.MARKET_SYNC_EANS || '').split(',').map((x) => x.trim()).filter(gtinValid);
  if (!process.env.DATA_MARKET_API_KEY || !eans.length) {
    log.warn('Sincronização Data Market desativada: configure DATA_MARKET_API_KEY e MARKET_SYNC_EANS.');
    return;
  }
  const hours = Math.max(24, Number(process.env.MARKET_SYNC_INTERVAL_HOURS) || 24);
  if (Date.now() - lastDataMarketRun < hours * 3_600_000) return;
  lastDataMarketRun = Date.now();
  for (const gtin of eans.slice(0, 10)) {
    try {
      const result = await syncMarketGtin(gtin);
      log.info(`Data Market GTIN ${gtin}: ${result.matched} ofertas MA elegíveis, ${result.updated} atualizadas.`);
    } catch (e) {
      log.warn(`Data Market ${gtin}: ${(e as Error).message}`);
    }
  }
}

/**
 * Chamado uma vez pelo server.ts depois que a API sobe.
 *  - Carrega o catálogo inicial como fallback histórico (só na primeira vez).
 *  - Faz a coleta inicial e repete a cada PRICE_COLLECT_INTERVAL_HOURS (padrão 12 h).
 *  - Reiniciar o servidor (npm run dev) não dispara nova varredura se a última
 *    coleta completa ainda está dentro do intervalo.
 */
export function startMarketScheduler(log: Logger, options: { keepAlive?: boolean } = {}): void {
  const hours = Math.max(1, Number(process.env.PRICE_COLLECT_INTERVAL_HOURS) || 12);
  const cycle = async () => {
    try {
      await ensureSeedFallback(log);
      await runMarketCollection({ log, minIntervalHours: Math.max(0.5, hours - 0.5) });
    } catch (err) {
      log.warn(`[Coleta] não executada: ${(err as Error).message}`);
    }
    try {
      await runDataMarket(log);
    } catch (err) {
      log.warn(`[Data Market] ${(err as Error).message}`);
    }
  };
  void cycle();
  const timer = setInterval(() => void cycle(), hours * 3_600_000);
  // Na API o agendador não segura o processo; no worker ele é o próprio processo.
  if (!options.keepAlive) timer.unref();
  log.info(`[Coleta] agendada a cada ${hours} h. Atacadão: ${process.env.ATACADAO_SYNC_ENABLED !== 'false' && process.env.LIVE_SCRAPE_ENABLED !== 'false' ? 'ligado' : 'desligado'}; Mateus Mais: ${process.env.MATEUS_SYNC_ENABLED === 'true' ? 'ligado' : 'desligado (Termos de Uso)'}.`);
}
