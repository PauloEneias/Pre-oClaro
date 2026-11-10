/**
 * TESTE DE INTEGRAÇÃO DA API — precisa só do MySQL do .env. NÃO faz nenhuma chamada externa.
 * Uso: npm run test:integration
 *
 * Roda no banco isolado `precoclaro_itest` (criado pelas migrações do projeto) e usa
 * `app.inject`, então nenhuma porta é aberta. O banco `precoclaro` não é tocado.
 */
import 'dotenv/config';
import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';

const uploads = mkdtempSync(join(tmpdir(), 'precoclaro-anexos-'));
process.env.DB_NAME = 'precoclaro_itest';
process.env.UPLOADS_DIR = uploads;
process.env.BCRYPT_ROUNDS = '10';
process.env.LIVE_SCRAPE_ENABLED = 'false';

const { migrate } = await import('../../scripts/migrate.js');
const { buildApp } = await import('../../src/app.js');
const { pool } = (await import('../../src/db.js')) as { pool: Pool };
let app: FastifyInstance;

const A = '7891000000014', B = '7891000000021', C = '7891000000038', D = '7891000000045';
type Res = { status: number; body: any; cookie: string | null; headers: Record<string, unknown> };
async function call(method: string, url: string, options: { body?: unknown; cookie?: string | null; csrf?: boolean; origin?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (options.csrf !== false) headers['x-requested-with'] = 'PrecoClaro';
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin) headers.origin = options.origin;
  const response = await app.inject({ method: method as 'GET', url, headers, ...(options.body !== undefined ? { payload: options.body as object } : {}) });
  const set = response.headers['set-cookie'];
  const raw = Array.isArray(set) ? set[0] : set;
  let body: unknown = null;
  try { body = response.json(); } catch { body = response.rawPayload; }
  return { status: response.statusCode, body, cookie: raw ? String(raw).split(';')[0] : null, headers: response.headers };
}
const email = (name: string) => `${name}.${Date.now()}@teste.precoclaro.local`;
async function newUser(name: string) {
  const address = email(name);
  const r = await call('POST', '/api/auth/register', { body: { name: `Pessoa ${name}`, email: address, password: 'senha-forte-123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email: address, cookie: r.cookie!, id: r.body.user.id as number };
}

before(async () => {
  await migrate('precoclaro_itest', undefined, () => undefined);
  for (const table of ['conferencia_anexos', 'conferencia_itens', 'conferencias', 'lista_itens', 'listas', 'sessoes', 'tentativas_login', 'usuarios', 'produto_imagens'])
    await pool.query(`DELETE FROM \`${table}\``);
  // Catálogo de teste: A nas duas redes (com atacado e duas unidades do Mateus), B só no
  // Atacadão, C só no Mateus (venda em múltiplos de 4), D nas duas com o mesmo preço.
  await pool.query("DELETE FROM catalogo_ofertas_documentadas WHERE gtin LIKE '78910000000%'");
  const row = (gtin: string, name: string, network: string, code: string, channel: string, price: number, min: number, day = '2026-11-10') =>
    [gtin, name, 'Marca Teste', '1kg', network, code, channel, 'São Luís', 'MA', price, min, 'https://www.atacadao.com.br/teste/p', day, 'COLETA_AUTOMATICA', 'Teste'];
  await pool.query(
    `INSERT INTO catalogo_ofertas_documentadas
       (gtin,produto_nome,marca,embalagem,rede,canal_codigo,canal_nome,cidade,uf,preco,quantidade_minima,fonte_url,referencia_em,tipo_consulta,observacao) VALUES ?`,
    [[
      row(A, 'Zzteste Arroz 1kg', 'Atacadão', 'ATACADAO_SAO_LUIS_24H', 'Atacadão São Luís 24hrs', 10, 1),
      row(A, 'Zzteste Arroz 1kg', 'Atacadão', 'ATACADAO_SAO_LUIS_24H', 'Atacadão São Luís 24hrs', 9, 6),
      row(A, 'Zzteste Arroz 1kg', 'Mateus Mais', 'MATEUS_COHAMA_SLZ', 'Supermercado Mateus Cohama', 9.5, 1),
      row(A, 'Zzteste Arroz 1kg', 'Mateus Mais', 'MATEUS_MIX_VINHAIS_SLZ', 'Mix Mateus Vinhais', 9.8, 1),
      row(B, 'Zzteste Feijão 1kg', 'Atacadão', 'ATACADAO_SAO_LUIS_24H', 'Atacadão São Luís 24hrs', 7, 1),
      row(C, 'Zzteste Café 500g', 'Mateus Mais', 'MATEUS_FOOD_EXPRESS_SLZ', 'Mateus Food Express', 12, 4),
      row(D, 'Zzteste Sal 1kg', 'Atacadão', 'ATACADAO_SAO_LUIS_24H', 'Atacadão São Luís 24hrs', 2.5, 1),
      row(D, 'Zzteste Sal 1kg', 'Mateus Mais', 'MATEUS_COHAMA_SLZ', 'Supermercado Mateus Cohama', 2.5, 1, '2026-10-01'),
    ]]
  );
  await pool.query("INSERT INTO produto_imagens(gtin,url,fonte,coletada_em) VALUES(?,?,?,UTC_TIMESTAMP())", [A, 'https://atacadaobr.vtexassets.com/arquivos/ids/1/teste.jpg', 'ATACADAO_SITE']);
  app = await buildApp({ logger: false });
});
after(async () => {
  await app?.close();
  await pool.query("DELETE FROM catalogo_ofertas_documentadas WHERE gtin LIKE '78910000000%'");
  await pool.end();
  rmSync(uploads, { recursive: true, force: true });
});

// ------------------------------------------------------------------ catálogo e paginação
test('catálogo: contagem real, primeira e última página, tamanho de página e página inexistente', async () => {
  const first = await call('GET', '/api/catalog/items?q=zzteste&perPage=20');
  assert.equal(first.status, 200);
  assert.equal(first.body.total, 4);
  assert.equal(first.body.pages, 1);
  assert.equal(first.body.items.length, 4);
  const all = await call('GET', '/api/catalog/items?perPage=20');
  const [count] = await pool.query<any[]>("SELECT COUNT(DISTINCT gtin) n FROM catalogo_ofertas_documentadas WHERE uf='MA'");
  assert.equal(all.body.total, Number(count[0].n), 'o total exibido é o do banco');
  assert.equal(all.body.pages, Math.ceil(all.body.total / 20));
  assert.equal(all.body.items.length, Math.min(20, all.body.total));
  const last = await call('GET', `/api/catalog/items?perPage=20&page=${all.body.pages}`);
  assert.equal(last.body.items.length, all.body.total - 20 * (all.body.pages - 1));
  const beyond = await call('GET', `/api/catalog/items?perPage=20&page=${all.body.pages + 5}`);
  assert.equal(beyond.status, 200);
  assert.deepEqual([beyond.body.items.length, beyond.body.total], [0, all.body.total]);
  if (all.body.pages > 1) {
    const second = await call('GET', '/api/catalog/items?perPage=20&page=2');
    const seen = new Set(all.body.items.map((i: any) => i.gtin));
    assert.ok(second.body.items.every((i: any) => !seen.has(i.gtin)), 'páginas não repetem produtos');
  }
  assert.equal((await call('GET', '/api/catalog/items?perPage=40')).body.perPage, 40);
  // A pesquisa ignora acentos e maiúsculas: "feijao" encontra "Feijão".
  assert.equal((await call('GET', '/api/catalog/items?q=zzteste%20feijao')).body.total, 1);
  assert.equal((await call('GET', '/api/catalog/items?q=ZZTESTE%20CAFE')).body.total, 1);
  assert.equal((await call('GET', '/api/catalog/items?q=zzteste%20100%25')).body.total, 0, '% digitado não vira curinga');
  assert.equal((await call('GET', '/api/catalog/items?perPage=33')).status, 400);
  assert.equal((await call('GET', '/api/catalog/items?page=0')).status, 400);
  const byName = await call('GET', '/api/catalog/items?q=zzteste&sort=name');
  assert.deepEqual(byName.body.items.map((i: any) => i.product.name), ['Zzteste Arroz 1kg', 'Zzteste Café 500g', 'Zzteste Feijão 1kg', 'Zzteste Sal 1kg']);
});

test('catálogo: filtros por rede e comparação Atacadão + Mateus por GTIN', async () => {
  const atacadao = await call('GET', '/api/catalog/items?q=zzteste&network=Atacad%C3%A3o');
  assert.deepEqual(atacadao.body.items.map((i: any) => i.gtin).sort(), [A, B, D]);
  assert.ok(atacadao.body.items.every((i: any) => i.offers.every((o: any) => o.network === 'Atacadão')));
  const mateus = await call('GET', '/api/catalog/items?q=zzteste&network=Mateus%20Mais');
  assert.deepEqual(mateus.body.items.map((i: any) => i.gtin).sort(), [A, C, D]);
  const cmp = await call('GET', '/api/catalog/items?q=zzteste&compare=1');
  assert.deepEqual(cmp.body.items.map((i: any) => i.gtin).sort(), [A, D], 'só o que existe nas duas redes');
  const a = cmp.body.items.find((i: any) => i.gtin === A).networks;
  assert.equal(a.cheapestNetwork, 'Mateus Mais');
  assert.equal(a.difference, 0.5);
  assert.equal(a.differencePercent, 5);
  assert.equal(a.sides[1].offer.channelName, 'Supermercado Mateus Cohama', 'identifica a unidade mais barata da rede');
  assert.equal(a.sides[1].unitsWithOffer, 2);
  const six = (await call('GET', '/api/catalog/items?q=zzteste&compare=1&quantity=6')).body.items.find((i: any) => i.gtin === A).networks;
  assert.equal(six.cheapestNetwork, 'Atacadão', 'com 6 unidades vale o atacado do Atacadão');
  assert.equal(six.difference, 3); // (9,50 − 9,00) × 6
  const d = cmp.body.items.find((i: any) => i.gtin === D);
  assert.equal(d.networks.tie, true);
  assert.equal(d.networks.cheapestNetwork, null);
  assert.equal(d.savings, null, 'diferença de R$ 0,00 não vira "economia"');
  assert.equal(d.networks.sides[1].offer.stale, true, 'observação antiga é sinalizada');
  assert.equal((await call('GET', '/api/catalog/items?compare=1&network=Atacad%C3%A3o')).status, 400);
});

test('imagens: só a foto ligada ao mesmo GTIN; sem foto confiável devolve null', async () => {
  const items = (await call('GET', '/api/catalog/items?q=zzteste')).body.items;
  assert.equal(items.find((i: any) => i.gtin === A).image, 'https://atacadaobr.vtexassets.com/arquivos/ids/1/teste.jpg');
  for (const gtin of [B, C, D]) assert.equal(items.find((i: any) => i.gtin === gtin).image, null);
  const stats = (await call('GET', '/api/stats/images')).body;
  assert.equal(stats.products, stats.withImage + stats.withoutImage);
  const { trustedImageUrl } = await import('../../src/integrations/offerValidation.js');
  assert.equal(trustedImageUrl('ATACADAO_SITE', 'https://atacadaobr.vtexassets.com/a.jpg'), 'https://atacadaobr.vtexassets.com/a.jpg');
  assert.equal(trustedImageUrl('ATACADAO_SITE', 'https://exemplo.com/a.jpg'), null);
  assert.equal(trustedImageUrl('ATACADAO_SITE', 'http://atacadaobr.vtexassets.com/a.jpg'), null);
  assert.equal(trustedImageUrl('MATEUS_MAIS_SITE', 'https://ik.imagekit.io/x/7891.png'), 'https://ik.imagekit.io/x/7891.png');
  assert.equal(trustedImageUrl('MATEUS_MAIS_SITE', 'não é url'), null);
  assert.equal(trustedImageUrl('CATALOGO_INICIAL', 'https://ik.imagekit.io/x/7891.png'), null);
});

test('ofertas geolocalizadas: paginação no servidor e total coerente', async () => {
  const first = await call('GET', '/api/products/search?mode=real&perPage=20');
  assert.equal(first.status, 200);
  const [count] = await pool.query<any[]>(
    `SELECT COUNT(DISTINCT o.produto_id) n FROM ofertas o JOIN estabelecimentos e ON e.id=o.estabelecimento_id
     WHERE o.disponivel=TRUE AND o.tipo_fonte IN ('ONLINE','LOJA') AND e.ativo=TRUE AND e.demonstracao=FALSE AND e.osm_id IS NOT NULL AND o.fonte_url IS NOT NULL AND o.quantidade_minima<=1`
  );
  assert.equal(first.body.total, Number(count[0].n));
  assert.equal(first.body.products.length, Math.min(20, first.body.total));
  if (first.body.total > 20) {
    const prices = first.body.products.map((p: any) => p.best.price);
    assert.deepEqual(prices, [...prices].sort((x: number, y: number) => x - y), 'ordenado pelo menor preço');
    const second = await call('GET', '/api/products/search?mode=real&perPage=20&page=2');
    const seen = new Set(first.body.products.map((p: any) => p.productId));
    assert.ok(second.body.products.every((p: any) => !seen.has(p.productId)));
  }
  assert.ok(first.body.products.every((p: any) => p.savings === null || p.savings > 0));
  assert.equal((await call('GET', '/api/products/search?mode=real&sort=xyz')).status, 400);
  assert.equal((await call('GET', '/api/products/search?mode=invalido')).status, 400);
});

// ------------------------------------------------------------------ autenticação
test('conta: criar, e-mail repetido, senha errada, sair e acesso negado', async () => {
  const address = email('ana');
  const weak = await call('POST', '/api/auth/register', { body: { name: 'Ana', email: address, password: '123' } });
  assert.equal(weak.status, 400);
  const created = await call('POST', '/api/auth/register', { body: { name: 'Ana Souza', email: address.toUpperCase(), password: 'senha-forte-123' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, address, 'e-mail normalizado');
  assert.equal(created.body.user.passwordHash, undefined);
  assert.match(String(created.headers['set-cookie']), /HttpOnly/i);
  assert.match(String(created.headers['set-cookie']), /SameSite=Lax/i);
  const [stored] = await pool.query<any[]>('SELECT senha_hash FROM usuarios WHERE email=?', [address]);
  assert.match(stored[0].senha_hash, /^\$2[aby]\$\d\d\$/, 'a senha fica só como hash bcrypt');
  const [session] = await pool.query<any[]>('SELECT token_hash FROM sessoes');
  assert.ok(!String(created.cookie).includes(session[0].token_hash), 'o banco guarda o hash do token, não o token');

  assert.equal((await call('POST', '/api/auth/register', { body: { name: 'Outra', email: address, password: 'senha-forte-123' } })).status, 409);
  assert.equal((await call('GET', '/api/auth/me', { cookie: created.cookie })).body.user.name, 'Ana Souza');
  assert.equal((await call('GET', '/api/auth/me')).body.user, null);

  const wrong = await call('POST', '/api/auth/login', { body: { email: address, password: 'senha-errada' } });
  assert.equal(wrong.status, 401);
  const unknown = await call('POST', '/api/auth/login', { body: { email: email('ninguem'), password: 'senha-errada' } });
  assert.deepEqual([unknown.status, unknown.body.error], [401, wrong.body.error], 'não revela se o e-mail existe');
  const ok = await call('POST', '/api/auth/login', { body: { email: address, password: 'senha-forte-123' } });
  assert.equal(ok.status, 200);

  assert.equal((await call('PATCH', '/api/auth/me', { cookie: ok.cookie, body: { name: 'Ana S.' } })).body.user.name, 'Ana S.');
  assert.equal((await call('POST', '/api/auth/logout', { cookie: ok.cookie })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: ok.cookie })).body.user, null, 'a sessão encerrada não vale mais');
  for (const url of ['/api/lists', '/api/checks', '/api/auth/summary']) assert.equal((await call('GET', url)).status, 401, url);
});

test('conta: proteção CSRF e limite de tentativas de login', async () => {
  const user = await newUser('csrf');
  assert.equal((await call('POST', '/api/lists', { cookie: user.cookie, body: { name: 'x' }, csrf: false })).status, 403, 'sem o cabeçalho próprio');
  assert.equal((await call('POST', '/api/lists', { cookie: user.cookie, body: { name: 'x' }, origin: 'https://site-malicioso.example' })).status, 403, 'origem não autorizada');
  assert.equal((await call('POST', '/api/lists', { cookie: user.cookie, body: { name: 'x' }, origin: 'http://localhost:5173' })).status, 201);
  const target = await newUser('limite');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/login', { body: { email: target.email, password: 'errada-' + i } })).status, 401);
  const blocked = await call('POST', '/api/auth/login', { body: { email: target.email, password: 'senha-forte-123' } });
  assert.equal(blocked.status, 429, 'depois de 5 erros nem a senha certa entra');
});

// ------------------------------------------------------------------ listas
test('listas: CRUD, persistência após novo login, importação sem duplicar e isolamento', async () => {
  const ana = await newUser('lista');
  const bia = await newUser('vizinha');
  const created = await call('POST', '/api/lists', { cookie: ana.cookie, body: { name: '  Compras do mês  ' } });
  assert.equal(created.status, 201);
  const id = created.body.list.id;
  assert.equal(created.body.list.name, 'Compras do mês');
  assert.equal((await call('POST', '/api/lists', { cookie: ana.cookie, body: { name: '' } })).status, 400);

  const item = (gtin: string, quantity: number, name = 'Produto') => ({ gtin, quantity, name, brand: 'Marca', size: '1kg' });
  let detail = await call('POST', `/api/lists/${id}/items`, { cookie: ana.cookie, body: { items: [item(A, 2, 'Zzteste Arroz 1kg'), item(B, 1, 'Zzteste Feijão 1kg')] } });
  assert.equal(detail.status, 200);
  detail = await call('POST', `/api/lists/${id}/items`, { cookie: ana.cookie, body: { items: [item(A, 3)] } });
  assert.equal(detail.body.items.find((i: any) => i.gtin === A).quantity, 5, 'adicionar de novo soma');
  // Importar a cesta do navegador: fica com a maior quantidade, sem duplicar linhas.
  detail = await call('POST', `/api/lists/${id}/items`, { cookie: ana.cookie, body: { mode: 'max', items: [item(A, 4), item(B, 6), item(C, 4, 'Zzteste Café 500g')] } });
  assert.deepEqual(detail.body.items.map((i: any) => [i.gtin, i.quantity]).sort(), [[A, 5], [B, 6], [C, 4]]);
  assert.equal((await call('POST', `/api/lists/${id}/items`, { cookie: ana.cookie, body: { items: [item('123', 1)] } })).status, 400);

  detail = await call('PATCH', `/api/lists/${id}/items/${B}`, { cookie: ana.cookie, body: { quantity: 2 } });
  assert.equal(detail.body.items.find((i: any) => i.gtin === B).quantity, 2);
  assert.equal((await call('PATCH', `/api/lists/${id}/items/${B}`, { cookie: ana.cookie, body: { quantity: 0 } })).status, 400);
  detail = await call('PATCH', `/api/lists/${id}/items/${C}`, { cookie: ana.cookie, body: { purchased: true } });
  assert.equal(detail.body.items.find((i: any) => i.gtin === C).purchased, true);
  assert.ok(!detail.body.comparison.items.some((i: any) => i.gtin === C), 'item comprado sai do cálculo');
  assert.equal((await call('PATCH', `/api/lists/${id}`, { cookie: ana.cookie, body: { name: 'Feira' } })).status, 200);

  // Outra pessoa não vê, não altera e não apaga.
  assert.deepEqual((await call('GET', '/api/lists', { cookie: bia.cookie })).body.lists, []);
  for (const [method, url, body] of [['GET', `/api/lists/${id}`], ['PATCH', `/api/lists/${id}`, { name: 'invadida' }], ['DELETE', `/api/lists/${id}`],
    ['POST', `/api/lists/${id}/items`, { items: [item(D, 1)] }], ['DELETE', `/api/lists/${id}/items/${A}`]] as [string, string, unknown?][])
    assert.equal((await call(method, url, { cookie: bia.cookie, body })).status, 404, `${method} ${url}`);

  // Sai, entra de novo: a lista continua lá.
  await call('POST', '/api/auth/logout', { cookie: ana.cookie });
  const again = await call('POST', '/api/auth/login', { body: { email: ana.email, password: 'senha-forte-123' } });
  const lists = (await call('GET', '/api/lists', { cookie: again.cookie })).body.lists;
  assert.deepEqual(lists.map((l: any) => [l.name, l.itemsCount]), [['Feira', 3], ]);
  const kept = await call('GET', `/api/lists/${id}`, { cookie: again.cookie });
  assert.deepEqual(kept.body.items.map((i: any) => i.gtin).sort(), [A, B, C]);

  assert.equal((await call('DELETE', `/api/lists/${id}/items/${B}`, { cookie: again.cookie })).status, 200);
  assert.equal((await call('DELETE', `/api/lists/${id}`, { cookie: again.cookie })).status, 200);
  assert.equal((await call('GET', `/api/lists/${id}`, { cookie: again.cookie })).status, 404);
  const [orphans] = await pool.query<any[]>('SELECT COUNT(*) n FROM lista_itens WHERE lista_id=?', [id]);
  assert.equal(Number(orphans[0].n), 0, 'os itens somem junto com a lista');
});

test('listas: total por loja, cesta incompleta e compra dividida calculados no servidor', async () => {
  const user = await newUser('cesta');
  const id = (await call('POST', '/api/lists', { cookie: user.cookie, body: { name: 'Cesta' } })).body.list.id;
  const detail = await call('POST', `/api/lists/${id}/items`, {
    cookie: user.cookie,
    body: { items: [{ gtin: A, quantity: 6, name: 'Arroz' }, { gtin: B, quantity: 1, name: 'Feijão' }] },
  });
  const cmp = detail.body.comparison;
  const atacadao = cmp.stores.find((s: any) => s.channelCode === 'ATACADAO_SAO_LUIS_24H');
  const cohama = cmp.stores.find((s: any) => s.channelCode === 'MATEUS_COHAMA_SLZ');
  assert.equal(atacadao.complete, true);
  assert.equal(atacadao.total, 61); // 6 × 9,00 (atacado) + 7,00
  assert.equal(cohama.complete, false, 'o Mateus não tem o feijão');
  assert.equal(cohama.total, null, 'cesta incompleta não recebe total');
  assert.equal(cmp.cheapestSingleStore.channelCode, 'ATACADAO_SAO_LUIS_24H', 'incompleta nunca é declarada a mais barata');
  assert.equal(cmp.split.complete, true);
  assert.equal(cmp.split.total, 61);
  assert.ok(cmp.stores.every((s: any) => s.lines.every((l: any) => l.unitPrice === null || (l.referenceDate && l.sourceUrl))), 'cada preço tem data e fonte');
  const missing = await call('POST', `/api/lists/${id}/items`, { cookie: user.cookie, body: { items: [{ gtin: '7891000000052', quantity: 1, name: 'Sem preço' }] } });
  assert.equal(missing.body.comparison.cheapestSingleStore, null);
  assert.equal(missing.body.comparison.split.total, null);
});

// ------------------------------------------------------------------ conferir caixa
const line = (shelf: unknown, checkout: unknown, quantity: unknown = 1, name = 'Produto') => ({ productName: name, shelfPrice: shelf, checkoutPrice: checkout, quantity });
const check = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  submissionKey: randomUUID(), network: 'Atacadão', unit: 'Atacadão São Luís 24hrs', channelCode: 'ATACADAO_SAO_LUIS_24H',
  purchaseDate: '2026-11-10', items, ...extra,
});

test('conferir caixa: preço maior, menor e igual, vários itens e quantidades', async () => {
  const r = (await call('POST', '/api/checks/preview', { body: { items: [line('22,90', '27,90', 2), line(10, 8.5, 3), line('5.00', '5,00', 4), line(0, 1)] } })).body;
  assert.deepEqual(r.lines.map((l: any) => l.status), ['CAIXA_MAIOR', 'CAIXA_MENOR', 'IGUAL', 'CAIXA_MAIOR']);
  assert.deepEqual(r.lines.map((l: any) => l.unitDifference), [5, -1.5, 0, 1]);
  assert.deepEqual(r.lines.map((l: any) => l.totalDifference), [10, -4.5, 0, 1]);
  assert.deepEqual(r.lines.map((l: any) => l.percentDifference), [21.8, -15, 0, null]);
  assert.deepEqual([r.items, r.divergentItems, r.overchargedItems, r.underchargedItems], [4, 3, 2, 1]);
  assert.deepEqual([r.shelfTotal, r.checkoutTotal, r.totalDifference, r.status], [95.8, 102.3, 6.5, 'CAIXA_MAIOR']);
  // 0,10 + 0,20 em ponto flutuante daria 0,30000000000000004: aqui é exato.
  const precise = (await call('POST', '/api/checks/preview', { body: { items: [line('0,10', '0,30', 3), line('0,20', '0,20', 1)] } })).body;
  assert.deepEqual([precise.shelfTotal, precise.checkoutTotal, precise.totalDifference], [0.5, 1.1, 0.6]);
});

test('conferir caixa: valores inválidos são recusados com mensagem', async () => {
  for (const items of [[], [line('abc', 1)], [line(-1, 1)], [line(1, '1,999')], [line(1, 1, 0)], [line(1, 1, 1.5)], [line(1, 1, 1, '')], [{ ...line(1, 1), gtin: '12' }]])
    assert.equal((await call('POST', '/api/checks/preview', { body: { items } })).status, 400, JSON.stringify(items));
  assert.equal((await call('POST', '/api/checks', { body: check([line(1, 2)], { purchaseDate: '2999-01-01' }) })).status, 400);
  assert.equal((await call('POST', '/api/checks', { body: check([line(1, 2)], { submissionKey: 'x' }) })).status, 400);
  assert.equal((await call('POST', '/api/checks', { body: check([line(1, 2)], { network: '' }) })).status, 400);
});

test('conferir caixa: salvar, não duplicar, histórico pessoal e isolamento', async () => {
  const ana = await newUser('caixa');
  const bia = await newUser('caixa2');
  const body = check([line('22,90', '27,90', 2, 'Arroz Camil 5kg'), line('4,79', '4,79', 1, 'Leite')]);
  const saved = await call('POST', '/api/checks', { cookie: ana.cookie, body });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.savedToHistory, true);
  assert.equal(saved.body.result.totalDifference, 10);
  const again = await call('POST', '/api/checks', { cookie: ana.cookie, body });
  assert.deepEqual([again.status, again.body.id, again.body.duplicate], [200, saved.body.id, true], 'reenvio não grava de novo');
  const [rows] = await pool.query<any[]>('SELECT COUNT(*) n FROM conferencias WHERE chave_envio=?', [body.submissionKey]);
  assert.equal(Number(rows[0].n), 1);
  assert.equal((await call('POST', '/api/checks', { cookie: bia.cookie, body })).status, 403, 'outra pessoa não reaproveita o envio');
  // Duplo clique de verdade: cinco envios simultâneos da mesma conferência → um registro, nenhum erro.
  const burst = check([line(2, 3)]);
  const answers = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/api/checks', { cookie: bia.cookie, body: burst })));
  assert.ok(answers.every((a) => a.status === 200 || a.status === 201), JSON.stringify(answers.map((a) => [a.status, a.body.error])));
  assert.equal(new Set(answers.map((a) => a.body.id)).size, 1);
  const [burstRows] = await pool.query<any[]>('SELECT COUNT(*) n FROM conferencias WHERE chave_envio=?', [burst.submissionKey]);
  assert.equal(Number(burstRows[0].n), 1);
  await call('DELETE', `/api/checks/${answers[0].body.id}`, { cookie: bia.cookie });

  const history = await call('GET', '/api/checks', { cookie: ana.cookie });
  assert.equal(history.body.total, 1);
  assert.deepEqual([history.body.checks[0].items, history.body.checks[0].divergentItems, history.body.checks[0].totalDifference], [2, 1, 10]);
  assert.equal(history.body.stats.overcharged, 10);
  const detail = await call('GET', `/api/checks/${saved.body.id}`, { cookie: ana.cookie });
  assert.equal(detail.body.result.lines[0].productName, 'Arroz Camil 5kg');
  assert.equal(detail.body.check.purchaseDate, '2026-11-10');

  assert.equal((await call('GET', '/api/checks', { cookie: bia.cookie })).body.total, 0);
  assert.equal((await call('GET', `/api/checks/${saved.body.id}`, { cookie: bia.cookie })).status, 404);
  assert.equal((await call('DELETE', `/api/checks/${saved.body.id}`, { cookie: bia.cookie })).status, 404);

  // Sem login: grava sem dono e não aparece no histórico de ninguém.
  const anonymous = await call('POST', '/api/checks', { body: check([line(3, 3)]) });
  assert.deepEqual([anonymous.status, anonymous.body.savedToHistory], [201, false]);
  assert.equal((await call('GET', `/api/checks/${anonymous.body.id}`, { cookie: ana.cookie })).status, 404);
  assert.equal((await call('GET', '/api/checks', { cookie: ana.cookie })).body.total, 1);
});

