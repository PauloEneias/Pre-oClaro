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

/** Trecho de texto do usuário como padrão de LIKE, com % e _ tratados como caracteres comuns. */
export const likeTerm = (word: string) => `%${word.replace(/[\\%_]/g, '\\$&')}%`;
/** Comparação que ignora maiúsculas E acentos ("feijao" encontra "Feijão"). */
export const ACCENT_INSENSITIVE = 'COLLATE utf8mb4_0900_ai_ci';

/** Cada palavra da pesquisa precisa aparecer no nome, na marca, na embalagem ou no GTIN. */
function conditions(f: { q: string; network: string }) {
  const words = f.q.split(/\s+/).filter(Boolean).slice(0, 8);
  const terms = words.map(() => `CONCAT_WS(' ', produto_nome, marca, embalagem, gtin) ${ACCENT_INSENSITIVE} LIKE ?`);
  return {
    where: `uf='MA'${f.network ? ' AND rede=?' : ''}${terms.length ? ' AND ' + terms.join(' AND ') : ''}`,
    args: [...(f.network ? [f.network] : []), ...words.map(likeTerm)] as (string | number)[],
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

/** Produto candidato à pesquisa, com tudo o que a nota de relevância e as ordenações precisam. */
export type SearchCandidate = {
  gtin: string; names: string[]; brand: string; size: string;
  lastReference: string; networks: number; bestPrice: number | null;
};
/** Teto de candidatos por pesquisa: acima disso a pesquisa é ampla demais e a resposta avisa. */
export const CANDIDATE_LIMIT = 6000;

/**
 * Pré-filtro da pesquisa por relevância: TODOS os produtos (GTIN) cujos textos contêm cada grupo
 * de termos — sem paginação, porque a ordem por relevância é decidida depois, no serviço.
 * `groups`: cada grupo é obrigatório; dentro do grupo basta uma das formas (plural, sinônimo).
 * `starts`: alternativa para o filtro de categoria sem pesquisa (nome começa por uma das palavras).
 */
export async function searchCandidates(f: {
  groups: string[][]; starts?: string[]; network: string; networks?: readonly string[]; quantity: number;
}): Promise<{ rows: SearchCandidate[]; truncated: boolean }> {
  const text = `CONCAT_WS(' ', produto_nome, marca, embalagem, gtin) ${ACCENT_INSENSITIVE}`;
  const terms = f.groups.map((g) => `(${g.map(() => `${text} LIKE ?`).join(' OR ')})`);
  const termArgs = f.groups.flatMap((g) => g.map(likeTerm));
  if (f.starts?.length) {
    terms.push(`(${f.starts.map(() => `produto_nome ${ACCENT_INSENSITIVE} LIKE ?`).join(' OR ')})`);
    termArgs.push(...f.starts.map((w) => `${w.replace(/[\\%_]/g, '\\$&')}%`));
  }
  const match = terms.length ? terms.join(' AND ') : 'TRUE';
  const select = `SELECT gtin, GROUP_CONCAT(DISTINCT produto_nome ORDER BY produto_nome SEPARATOR '\\n') AS names,
      MIN(marca) AS brand, MIN(embalagem) AS size, DATE_FORMAT(MAX(referencia_em),'%Y-%m-%d') AS lastReference,
      COUNT(DISTINCT rede) AS networks, MIN(CASE WHEN quantidade_minima<=? THEN preco END) AS bestPrice
    FROM ${TABLE}`;
  let sql: string;
  let args: (string | number)[];
  if (f.networks?.length) {
    // Comparação entre redes: o GTIN precisa existir em todas; basta uma rede descrever com os termos.
    sql = `${select} WHERE uf='MA' AND rede IN (${f.networks.map(() => '?').join(',')})
      GROUP BY gtin HAVING COUNT(DISTINCT rede)=${f.networks.length} AND MAX(${match})=1`;
    args = [f.quantity, ...f.networks, ...termArgs];
  } else if (f.network) {
    // Uma rede só: o produto precisa ter oferta nela, mas a relevância usa os nomes de TODAS as
    // redes para o mesmo GTIN (a identidade é o código de barras; cada rede escreve o nome do
    // seu jeito). Preço e data vêm só da rede escolhida.
    sql = `SELECT gtin, GROUP_CONCAT(DISTINCT produto_nome ORDER BY produto_nome SEPARATOR '\\n') AS names,
        MIN(marca) AS brand, MIN(embalagem) AS size,
        DATE_FORMAT(MAX(CASE WHEN rede=? THEN referencia_em END),'%Y-%m-%d') AS lastReference,
        COUNT(DISTINCT rede) AS networks, MIN(CASE WHEN rede=? AND quantidade_minima<=? THEN preco END) AS bestPrice
      FROM ${TABLE} WHERE uf='MA' GROUP BY gtin HAVING SUM(rede=?)>0 AND MAX(${match})=1`;
    args = [f.network, f.network, f.quantity, f.network, ...termArgs];
  } else {
    sql = `${select} WHERE uf='MA' AND ${match} GROUP BY gtin`;
    args = [f.quantity, ...termArgs];
  }
  const [rows] = await pool.execute<RowDataPacket[]>(`${sql} LIMIT ${CANDIDATE_LIMIT + 1}`, args);
  return {
    truncated: rows.length > CANDIDATE_LIMIT,
    rows: rows.slice(0, CANDIDATE_LIMIT).map((r) => ({
      gtin: String(r.gtin), names: String(r.names ?? '').split('\n').filter(Boolean), brand: String(r.brand ?? ''),
      size: String(r.size ?? ''), lastReference: String(r.lastReference), networks: Number(r.networks),
      bestPrice: r.bestPrice === null ? null : Number(r.bestPrice),
    })),
  };
}

/** Melhor referência de cada GTIN em cada unidade, restrita a GTINs já escolhidos pela relevância. */
export async function documentedPricesFor(
  gtins: string[], quantity: number, limit: number, offset: number
): Promise<{ total: number; rows: CatalogRow[] }> {
  if (!gtins.length) return { total: 0, rows: [] };
  const marks = gtins.map(() => '?').join(',');
  const ranked = `SELECT ${FIELDS},
      ROW_NUMBER() OVER (PARTITION BY gtin,canal_codigo ORDER BY referencia_em DESC,quantidade_minima DESC,id DESC) AS rn
    FROM ${TABLE} WHERE uf='MA' AND gtin IN (${marks}) AND quantidade_minima<=?`;
  const args = [...gtins, quantity];
  const [count] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (${ranked}) t WHERE rn=1`, args);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM (${ranked}) t WHERE rn=1 ORDER BY price ASC, channelName ASC, id ASC LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  return { total: Number(count[0]?.total ?? 0), rows: rows.map(toRow) };
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

/** Até 500 produtos cujo nome contém a primeira palavra pesquisada (base da similaridade). */
export async function similarCandidates(firstWord: string): Promise<{ gtin: string; name: string; brand: string; size: string }[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT gtin,produto_nome AS name,marca AS brand,embalagem AS size,MAX(referencia_em) AS lastReference
     FROM ${TABLE} WHERE uf='MA' AND produto_nome ${ACCENT_INSENSITIVE} LIKE ?
     GROUP BY gtin,produto_nome,marca,embalagem ORDER BY lastReference DESC LIMIT 500`,
    [likeTerm(firstWord)]
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
