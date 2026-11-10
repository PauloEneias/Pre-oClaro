/**
 * TESTE DE INTEGRAÇÃO — precisa de internet e do MySQL do .env.
 * Uso: npm run test:integration
 *
 * Roda num banco SEPARADO (precoclaro_itest), criado pelas migrações do projeto;
 * o banco "precoclaro" só é LIDO (para copiar as lojas reais já cadastradas).
 * Faz ~15 requisições ao site do Atacadão, com pausa entre elas.
 * O Mateus Mais não é consultado (Termos de Uso).
 */
import 'dotenv/config';
import { before, after, test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Pool, RowDataPacket } from 'mysql2/promise';

const SOURCE_DB = process.env.DB_NAME || 'precoclaro';
const TEST_DB = 'precoclaro_itest';
process.env.DB_NAME = TEST_DB;
process.env.MARKET_REQUEST_DELAY_MS = '1200';
process.env.MATEUS_SYNC_ENABLED = 'false';
process.env.ATACADAO_SYNC_ENABLED = 'true';
process.env.LIVE_SCRAPE_ENABLED = 'true';

const { migrate } = await import('../../scripts/migrate.js');
const sync = await import('../../src/integrations/marketSync.js');
const { PoliteClient } = await import('../../src/integrations/politeHttp.js');
const { buildEanLookupUrl, parseEanLookup, ATACADAO_ORIGIN, parseAtacadaoStorePage } = await import('../../src/integrations/atacadao.js');
const { pool } = (await import('../../src/db.js')) as { pool: Pool };

const lines: string[] = [];
const log = { info: (...a: unknown[]) => lines.push(a.join(' ')), warn: (...a: unknown[]) => lines.push('AVISO ' + a.join(' ')) };
const one = async (sql: string, args: unknown[] = []) => ((await pool.query<RowDataPacket[]>(sql, args))[0][0] ?? {}) as Record<string, unknown>;
const snapshot = async () => ({
  obs: await one('SELECT COUNT(*) n, MAX(confirmado_em) m, MAX(coletado_em) c FROM observacoes_preco'),
  cat: await one("SELECT COUNT(*) n, DATE_FORMAT(MAX(referencia_em),'%Y-%m-%d') m FROM catalogo_ofertas_documentadas"),
  offers: await one('SELECT COUNT(*) n, MAX(consultado_em) m, COALESCE(SUM(preco),0) s FROM ofertas'),
  online: await one('SELECT COUNT(*) n, MAX(observado_em) m, COALESCE(SUM(preco),0) s FROM precos_online'),
  history: await one('SELECT (SELECT COUNT(*) FROM historico_precos) a, (SELECT COUNT(*) FROM historico_precos_online) b'),
});
let firstRun: Awaited<ReturnType<typeof sync.runMarketCollection>>[number];

before(async () => {
  await migrate(TEST_DB, undefined, () => undefined);
  for (const table of ['historico_precos', 'ofertas', 'produtos', 'observacoes_preco', 'coleta_execucoes',
    'mercado_sku_gtin', 'precos_online', 'historico_precos_online', 'catalogo_ofertas_documentadas', 'estabelecimentos'])
    await pool.query(`DELETE FROM \`${table}\``); // só no banco de TESTE
  try {
    await pool.query(
      `INSERT INTO estabelecimentos(nome,bairro,cidade,uf,latitude,longitude,demonstracao,ativo,osm_id,endereco,fonte_localizacao)
       SELECT nome,bairro,cidade,uf,latitude,longitude,demonstracao,ativo,osm_id,endereco,fonte_localizacao
       FROM \`${SOURCE_DB}\`.estabelecimentos WHERE demonstracao=FALSE AND osm_id REGEXP '^(node|way|relation)/[0-9]+$'`
    );
  } catch { /* sem banco de origem: a loja é buscada no OpenStreetMap */ }
});
after(async () => {
  console.log('\n--- log da coleta ---\n' + lines.join('\n'));
  await pool.end();
});

