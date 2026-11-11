/**
 * SERVICE (apoio) — ordenação por relevância ANTES da paginação, comum ao catálogo e à busca de
 * ofertas. O repositório devolve todos os candidatos do pré-filtro SQL; aqui eles recebem nota,
 * são separados em "fortes" e "relacionados", filtrados por categoria, ordenados e só então
 * paginados. Assim a ordenação por preço nunca põe um item irrelevante na frente.
 */
import {
  CATEGORIES, categoryLabel, classifyCategory, compareRanked, parseQuery, scoreBest, suggestCorrection, usuallySoldByWeight,
  type CategoryId, type MatchTier, type ParsedQuery,
} from '../searchRelevance.js';

export type RankSort = 'relevance' | 'price' | 'name' | 'recent' | 'distance';
type Describe<T> = (row: T) => { names: string[]; brand: string; size: string; gtin: string | null };
type Keys<T> = { price: (row: T) => number | null; name: (row: T) => string; recent?: (row: T) => string; distance?: (row: T) => number | null; id: (row: T) => string | number };
export type Ranked<T> = T & { tier: MatchTier; score: number; category: CategoryId };

/** Resumo da pesquisa devolvido à interface (mensagem de "não encontrado", correção, categorias). */
export type SearchSummary = {
  query: string;
  /** Pesquisa efetivamente usada quando a digitada não tinha resultado e havia correção segura. */
  correctedQuery: string | null;
  /** 'strong' = produtos que são o item pesquisado; 'related' = só contêm/acompanham o termo. */
  showing: 'strong' | 'related' | 'all';
  strongTotal: number;
  relatedTotal: number;
  category: CategoryId | null;
  categories: { id: CategoryId; label: string; count: number }[];
  /** Item costuma ser vendido por peso/a granel — hoje fora da comparação por falta de GTIN. */
  soldByWeightHint: boolean;
  /** Pesquisa ampla demais: os candidatos passaram do teto e a lista pode estar incompleta. */
  truncated: boolean;
};

const nullsLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b);

/**
 * Executa a pesquisa por relevância. `fetch` busca os candidatos para uma pesquisa interpretada;
 * se nada casar e houver correção segura de digitação, tenta de novo com a pesquisa corrigida.
 */
export async function rankSearch<T>(input: {
  q: string; category: CategoryId | null; related: boolean; sort: RankSort; page: number; perPage: number;
  fetch: (parsed: ParsedQuery | null) => Promise<{ rows: T[]; truncated: boolean }>;
  describe: Describe<T>; keys: Keys<T>;
}): Promise<{ pageRows: Ranked<T>[]; total: number; summary: SearchSummary }> {
  let parsed = input.q ? parseQuery(input.q) : null;
  let found = await input.fetch(parsed);
  let correctedQuery: string | null = null;
  if (parsed && found.rows.length === 0) {
    const fixed = suggestCorrection(input.q);
    if (fixed && fixed !== parsed.normalized) {
      const retry = parseQuery(fixed);
      const again = await input.fetch(retry);
      if (again.rows.length) { parsed = retry; found = again; correctedQuery = fixed; }
    }
  }

  const scored: Ranked<T>[] = found.rows.map((row) => {
    const d = input.describe(row);
    const s = parsed
      ? scoreBest(parsed, d.names, { brand: d.brand, size: d.size, gtin: d.gtin })
      : { tier: 'strong' as const, score: 0, category: classifyCategory(d.names[0] ?? '') };
    return { ...row, ...s };
  }).filter((r) => r.tier !== 'none');

  const strong = scored.filter((r) => r.tier === 'strong');
  const related = scored.filter((r) => r.tier === 'related');
  const showRelated = Boolean(parsed) && input.related && related.length > 0;
  const pool = showRelated ? related : strong;

  const counts = new Map<CategoryId, number>();
  for (const r of pool) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const list = input.category ? pool.filter((r) => r.category === input.category) : pool;

  const k = input.keys;
  const tiebreak = (a: T, b: T) => {
    if (input.sort === 'price') return nullsLast(k.price(a), k.price(b)) || String(k.id(a)).localeCompare(String(k.id(b)));
    if (input.sort === 'distance' && k.distance) return nullsLast(k.distance(a), k.distance(b)) || nullsLast(k.price(a), k.price(b));
    if (input.sort === 'name') return k.name(a).localeCompare(k.name(b), 'pt-BR') || String(k.id(a)).localeCompare(String(k.id(b)));
    if (input.sort === 'recent' && k.recent) return k.recent(b).localeCompare(k.recent(a)) || String(k.id(a)).localeCompare(String(k.id(b)));
    return nullsLast(k.price(a), k.price(b)) || String(k.id(a)).localeCompare(String(k.id(b)));
  };
  list.sort((a, b) => compareRanked(a, b, tiebreak, input.sort === 'relevance'));

  const start = (input.page - 1) * input.perPage;
  return {
    pageRows: list.slice(start, start + input.perPage),
    total: list.length,
    summary: {
      query: input.q, correctedQuery,
      showing: parsed ? (showRelated ? 'related' : 'strong') : 'all',
      strongTotal: strong.length, relatedTotal: related.length,
      category: input.category,
      categories: CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({ id: c.id, label: categoryLabel(c.id), count: counts.get(c.id)! })),
      soldByWeightHint: Boolean(parsed) && strong.length === 0 && usuallySoldByWeight(parsed!),
      truncated: found.truncated,
    },
  };
}
