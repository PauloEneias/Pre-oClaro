/**
 * MODEL/REPOSITORY — catálogo comparável (tabela catalogo_ofertas_documentadas):
 * preço unitário e faixas por quantidade, por rede e unidade, com data e link de origem.
 */
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import type { CatalogRow } from '../catalogComparison.js';

const FIELDS = `id,gtin,produto_nome AS productName,marca AS brand,embalagem AS size,
  rede AS network,canal_codigo AS channelCode,canal_nome AS channelName,
  cidade AS city,uf AS state,preco AS price,quantidade_minima AS minimumQuantity,
  fonte_url AS sourceUrl,DATE_FORMAT(referencia_em,'%Y-%m-%d') AS referenceDate,
  tipo_consulta AS referenceType,observacao AS notice`;
const TABLE = 'catalogo_ofertas_documentadas';

export type CatalogSort = 'recent' | 'name';
export type CatalogFilter = { q: string; network: string; sort: CatalogSort };

const toRow = (r: RowDataPacket): CatalogRow => ({
  ...(r as unknown as CatalogRow), id: Number(r.id), price: Number(r.price), minimumQuantity: Number(r.minimumQuantity),
});

/** Cada palavra da pesquisa precisa aparecer no nome, na marca, na embalagem ou no GTIN. */
function conditions(f: { q: string; network: string }) {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const terms = words.map(() => "INSTR(LOWER(CONCAT_WS(' ', produto_nome, marca, embalagem, gtin)), LOWER(?))>0");
  return {
    where: `uf='MA'${f.network ? ' AND rede=?' : ''}${terms.length ? ' AND ' + terms.join(' AND ') : ''}`,
    args: [...(f.network ? [f.network] : []), ...words] as (string | number)[],
    hasTerms: terms.length > 0,
  };
}
const ORDER: Record<CatalogSort, string> = {
  recent: 'lastReference DESC, gtin ASC',
  name: 'productName ASC, gtin ASC',
};

/** Todas as linhas (todas as unidades e faixas) de um conjunto de GTINs — uma consulta só. */
export async function rowsForGtins(gtins: string[]): Promise<CatalogRow[]> {
  if (gtins.length === 0) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${FIELDS} FROM ${TABLE} WHERE uf='MA' AND gtin IN (${gtins.map(() => '?').join(',')})`,
    gtins
  );
  return rows.map(toRow);
}

/** Total de produtos distintos (GTIN) e os GTINs da página pedida. */
export async function pageOfGtins(f: CatalogFilter, limit: number, offset: number): Promise<{ total: number; gtins: string[] }> {
  const c = conditions(f);
  const [count] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(DISTINCT gtin) AS total FROM ${TABLE} WHERE ${c.where}`, c.args);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT gtin, MAX(referencia_em) AS lastReference, MIN(produto_nome) AS productName
     FROM ${TABLE} WHERE ${c.where} GROUP BY gtin ORDER BY ${ORDER[f.sort]} LIMIT ? OFFSET ?`,
    [...c.args, limit, offset]
  );
  return { total: Number(count[0]?.total ?? 0), gtins: rows.map((r) => String(r.gtin)) };
}

/**
 * GTINs presentes em TODAS as redes informadas. A pesquisa vale se qualquer rede descrever
 * o produto com os termos (os nomes variam entre redes); por isso o teste vai no HAVING,
 * numa única leitura da tabela.
 */
export async function pageOfSharedGtins(
  f: { q: string; sort: CatalogSort }, networks: readonly string[], limit: number, offset: number
): Promise<{ total: number; gtins: string[] }> {
  const c = conditions({ q: f.q, network: '' });
  const marks = networks.map(() => '?').join(',');
  const body = `FROM ${TABLE} WHERE uf='MA' AND rede IN (${marks})
    GROUP BY gtin HAVING COUNT(DISTINCT rede)=${networks.length}${c.hasTerms ? ` AND MAX(${c.where})=1` : ''}`;
  const args = [...networks, ...c.args];
  const [count] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (SELECT gtin ${body}) t`, args);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT gtin, MAX(referencia_em) AS lastReference, MIN(produto_nome) AS productName ${body}
     ORDER BY ${ORDER[f.sort]} LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  return { total: Number(count[0]?.total ?? 0), gtins: rows.map((r) => String(r.gtin)) };
}

/**
 * Melhor referência de cada produto em cada unidade para a quantidade pedida
 * (lista "Catálogos online" da página de comparação), paginada no servidor.
 */
export async function documentedPrices(
  q: string, quantity: number, limit: number, offset: number
): Promise<{ total: number; rows: CatalogRow[] }> {
  const c = conditions({ q, network: '' });
  const ranked = `SELECT ${FIELDS},
      ROW_NUMBER() OVER (PARTITION BY gtin,canal_codigo ORDER BY referencia_em DESC,quantidade_minima DESC,id DESC) AS rn
    FROM ${TABLE} WHERE ${c.where} AND quantidade_minima<=?`;
  const args = [...c.args, quantity];
  const [count] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (${ranked}) t WHERE rn=1`, args);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM (${ranked}) t WHERE rn=1 ORDER BY price ASC, channelName ASC, id ASC LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  return { total: Number(count[0]?.total ?? 0), rows: rows.map(toRow) };
}

export async function similarCandidates(firstWord: string): Promise<{ gtin: string; name: string; brand: string; size: string }[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT gtin,produto_nome AS name,marca AS brand,embalagem AS size,MAX(referencia_em) AS lastReference
     FROM ${TABLE} WHERE uf='MA' AND INSTR(LOWER(produto_nome),LOWER(?))>0
     GROUP BY gtin,produto_nome,marca,embalagem ORDER BY lastReference DESC LIMIT 500`,
    [firstWord]
  );
  return rows.map((r) => ({ gtin: String(r.gtin), name: String(r.name), brand: String(r.brand), size: String(r.size) }));
}

export type Channel = { network: string; channelCode: string; channelName: string };

/** Redes e unidades que existem no catálogo (seleção de loja no Conferir Caixa). */
export async function listChannels(): Promise<Channel[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rede AS network, canal_codigo AS channelCode, MAX(canal_nome) AS channelName
     FROM ${TABLE} WHERE uf='MA' GROUP BY rede, canal_codigo ORDER BY rede, channelName`
  );
  return rows.map((r) => ({ network: String(r.network), channelCode: String(r.channelCode), channelName: String(r.channelName) }));
}

/** Foto oficial por GTIN (uma por produto), para os cartões do catálogo. */
export async function imagesForGtins(gtins: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!gtins.length) return map;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT gtin, url FROM produto_imagens WHERE gtin IN (${gtins.map(() => '?').join(',')})
     ORDER BY FIELD(fonte,'ATACADAO_SITE','MATEUS_MAIS_SITE') DESC, id DESC`,
    gtins
  );
  // A ordem decrescente faz a fonte preferida ser a última a gravar no mapa.
  for (const r of rows) map.set(String(r.gtin), String(r.url));
  return map;
}
