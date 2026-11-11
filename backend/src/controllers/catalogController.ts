/**
 * CONTROLLER — catálogo, comparação entre redes, cesta e ofertas geolocalizadas.
 * Só traduz HTTP ↔ serviço: lê e valida parâmetros, chama o serviço, devolve JSON.
 */
import type { FastifyInstance } from 'fastify';
import { parsePriceMode, parseProductId, parseQuantity } from '../comparison.js';
import { validateBasket } from '../catalogComparison.js';
import { gtinValid } from '../csv.js';
import { parseLocationFilter } from '../location.js';
import { badRequest, notFound, parsePaging, valid, type Query } from '../http/errors.js';
import * as catalog from '../services/catalogService.js';
import * as products from '../services/productService.js';
import * as stores from '../services/storeService.js';
import { imageCoverage } from '../repositories/productRepository.js';
import { pool } from '../db.js';
import { CATEGORIES, isCategory } from '../searchRelevance.js';

const text = (value: string | undefined, max: number, label: string) => {
  const result = String(value ?? '').trim();
  if (result.length > max) throw badRequest(`${label} muito longo (máximo ${max} caracteres).`);
  return result;
};

/**
 * Rotas públicas de leitura (GET), agrupadas por assunto:
 *  saúde (/api/health, /api/health/live), lojas próximas (/api/stores/nearby),
 *  ofertas geolocalizadas (/api/products/search, /api/products/:id),
 *  preços online por UF (/api/market/prices) e catálogo comparável (/api/catalog/*).
 * Cada rota valida a querystring e devolve 400 com mensagem clara quando algo é inválido.
 */
