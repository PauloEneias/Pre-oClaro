/**
 * Testes sem rede e sem MySQL. As fixtures são respostas REAIS dos sites,
 * gravadas em 10/11/2026 (reduzidas aos campos usados).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSaoLuis, buildProductsQueryUrl, collectAtacadao, parseAtacadaoProductsPage,
  parseAtacadaoStorePage, parseEanLookup,
} from '../src/integrations/atacadao.js';
import {
  MateusNotAuthorizedError, buildMateusListingBody, collectMateusMais, mateusOffer,
  assertMateusMarketInSaoLuis, parseMateusDepartments, parseMateusListing, parseMateusMarketDetail,
  parseMateusMarketGroups, parseMateusProduct,
} from '../src/integrations/mateusMais.js';
import { coherentTiers, extractPackage, normalizeGtin, saoLuisDate, validateOffer, type CollectedOffer } from '../src/integrations/offerValidation.js';
import { HttpError, PoliteClient, parseRobots, robotsAllows } from '../src/integrations/politeHttp.js';
import { currentQuotes, type CatalogRow } from '../src/catalogComparison.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const text = (name: string) => readFileSync(join(dir, name), 'utf8');
const json = (name: string) => JSON.parse(text(name)) as unknown;
const store = () => parseAtacadaoStorePage(text('atacadao-loja-sao-luis.html'), 'sao-luis');

test('Atacadão: página da loja identifica a unidade real de São Luís', () => {
  const s = store();
  assert.equal(s.storeId, 747);
  assert.equal(s.seller, 'atacadaobr747');
  assert.equal(s.city, 'São Luís');
  assert.equal(s.state, 'MA');
  assert.equal(s.channelCode, 'ATACADAO_SAO_LUIS_24H');
  assert.equal(s.externalId, 'ATACADAO:747');
  assert.equal(s.regionId, 'U1cjYXRhY2FkYW9icjc0Nw=='); // o mesmo valor que o site envia
  assert.ok(Math.abs(s.latitude + 2.5237) < 0.001 && Math.abs(s.longitude + 44.24239) < 0.001);
  assert.doesNotThrow(() => assertSaoLuis(s));
});

test('Atacadão: loja de outra cidade é recusada', () => {
  assert.throws(() => assertSaoLuis({ ...store(), city: 'Teresina', state: 'PI' }), /não em São Luís/);
  assert.throws(() => parseAtacadaoStorePage(text('atacadao-loja-sao-luis.html'), 'teresina'), /outra loja/);
  assert.throws(() => parseAtacadaoStorePage('<html><body>bloqueado</body></html>', 'sao-luis'), /__NEXT_DATA__/);
});

test('Atacadão: vitrine traz preço unitário e de atacado do produto certo', () => {
  const page = parseAtacadaoProductsPage(json('atacadao-products-page.json'), store());
  assert.equal(page.totalCount, 927);
  assert.equal(page.items.length, 20);
  const arroz = page.items.find((i) => i.sku === '13743')!;
  assert.equal(arroz.name, 'Arroz Branco Camil Tipo 1 5kg');
  assert.equal(arroz.brand, 'Camil');
  assert.deepEqual(arroz.tiers, [
    { price: 27.95, listPrice: null, minimumQuantity: 1 },
    { price: 26.95, listPrice: null, minimumQuantity: 6 },
  ]);
});

test('Atacadão: preço de vendedor de outra loja é descartado', () => {
  const payload = json('atacadao-products-page.json') as { data: { search: { products: { edges: { node: { offers: { offers: { seller: { identifier: string } }[] } } }[] } } } };
  for (const offer of payload.data.search.products.edges[0].node.offers.offers) offer.seller.identifier = 'atacadaobr1';
  const page = parseAtacadaoProductsPage(payload, store());
  assert.ok(page.foreignOffers >= 1);
  assert.equal(page.items[0].tiers.length, 0);
});

test('Atacadão: EAN vem do catálogo, não do código interno da vitrine', () => {
  const eans = parseEanLookup(json('atacadao-eans.json'));
  assert.equal(eans.get('13743')?.ean, '7896006711155'); // Arroz Camil 5kg
  assert.equal(eans.get('27439')?.ean, '7898215151784'); // Creme de leite Piracanjuba
  const page = parseAtacadaoProductsPage(json('atacadao-products-page.json'), store());
  assert.equal(page.items.find((i) => i.sku === '13743')?.internalCode, '12658945');
  assert.equal(normalizeGtin('12658945'), null); // o código interno não passa como GTIN
});

test('Atacadão: coleta completa com respostas gravadas valida e monta as ofertas', async () => {
  const calls: string[] = [];
  const client = new PoliteClient({
    minDelayMs: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\nDisallow: /busca/*\n');
      if (url.includes('/loja/sao-luis')) return new Response(text('atacadao-loja-sao-luis.html'));
      if (url.includes('ProductsQuery')) {
        const offset = Number(JSON.parse(new URL(url).searchParams.get('variables')!).after);
        const body = json('atacadao-products-page.json') as { data: { search: { products: { pageInfo: { totalCount: number }; edges: unknown[] } } } };
        body.data.search.products.pageInfo.totalCount = 20;
        if (offset > 0) body.data.search.products.edges = [];
        return new Response(JSON.stringify(body));
      }
      if (url.includes('catalog_system')) return new Response(text('atacadao-eans.json'));
      return new Response('', { status: 404 });
    },
  });
  const result = await collectAtacadao({ client });
  assert.equal(result.stats.found, 20);
  assert.equal(result.stats.complete, true);
  assert.equal(result.newEans.size, 20);
  const arroz = result.offers.filter((o) => o.gtin === '7896006711155');
  assert.deepEqual(arroz.map((o) => [o.price, o.minimumQuantity]), [[27.95, 1], [26.95, 6]]);
  assert.ok(result.offers.every((o) => o.storeExternalId === 'ATACADAO:747' && o.city === 'São Luís' && o.source === 'ATACADAO_SITE'));
  assert.ok(result.offers.every((o) => o.sourceUrl.startsWith('https://www.atacadao.com.br/') && o.sourceUrl.endsWith('/p')));
  assert.ok(calls.some((u) => u.includes('atacadaobr747')), 'a consulta precisa levar o vendedor da loja');
});

test('Atacadão: queda de rede interrompe a coleta sem devolver oferta', async () => {
  const client = new PoliteClient({ minDelayMs: 0, retries: 0, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => collectAtacadao({ client }), (err: unknown) => err instanceof HttpError && /Falha de rede/.test(err.message));
});

test('URL da vitrine usa vendedor e região da loja', () => {
  const variables = JSON.parse(new URL(buildProductsQueryUrl(store(), 200, 'name_asc')).searchParams.get('variables')!);
  assert.equal(variables.after, '200');
  assert.deepEqual(JSON.parse(variables.selectedFacets[0].value), { salesChannel: '1', seller: 'atacadaobr747', regionId: 'U1cjYXRhY2FkYW9icjc0Nw==' });
});

test('validação: GTIN, preço, filial e quantidade mínima', () => {
  const base = {
    gtin: '7896006711155', productName: 'Arroz Branco Camil Tipo 1 5kg', brand: 'Camil', network: 'Atacadão' as const,
    channelCode: 'ATACADAO_SAO_LUIS_24H', channelName: 'Atacadão São Luís 24hrs', storeExternalId: 'ATACADAO:747',
    city: 'São Luís', state: 'MA', price: 27.95, listPrice: 29.9, minimumQuantity: 1,
    sourceUrl: 'https://www.atacadao.com.br/x/p', source: 'ATACADAO_SITE' as const, collectedAt: '2026-11-10T01:00:00.000Z', externalSku: '13743',
  };
  const ok = validateOffer(base);
  assert.ok(ok.ok && ok.offer.size === '5kg' && ok.offer.listPrice === 29.9);
  const reason = (patch: Record<string, unknown>) => { const r = validateOffer({ ...base, ...patch }); return r.ok ? 'ok' : r.reason; };
  assert.match(reason({ gtin: '7896006711154' }), /GTIN/);
  assert.match(reason({ gtin: null }), /GTIN/);
  assert.match(reason({ price: 0 }), /preço/);
  assert.match(reason({ price: 'abc' }), /preço/);
  assert.match(reason({ minimumQuantity: 0 }), /quantidade/);
  assert.match(reason({ brand: '' }), /marca/);
  assert.match(reason({ city: 'Imperatriz' }), /fora de São Luís/);
  assert.match(reason({ storeExternalId: '' }), /filial/);
  assert.match(reason({ collectedAt: '2999-01-01T00:00:00Z' }), /futura/);
});

test('GTIN: formas equivalentes viram um só código; códigos internos são recusados', () => {
  assert.equal(normalizeGtin('611269991000'), '0611269991000');
  assert.equal(normalizeGtin('00611269991000'), '0611269991000');
  assert.equal(normalizeGtin('0192505233271'), '0192505233271');
  assert.equal(normalizeGtin('7896006711155'), '7896006711155');
  assert.equal(normalizeGtin('2000000000015'), null); // prefixo 2 = código da própria loja
  assert.equal(normalizeGtin('45984906'), null);
  assert.equal(extractPackage('Caixa de Variedades Lacta Favoritos 250,6g'), '250,6g');
  assert.equal(extractPackage('Ovo Branco Grande 20 un'), '20 un');
  assert.equal(saoLuisDate('2026-11-10T01:30:00.000Z'), '2026-11-09'); // 22h30 do dia 9 em São Luís
});

test('faixas: atacado só vale se for mais barato que a faixa anterior', () => {
  const o = (price: number, minimumQuantity: number) => ({ price, minimumQuantity }) as CollectedOffer;
  assert.deepEqual(coherentTiers([o(10, 1), o(9, 3), o(9.5, 6), o(8, 12)]).kept.map((t) => t.minimumQuantity), [1, 3, 12]);
  assert.equal(coherentTiers([o(9, 3)]).kept.length, 0); // sem preço unitário não entra
});

test('comparação: faixa de atacado que sumiu na coleta mais nova não é usada', () => {
  const row = (price: number, min: number, day: string): CatalogRow => ({
    id: min * 1000 + Number(day.slice(-2)), gtin: '7896006711155', productName: 'Arroz', brand: 'Camil', size: '5kg',
    network: 'Atacadão', channelCode: 'ATACADAO_SAO_LUIS_24H', channelName: 'Atacadão', city: 'São Luís', state: 'MA',
    price, minimumQuantity: min, sourceUrl: 'https://www.atacadao.com.br/x/p', referenceDate: day, referenceType: 'COLETA_AUTOMATICA', notice: '',
  });
  const rows = [row(27.95, 1, '2026-11-09'), row(26.95, 6, '2026-11-09'), row(28.5, 1, '2026-11-12')];
  assert.equal(currentQuotes(rows, '7896006711155', 6)[0].price, 28.5);
});

test('robots.txt: respeita Disallow do grupo * e ignora HTML', () => {
  const rules = parseRobots('User-agent: *\nAllow: /\nDisallow: /busca/*\nDisallow: /checkout\n');
  assert.equal(robotsAllows(rules, '/api/graphql'), true);
  assert.equal(robotsAllows(rules, '/loja/sao-luis'), true);
  assert.equal(robotsAllows(rules, '/busca/arroz'), false);
  assert.equal(robotsAllows(rules, '/checkout'), false);
  assert.deepEqual(parseRobots('<!doctype html><html></html>'), { allow: [], disallow: [] });
});

test('cliente HTTP: robots proibindo o caminho impede a requisição', async () => {
  const client = new PoliteClient({ minDelayMs: 0, fetchImpl: async () => new Response('User-agent: *\nDisallow: /api/\n') });
  await assert.rejects(() => client.assertAllowed('https://exemplo.test/api/graphql'), /robots\.txt/);
});

test('cliente HTTP: tenta de novo em 503 e desiste em 403', async () => {
  let calls = 0;
  const flaky = new PoliteClient({ minDelayMs: 0, retries: 1, fetchImpl: async () => (++calls === 1 ? new Response('', { status: 503 }) : new Response('{"ok":true}')) });
  assert.deepEqual(await flaky.getJson('https://exemplo.test/a'), { ok: true });
  assert.equal(calls, 2);
  let blockedCalls = 0;
  const blocked = new PoliteClient({ minDelayMs: 0, retries: 3, fetchImpl: async () => { blockedCalls++; return new Response('', { status: 403 }); } });
  await assert.rejects(() => blocked.getJson('https://exemplo.test/a'), /HTTP 403/);
  assert.equal(blockedCalls, 1);
});

test('Mateus Mais: unidades de São Luís, departamentos e produto (respostas reais)', () => {
  const markets = parseMateusMarketGroups(json('mateus-market-groups.json'), ['Mercado', 'Food Service', 'Spazio']);
  assert.equal(markets.length, 6);
  const cohama = markets.find((m) => m.id === '2857c51e-ffc9-4365-b39a-0156cfc032b9')!;
  assert.equal(cohama.name, 'Supermercado Mateus Cohama');
  assert.equal(cohama.channelCode, 'MATEUS_COHAMA_SLZ');
  assert.equal(markets.find((m) => m.slug === 'supermercado-mateus-calhau')?.channelCode, 'MATEUS_SUPERMERCADO_MATEUS_CALHAU');
  const departments = parseMateusDepartments(json('mateus-departments.json'));
  const mercearia = departments.find((d) => d.name === 'Mercearia')!;
  assert.ok(mercearia.sections.length > 0 && mercearia.sections[0].categories.length > 0);
  assert.ok(!departments.some((d) => d.name === 'Ofertas'), '"Ofertas" não é departamento real');

  const product = parseMateusProduct(json('mateus-product-detail.json'))!;
  assert.equal(product.barcode, '7896006751113');
  assert.equal(product.price, 6.99); // preço com promoção
  assert.equal(product.listPrice, 9.39); // preço cheio
  const offer = mateusOffer(product, cohama, '2026-11-10T01:00:00.000Z');
  assert.ok(offer.ok && offer.offer.gtin === '7896006751113' && offer.offer.size === '1kg' && offer.offer.minimumQuantity === 1);
  const other = mateusOffer(product, markets.find((m) => m.id !== cohama.id)!, '2026-11-10T01:00:00.000Z');
  assert.ok(!other.ok && /outra unidade/.test(other.reason));
});

test('Mateus Mais: paginação da vitrine e corpo da consulta', () => {
  const listing = parseMateusListing(json('mateus-listing.json'));
  assert.equal(listing.totalPages, 51);
  assert.equal(listing.truncated, true);
  assert.equal(listing.products[0].barcode, '0192505233271');
  const body = buildMateusListingBody('2857c51e-ffc9-4365-b39a-0156cfc032b9', { key: 'section_id', id: 'ca778bb4-8c72-43b3-8db0-1ac5d34430e2' });
  assert.equal(body.service, 'meilisearch');
  assert.deepEqual(body.market_priority.market_ids, ['2857c51e-ffc9-4365-b39a-0156cfc032b9']);
  assert.match(decodeURIComponent(body.params), /page=0&hitsPerPage=1000.*market_id:2857c51e.*section_id:ca778bb4.*for_sale:true/);
});

test('Mateus Mais: coleta não roda sem autorização explícita', async () => {
  let calls = 0;
  const client = new PoliteClient({ minDelayMs: 0, fetchImpl: async () => { calls++; return new Response('[]'); } });
  await assert.rejects(() => collectMateusMais({ client, authorized: false }), MateusNotAuthorizedError);
  assert.equal(calls, 0, 'nenhuma requisição pode sair');
});

test('Mateus Mais: ficha da unidade confirma São Luís/MA e dá as coordenadas', () => {
  const detail = parseMateusMarketDetail(json('mateus-market-detail.json'));
  assert.equal(detail.city, 'São Luís');
  assert.equal(detail.state, 'MA');
  assert.ok(detail.latitude !== null && Math.abs(detail.latitude + 2.4989725) < 1e-6);
  const market = parseMateusMarketGroups(json('mateus-market-groups.json'), ['Food Service'])[0];
  assert.doesNotThrow(() => assertMateusMarketInSaoLuis(market, detail));
  assert.throws(() => assertMateusMarketInSaoLuis(market, { ...detail, city: 'Imperatriz', cityCode: '2105302' }), /não em São Luís/);
});

test('Mateus Mais: venda em múltiplos vira quantidade mínima; produto a granel é recusado', () => {
  const base = json('mateus-product-detail.json') as Record<string, unknown>;
  const market = parseMateusMarketGroups(json('mateus-market-groups.json'), ['Mercado']).find((m) => m.id === base.market_id)!;
  const multiple = parseMateusProduct({ ...base, multiple: 4, sale_in_multiple: true })!;
  assert.equal(multiple.minimumQuantity, 4);
  const offer = mateusOffer(multiple, market, '2026-11-10T01:00:00.000Z');
  assert.ok(offer.ok && offer.offer.minimumQuantity === 4);
  assert.equal(parseMateusProduct({ ...base, multiple: 4, sale_in_multiple: false })!.minimumQuantity, 1);
  const bulk = mateusOffer(parseMateusProduct({ ...base, is_bulk: true })!, market, '2026-11-10T01:00:00.000Z');
  assert.ok(!bulk.ok && /granel/.test(bulk.reason));
});

test('Mateus Mais: resposta cortada faz o coletor descer para seção e categoria', async () => {
  const scopes: string[] = [];
  const sample = (json('mateus-listing.json') as { hits: Record<string, unknown>[] }).hits[0];
  const client = new PoliteClient({
    minDelayMs: 0,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.includes('market-category-group')) return new Response(text('mateus-market-groups.json'));
      if (url.includes('market-detail-slug')) return new Response(text('mateus-market-detail.json'));
      if (url.includes('/departments/')) return new Response(text('mateus-departments.json'));
      const scope = decodeURIComponent(String(JSON.parse(String(init?.body)).params)).match(/(departament|section|category)_id/)![0];
      scopes.push(scope);
      // O primeiro departamento e a primeira seção vêm cortados; o resto vem inteiro.
      const truncated = scopes.filter((s) => s === scope).length === 1 && scope !== 'category_id';
      const id = `00000000-0000-4000-8000-${String(scopes.length).padStart(12, '0')}`;
      const hit = { ...sample, objectID: id, barcode: '7896006711155', market_id: 'f7a3a08f-12bf-4507-ae1b-81d8c02790cf' };
      return new Response(JSON.stringify({ hits: [hit], nbHits: 1, page: 0, nbPages: 1, truncated }));
    },
  });
  const result = await collectMateusMais({ client, authorized: true, onlyMarkets: ['mateusfoodservice'] });
  assert.equal(result.markets.length, 1);
  assert.equal(result.markets[0].channelCode, 'MATEUS_FOOD_EXPRESS_SLZ');
  assert.ok(result.markets[0].latitude !== null);
  assert.deepEqual(scopes.slice(0, 2), ['departament_id', 'section_id']);
  assert.ok(scopes.includes('category_id'), 'precisa descer até categoria quando a seção vem cortada');
  assert.equal(result.stats.complete, true);
  assert.equal(result.offers.length, scopes.length);
  assert.ok(result.offers.every((o) => o.storeExternalId === 'MATEUS:f7a3a08f-12bf-4507-ae1b-81d8c02790cf' && o.source === 'MATEUS_MAIS_SITE'));
});