test('conferir caixa: anexos privados — formato, tamanho, dono e remoção', async () => {
  const ana = await newUser('anexo');
  const bia = await newUser('anexo2');
  const id = (await call('POST', '/api/checks', { cookie: ana.cookie, body: check([line(1, 2)]) })).body.id;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const upload = async (cookie: string | null, bytes: Buffer, kind = 'COMPROVANTE', filename = 'nota.png') => {
    const boundary = '----precoclaro' + Date.now();
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({
      method: 'POST', url: `/api/checks/${id}/attachments`, payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-requested-with': 'PrecoClaro', ...(cookie ? { cookie } : {}) },
    });
    return { status: response.statusCode, body: response.json() };
  };
  assert.equal((await upload(null, png)).status, 401);
  assert.equal((await upload(bia.cookie, png)).status, 404, 'só o dono anexa');
  assert.equal((await upload(ana.cookie, Buffer.from('<script>alert(1)</script>'), 'COMPROVANTE', 'falso.png')).status, 400, 'o conteúdo precisa ser imagem de verdade');
  assert.equal((await upload(ana.cookie, png, 'OUTRO')).status, 400);
  assert.ok([400, 413].includes((await upload(ana.cookie, Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024 + 10)]))).status), 'acima de 4 MB');
  const ok = await upload(ana.cookie, png, 'ETIQUETA');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.mime, 'image/png');
  assert.equal(readdirSync(join(uploads, 'conferencias')).length, 1);

  const url = `/api/checks/${id}/attachments/${ok.body.id}`;
  assert.equal((await call('GET', url)).status, 401, 'sem login não baixa');
  assert.equal((await call('GET', url, { cookie: bia.cookie })).status, 404, 'outra pessoa não baixa');
  const file = await app.inject({ method: 'GET', url, headers: { cookie: ana.cookie } });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.match(String(file.headers['cache-control']), /private/);
  assert.ok(file.rawPayload.equals(png));
  assert.equal((await call('GET', `/api/checks/${id}`, { cookie: ana.cookie })).body.attachments.length, 1);
  assert.equal((await call('DELETE', url, { cookie: ana.cookie })).status, 200);
  assert.equal(readdirSync(join(uploads, 'conferencias')).length, 0, 'o arquivo sai do disco');
});