test('1. Node obtém resposta real do Atacadão e a paginação importa centenas de produtos', async () => {
  const runs = await sync.runMarketCollection({ log, force: true, maxPages: 3, sources: ['ATACADAO_SITE'] });
  assert.equal(runs.length, 1);
  firstRun = runs[0];
  console.log('execução 1:', JSON.stringify(firstRun));
  assert.notEqual(firstRun.status, 'FALHA', firstRun.message);
  assert.match(firstRun.message, /3 páginas/);
  assert.ok(firstRun.found >= 250, `esperava ≥250 produtos em 3 páginas, vieram ${firstRun.found}`);
  assert.ok(firstRun.created >= 150, `esperava ≥150 ofertas novas, vieram ${firstRun.created}`);
  const distinct = await one('SELECT COUNT(DISTINCT gtin) n, COUNT(*) total, SUM(quantidade_minima>1) atacado FROM observacoes_preco');
  console.log('gravado:', JSON.stringify(distinct));
  assert.ok(Number(distinct.n) >= 150);
  assert.ok(Number(distinct.atacado) > 0, 'deveria haver faixas de atacado');
});

test('2. os dados são da unidade de São Luís/MA, não de outra cidade', async () => {
  assert.match(firstRun.message, /\(São Luís\/MA, vendedor atacadaobr747\)/);
  const html = await new PoliteClient({ minDelayMs: 1200 }).getText(`${ATACADAO_ORIGIN}/loja/sao-luis`);
  const store = parseAtacadaoStorePage(html, 'sao-luis');
  assert.equal(store.city, 'São Luís');
  assert.equal(store.state, 'MA');
  const stores = await one(
    `SELECT COUNT(DISTINCT loja_codigo_externo) lojas, MIN(loja_codigo_externo) loja, MIN(canal_codigo) canal,
            SUM(fonte<>'ATACADAO_SITE') outras_fontes FROM observacoes_preco`
  );
  assert.deepEqual([Number(stores.lojas), stores.loja, stores.canal, Number(stores.outras_fontes)], [1, 'ATACADAO:747', 'ATACADAO_SAO_LUIS_24H', 0]);
  const cat = await one("SELECT SUM(cidade<>'São Luís' OR uf<>'MA') fora FROM catalogo_ofertas_documentadas");
  assert.equal(Number(cat.fora), 0);
});

test('3. o preço gravado pertence ao produto certo (conferido por um segundo endpoint)', async () => {
  const [sample] = await pool.query<RowDataPacket[]>(
    `SELECT s.sku, s.gtin, o.produto_nome, o.preco FROM mercado_sku_gtin s
     JOIN observacoes_preco o ON o.gtin=s.gtin AND o.quantidade_minima=1
     WHERE s.gtin IS NOT NULL ORDER BY RAND() LIMIT 5`
  );
  assert.equal(sample.length, 5);
  const fresh = parseEanLookup(await new PoliteClient({ minDelayMs: 1200 }).getJson(buildEanLookupUrl(sample.map((r) => String(r.sku)))));
  const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const row of sample) {
    const info = fresh.get(String(row.sku));
    console.log(`  SKU ${row.sku} | EAN ${row.gtin} | ${row.produto_nome} | R$ ${row.preco} | catálogo: ${info?.name}`);
    assert.equal(info?.ean, row.gtin, 'o EAN gravado tem de ser o do catálogo oficial');
    const stored = plain(String(row.produto_nome)).split(' ');
    const official = plain(info!.name);
    assert.ok(stored.filter((w) => official.includes(w)).length >= Math.ceil(stored.length * 0.6), `nomes divergentes: ${row.produto_nome} × ${info!.name}`);
  }
});

test('4. repetir a coleta não duplica nada: só confirma os preços', async () => {
  const beforeRun = await snapshot();
  const [run] = await sync.runMarketCollection({ log, force: true, maxPages: 3, sources: ['ATACADAO_SITE'] });
  console.log('execução 2:', JSON.stringify(run));
  assert.notEqual(run.status, 'FALHA', run.message);
  assert.ok(run.confirmed >= firstRun.created * 0.9, 'quase tudo deveria ser apenas confirmado');
  assert.ok(run.created + run.changed <= firstRun.created * 0.1, 'não deveria haver enxurrada de preços "novos"');
  const afterRun = await snapshot();
  assert.ok(Number(afterRun.obs.n) - Number(beforeRun.obs.n) <= firstRun.created * 0.1);
  assert.ok(new Date(String(afterRun.obs.m)) > new Date(String(beforeRun.obs.m)), 'a data de confirmação precisa avançar');
  const dup = await one(
    `SELECT COUNT(*) n FROM (SELECT gtin,canal_codigo,quantidade_minima,referencia_em FROM catalogo_ofertas_documentadas
     GROUP BY 1,2,3,4 HAVING COUNT(*)>1) d`
  );
  assert.equal(Number(dup.n), 0);
});