export function registerCatalogRoutes(app: FastifyInstance): void {
  // ---- saúde ----
  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'connected', osm: 'external service on demand', prices: 'demo_and_documented_import_supported' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', database: 'disconnected', message: 'Confira o MySQL, o arquivo .env e os scripts SQL.' });
    }
  });
  /** Só diz que o processo está de pé (sondas de hospedagem); não toca no banco. */
  app.get('/api/health/live', async () => ({ status: 'ok' }));
  /** Cobertura de fotos (produtos com e sem imagem confiável). */
  app.get('/api/stats/images', async () => {
    const coverage = await imageCoverage();
    return { ...coverage, withoutImage: coverage.products - coverage.withImage };
  });

  // ---- mercados próximos ----
  app.get<{ Querystring: Query }>('/api/stores/nearby', async (request) => {
    const location = valid(() => parseLocationFilter(request.query));
    if (!location) throw badRequest('Autorize sua localização ou selecione um bairro para buscar mercados reais.');
    return stores.nearby(location, request.log);
  });

  // ---- ofertas geolocalizadas ----
  app.get<{ Querystring: Query }>('/api/products/search', async (request) => {
    const q = text(request.query.q, 80, 'Busca');
    const { page, perPage } = parsePaging(request.query, [...products.SEARCH_PAGE_SIZES], 20);
    const sort = request.query.sort ?? (q ? 'relevance' : 'price');
    if (sort !== 'price' && sort !== 'distance' && sort !== 'name' && sort !== 'relevance') throw badRequest('Ordenação inválida.');
    const categoryParam = text(request.query.category, 20, 'Categoria');
    if (categoryParam && !isCategory(categoryParam)) throw badRequest('Categoria inválida.');
    const maxPrice = request.query.maxPrice ? Number(request.query.maxPrice) : null;
    if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 100000)) throw badRequest('Preço máximo inválido.');
    const freshHours = request.query.freshHours ? Number(request.query.freshHours) : null;
    if (freshHours !== null && (!Number.isSafeInteger(freshHours) || freshHours < 1 || freshHours > 720)) throw badRequest('Período inválido.');
    const storeId = request.query.storeId ? Number(request.query.storeId) : null;
    if (storeId !== null && (!Number.isSafeInteger(storeId) || storeId < 1)) throw badRequest('Loja inválida.');
    return products.search(
      {
        q, mode: valid(() => parsePriceMode(request.query.mode)), quantity: valid(() => parseQuantity(request.query.quantity)),
        location: valid(() => parseLocationFilter(request.query)), storeId, maxPrice, freshHours, sort,
      },
      page, perPage,
      { category: categoryParam && isCategory(categoryParam) ? categoryParam : null, related: request.query.related === '1' }
    );
  });

  /** Detalhe de um produto: ofertas nas lojas do mapa e histórico realmente observado. */
  app.get<{ Params: { id: string }; Querystring: Query }>('/api/products/:id', async (request) =>
    products.detail(
      valid(() => parseProductId(request.params.id)), valid(() => parsePriceMode(request.query.mode)),
      valid(() => parseQuantity(request.query.quantity)), valid(() => parseLocationFilter(request.query))
    )
  );

  /** Preços digitais por UF de um EAN (Data Market), sem valor de prateleira. */
  app.get<{ Querystring: Query }>('/api/market/prices', async (request) => {
    const ean = String(request.query.ean ?? '').trim();
    if (!gtinValid(ean)) throw badRequest('Informe um EAN/GTIN válido.');
    const uf = String(request.query.uf ?? 'MA').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) throw badRequest('UF inválida.');
    return products.onlinePrices(ean, uf);
  });

  // ---- catálogo comparável ----
  app.get<{ Querystring: Query }>('/api/catalog/prices', async (request) => {
    const q = text(request.query.q, 80, 'Pesquisa');
    const quantity = valid(() => parseQuantity(request.query.quantity));
    const uf = String(request.query.uf ?? 'MA').trim().toUpperCase();
    if (uf !== 'MA') throw badRequest('Somente o Maranhão está disponível neste módulo.');
    const { page, perPage } = parsePaging(request.query, [12, 20, 24, 40, 60, 100], 12);
    return catalog.documentedPrices(q, quantity, page, perPage);
  });

  /**
   * Catálogo paginado. Parâmetros: q, network | compare=1, quantity, sort
   * (relevance | price | recent | name), category, related=1, page, perPage.
   */
  app.get<{ Querystring: Query }>('/api/catalog/items', async (request) => {
    const q = text(request.query.q, 100, 'Filtro');
    const network = text(request.query.network, 100, 'Filtro');
    const compare = request.query.compare === '1';
    if (compare && network) throw badRequest('Use o filtro de mercado OU a comparação entre redes, não os dois.');
    // Com pesquisa, o padrão é a relevância; sem pesquisa, a coleta mais recente.
    const sort = request.query.sort ?? (q ? 'relevance' : 'recent');
    if (sort !== 'recent' && sort !== 'name' && sort !== 'relevance' && sort !== 'price') throw badRequest('Ordenação inválida.');
    const categoryParam = text(request.query.category, 20, 'Categoria');
    if (categoryParam && !isCategory(categoryParam)) throw badRequest('Categoria inválida.');
    const category = categoryParam && isCategory(categoryParam) ? categoryParam : null;
    const { page, perPage } = parsePaging(request.query, [...catalog.PAGE_SIZES], 20);
    return catalog.listItems({
      q, network, compare, quantity: valid(() => parseQuantity(request.query.quantity)), sort, page, perPage,
      category, related: request.query.related === '1',
    });
  });

  /** Categorias internas do catálogo (classificação pelo núcleo do nome do produto). */
  app.get('/api/catalog/categories', async () => ({ categories: CATEGORIES }));

  /** Comparação de um GTIN entre todas as unidades. */
  app.get<{ Querystring: Query }>('/api/catalog/compare', async (request) => {
    const gtin = String(request.query.gtin ?? '').trim();
    if (!gtinValid(gtin)) throw badRequest('Código de barras inválido.');
    const result = await catalog.compareOne(gtin, valid(() => parseQuantity(request.query.quantity)));
    if (!result) throw notFound('Produto ainda não cadastrado no catálogo documentado.');
    return result;
  });

  /** Compara uma cesta enviada no corpo (visitante sem conta). Leitura pura: não grava nada. */
  app.post<{ Body: unknown }>('/api/catalog/basket/compare', async (request) => {
    const body = request.body as Record<string, unknown> | null;
    return catalog.compareBasketLines(valid(() => validateBasket(body?.items)));
  });

  /** Nomes parecidos (sugestão manual; nunca une GTINs diferentes). */
  app.get<{ Querystring: Query }>('/api/catalog/similar', async (request) => {
    const q = String(request.query.q ?? '').trim();
    const brand = String(request.query.brand ?? '').trim();
    const size = String(request.query.size ?? '').trim();
    if (q.length < 3 || q.length > 120 || brand.length > 100 || size.length > 40) throw badRequest('Informe nome do produto (3–120 caracteres).');
    return catalog.similar({ q, brand, size, gtin: String(request.query.gtin ?? '').trim() });
  });

  /** Redes e unidades existentes no catálogo (seletor do Conferir Caixa). */
  app.get('/api/catalog/channels', async () => ({ channels: await catalog.channels() }));
}