test('contratos antigos preservados e erros sem detalhes internos', async () => {
  assert.equal((await call('GET', '/api/health')).body.status, 'ok');
  assert.equal((await call('GET', '/api/health/live')).body.status, 'ok');
  const basket = await call('POST', '/api/catalog/basket/compare', { body: { items: [{ gtin: A, quantity: 1 }] }, csrf: false });
  assert.equal(basket.status, 200, 'a comparação de cesta de visitante continua sem login e sem cabeçalho extra');
  assert.equal(basket.body.cheapestSingleStore.total, 9.5);
  assert.equal((await call('GET', `/api/catalog/compare?gtin=${A}&quantity=1`)).body.cheapest.price, 9.5);
  assert.equal((await call('GET', '/api/catalog/compare?gtin=123')).status, 400);
  assert.equal((await call('GET', '/api/market/prices?ean=123')).status, 400);
  assert.equal((await call('GET', '/api/stores/nearby')).status, 400);
  assert.equal((await call('GET', '/api/products/999999999')).status, 404);
  assert.equal((await call('GET', '/api/rota-que-nao-existe')).status, 404);
  assert.ok((await call('GET', '/api/catalog/prices?q=zzteste')).body.offers.length >= 4);
  assert.ok((await call('GET', '/api/catalog/channels')).body.channels.some((c: any) => c.channelCode === 'ATACADAO_SAO_LUIS_24H'));
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: '{invalido', headers: { 'content-type': 'application/json', 'x-requested-with': 'PrecoClaro' } });
  assert.equal(bad.statusCode, 400);
  assert.ok(!/stack|at \w+ \(|SQL/i.test(bad.payload));
});