test('5. preço antigo (catálogo inicial ou CSV antigo) não substitui o preço novo', async () => {
  const target = await one(
    `SELECT o.gtin, o.produto_nome, o.preco, o.canal_codigo, o.canal_nome FROM observacoes_preco o
     WHERE o.quantidade_minima=1 ORDER BY o.id LIMIT 1`
  );
  const beforeOld = await snapshot();
  const result = await sync.persistEntriesToMySQL([{
    gtin: String(target.gtin), productName: String(target.produto_nome), brand: 'Marca', size: '1 un', network: 'Atacadão',
    channelCode: String(target.canal_codigo), channelName: String(target.canal_nome), city: 'São Luís', state: 'MA',
    price: 0.99, minimumQuantity: 1, sourceUrl: 'https://www.atacadao.com.br/loja/sao-luis',
    referenceDate: '2026-11-01', referenceType: 'CONSULTA_INDEXADA', notice: 'Preço antigo de teste',
  }], log);
  assert.deepEqual(result, { catalogSaved: 0, onlineSaved: 0, realOffersSaved: 0 });
  const seedCreated = await sync.ensureSeedFallback(log);
  const afterOld = await snapshot();
  console.log(`  referências do catálogo inicial que entraram (produtos/unidades ainda sem coleta): ${seedCreated}`);
  // O que já tinha coleta nova continua idêntico:
  const current = await one(
    'SELECT preco FROM observacoes_preco WHERE gtin=? AND canal_codigo=? AND quantidade_minima=1 ORDER BY coletado_em DESC LIMIT 1',
    [target.gtin, target.canal_codigo]
  );
  assert.equal(Number(current.preco), Number(target.preco));
  assert.deepEqual(afterOld.offers, beforeOld.offers);
  assert.deepEqual(afterOld.online, beforeOld.online);
  assert.equal(String(afterOld.obs.m), String(beforeOld.obs.m));
  const stale = await one('SELECT COUNT(*) n FROM observacoes_preco WHERE preco=0.99');
  assert.equal(Number(stale.n), 0);
  // As linhas do catálogo inicial guardam a data ORIGINAL, não a de hoje:
  const seed = await one(
    `SELECT COUNT(*) n, DATE_FORMAT(MIN(coletado_em),'%Y-%m-%d') d1, DATE_FORMAT(MAX(coletado_em),'%Y-%m-%d') d2
     FROM observacoes_preco WHERE fonte='CATALOGO_INICIAL'`
  );
  if (Number(seed.n) > 0) assert.deepEqual([seed.d1, seed.d2], ['2026-11-09', '2026-11-09']);
  const arroz = await one(
    `SELECT fonte, preco FROM observacoes_preco WHERE gtin='7896006711155' AND canal_codigo='ATACADAO_SAO_LUIS_24H'
       AND quantidade_minima=1 ORDER BY coletado_em DESC LIMIT 1`
  );
  if (arroz.fonte) console.log('  Arroz Camil 5kg no Atacadão, observação mais recente:', JSON.stringify(arroz));
});

test('6. queda de rede não grava nada nem "atualiza" datas', async () => {
  const beforeFail = await snapshot();
  const offline = new PoliteClient({ minDelayMs: 0, retries: 0, fetchImpl: async () => { throw new TypeError('fetch failed (simulação: sem internet)'); } });
  const [run] = await sync.runMarketCollection({ log, force: true, sources: ['ATACADAO_SITE'], client: offline });
  console.log('execução sem rede:', JSON.stringify(run));
  assert.equal(run.status, 'FALHA');
  assert.equal(run.created + run.changed + run.confirmed, 0);
  assert.deepEqual(await snapshot(), beforeFail);
  const logged = await one("SELECT status, mensagem FROM coleta_execucoes ORDER BY id DESC LIMIT 1");
  assert.equal(logged.status, 'FALHA');
  assert.match(String(logged.mensagem), /Falha de rede/);
});

test('7. mudança de preço gera um ponto novo no histórico; preço igual só confirma', async () => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.*, c.marca, c.embalagem FROM observacoes_preco o
     JOIN catalogo_ofertas_documentadas c ON c.gtin=o.gtin AND c.canal_codigo=o.canal_codigo AND c.quantidade_minima=1
     WHERE o.quantidade_minima=1 AND o.fonte='ATACADAO_SITE' ORDER BY o.id LIMIT 1`
  );
  const base = rows[0];
  const storeId = await one("SELECT id FROM estabelecimentos WHERE codigo_externo='ATACADAO:747'");
  const item = (price: number, collectedAt: string) => ({
    gtin: String(base.gtin), productName: String(base.produto_nome), brand: String(base.marca), size: String(base.embalagem),
    network: 'Atacadão' as const, channelCode: String(base.canal_codigo), channelName: String(base.canal_nome),
    storeExternalId: 'ATACADAO:747', city: 'São Luís', state: 'MA', price, listPrice: null, minimumQuantity: 1,
    sourceUrl: String(base.fonte_url), source: 'ATACADAO_SITE' as const, collectedAt, externalSku: '',
    notice: 'Teste de mudança de preço', referenceType: 'COLETA_AUTOMATICA' as const,
  });
  const stores = new Map([['ATACADAO:747', storeId.id ? Number(storeId.id) : null]]);
  const newPrice = Math.round((Number(base.preco) + 1) * 100) / 100;
  const t1 = new Date(Date.now() - 2000).toISOString();
  const t2 = new Date(Date.now() - 1000).toISOString();
  const h0 = await snapshot();
  const changed = await sync.persistCollectedOffers([item(newPrice, t1)], { stores });
  assert.equal(changed.changed, 1);
  const h1 = await snapshot();
  assert.equal(Number(h1.obs.n), Number(h0.obs.n) + 1);
  assert.equal(Number(h1.history.b), Number(h0.history.b) + 1, 'histórico online ganha um ponto');
  if (storeId.id) assert.equal(Number(h1.history.a), Number(h0.history.a) + 1, 'histórico da oferta geolocalizada ganha um ponto');
  const same = await sync.persistCollectedOffers([item(newPrice, t2)], { stores });
  assert.equal(same.confirmed, 1);
  const h2 = await snapshot();
  assert.equal(Number(h2.obs.n), Number(h1.obs.n));
  assert.deepEqual(h2.history, h1.history);
  // Reenviar a observação antiga (preço original) não desfaz a nova:
  const back = await sync.persistCollectedOffers([item(Number(base.preco), t1)], { stores });
  assert.equal(back.staleIgnored, 1);
  const [timeline] = await pool.query<RowDataPacket[]>(
    'SELECT preco, fonte, coletado_em, confirmado_em, fonte_url, loja_codigo_externo, quantidade_minima FROM observacoes_preco WHERE gtin=? AND canal_codigo=? AND quantidade_minima=1 ORDER BY coletado_em',
    [base.gtin, base.canal_codigo]
  );
  console.log('  linha do tempo:', JSON.stringify(timeline));
  const live = timeline.filter((r) => r.fonte === 'ATACADAO_SITE');
  assert.deepEqual(live.map((r) => Number(r.preco)), [Number(base.preco), newPrice]);
  assert.ok(live.every((r) => r.fonte_url && r.loja_codigo_externo === 'ATACADAO:747' && r.coletado_em && Number(r.quantidade_minima) === 1));
});

test('8. ofertas geolocalizadas só existem em loja com osm_id verdadeiro', async () => {
  const fake = await one("SELECT COUNT(*) n FROM estabelecimentos WHERE osm_id IS NOT NULL AND osm_id NOT REGEXP '^(node|way|relation)/[0-9]+$'");
  assert.equal(Number(fake.n), 0);
  const linked = await one("SELECT e.id, e.nome, e.osm_id, (SELECT COUNT(*) FROM ofertas o WHERE o.estabelecimento_id=e.id) ofertas FROM estabelecimentos e WHERE codigo_externo='ATACADAO:747'");
  console.log('  loja ligada:', JSON.stringify(linked));
  const orphan = await one("SELECT COUNT(*) n FROM ofertas o JOIN estabelecimentos e ON e.id=o.estabelecimento_id WHERE o.tipo_fonte='ONLINE' AND (e.osm_id IS NULL OR e.demonstracao=TRUE)");
  assert.equal(Number(orphan.n), 0);
  if (linked.id) assert.ok(Number(linked.ofertas) >= 150);
});
