import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { RowDataPacket } from 'mysql2';
import { pool } from './db.js';
import { parseLocationFilter, type LocationFilter } from './location.js';
import { fetchRealStores } from './osm.js';
import { parsePriceMode, parseQuantity, parseProductId, groupByExactProduct } from './comparison.js';
import { startMarketScheduler } from './integrations/marketSync.js';
import { gtinValid } from './csv.js';
import {compareCatalogItem,compareBasket,compareNetworks,validateBasket,productNameSuggestion,type CatalogRow} from './catalogComparison.js';

// Evita registrar a posição do consumidor nos logs da API.
const app = Fastify({ logger: { serializers: { req: (req) => ({ method: req.method, path: req.url?.split('?')[0] }) } } });
await app.register(cors, { origin: ['http://localhost:5173','http://127.0.0.1:5173'] });

type Filters = Record<string,string|undefined>;
type DBStore = RowDataPacket & {
  id:number;name:string;neighborhood:string;city:string;state:string;
  address:string|null; osmId:string|null; updatedAt:Date;
  latitude:number;longitude:number;isDemo:number;distanceKm:number|null;
};
type DBOffer = RowDataPacket & {
  id:number;productId:number;name:string;brand:string;size:string;image:string|null;
  storeId:number;storeName:string;neighborhood:string;
  price:number;sourceType:string;sourceUrl:string|null;offerConditions:string|null;observedAt:Date;minimumQuantity:number;distanceKm:number|null;
};
function getLocationOrReply(query:Filters){
  try{return {location:parseLocationFilter(query)};}
  catch(err){return {error:(err as Error).message};}
}
function parts(location:LocationFilter|null,table='e'){
  const field=`ST_Distance_Sphere(POINT(${table}.longitude, ${table}.latitude), POINT(?, ?)) / 1000`;
  return location?{sql:field,args:[location.lon,location.lat]}:{sql:'NULL',args:[]};
}

app.get('/api/health',async(_request,reply)=>{
  try{await pool.query('SELECT 1');return {status:'ok',database:'connected',osm:'external service on demand',prices:'demo_and_documented_import_supported'};}
  catch{return reply.code(503).send({status:'unavailable',database:'disconnected',message:'Confira o MySQL, o arquivo .env e os scripts SQL.'});}
});

// Não consulta locais fictícios: ao receber GPS, busca mercados mapeados de verdade no OSM,
// sincroniza o cadastro público no MySQL e calcula distâncias na base de dados.
app.get<{Querystring:Filters}>('/api/stores/nearby',async(request,reply)=>{
  const parsed=getLocationOrReply(request.query);
  if(parsed.error)return reply.code(400).send({error:parsed.error});
  const location=parsed.location;
  if(!location)return reply.code(400).send({error:'Autorize sua localização ou selecione um bairro para buscar mercados reais.'});
  const {sql,args}=parts(location);
  let sourceStatus:'updated'|'mysql_cache'='updated';
  let sourceWarning:string|null=null;
  let fetched=0;
  try{
    const found=await fetchRealStores(location.lat,location.lon,location.radiusKm);
    fetched=found.length;
    if(found.length){
      // Nome, coordenadas e endereço das lojas são públicos. Nunca gravamos o GPS do usuário.
      const connection=await pool.getConnection();
      try{
        await connection.beginTransaction();
        for(const s of found){
          await connection.execute(`
            INSERT INTO estabelecimentos
              (nome,bairro,cidade,uf,latitude,longitude,demonstracao,ativo,osm_id,endereco,fonte_localizacao,atualizado_em)
            VALUES(?,?,?,?,?,?,FALSE,TRUE,?,?,'OpenStreetMap',NOW())
            ON DUPLICATE KEY UPDATE
              nome=VALUES(nome),bairro=VALUES(bairro),cidade=VALUES(cidade),uf=VALUES(uf),
              latitude=VALUES(latitude),longitude=VALUES(longitude),endereco=VALUES(endereco),
              fonte_localizacao='OpenStreetMap',demonstracao=FALSE,ativo=TRUE,atualizado_em=NOW()
          `,[s.name,s.neighborhood,s.city,s.state,s.latitude,s.longitude,s.osmId,s.address]);
        }
        await connection.commit();
      }catch(err){await connection.rollback();throw err;}
      finally{connection.release();}
    }
  }catch(err){
    app.log.warn({error:(err as Error).message},'Consulta OSM indisponível; tentando dados previamente importados');
    sourceStatus='mysql_cache';
    sourceWarning='A consulta ao OpenStreetMap falhou. Exibindo somente lojas públicas importadas anteriormente, se houver.';
  }
  // Usamos os parâmetros de posição EXCLUSIVAMENTE nesta consulta, sem persistir histórico.
  const [rows]=await pool.execute<DBStore[]>(`
    SELECT e.id,e.nome AS name,e.bairro AS neighborhood,e.cidade AS city,e.uf AS state,
      e.endereco AS address,e.osm_id AS osmId,e.atualizado_em AS updatedAt,
      e.latitude,e.longitude,e.demonstracao AS isDemo,${sql} AS distanceKm
    FROM estabelecimentos e
    WHERE e.ativo=TRUE AND e.osm_id IS NOT NULL AND e.demonstracao=FALSE
    HAVING distanceKm <= ?
    ORDER BY distanceKm ASC
    LIMIT 100
  `,[...args,location.radiusKm]);
  if(sourceStatus==='mysql_cache' && rows.length===0){
    return reply.code(503).send({error:'Não foi possível consultar os mercados reais no OpenStreetMap agora. Verifique sua internet e tente novamente. Nenhum mercado fictício foi exibido.'});
  }
  return {
    isDemo:false,
    source:'OpenStreetMap',
    sourceStatus,
    sourceWarning,
    fetched,
    measurement:'straight_line_km',radiusKm:location.radiusKm,
    attribution:'© OpenStreetMap contributors · ODbL',
    stores:rows.map(row=>({...row,isDemo:false,distanceKm:row.distanceKm===null?null:Number(row.distanceKm)}))
  };
});

// Separação estrita: modo demo só apresenta registros fictícios; modo real só
// apresenta registros ONLINE/LOJA importados com identificação da fonte.
// A comparação usa ID do produto (ligado ao GTIN na importação): nunca mistura embalagens.
function filterMode(mode:'demo'|'real'){
  return mode==='demo'?"o.tipo_fonte = 'DEMO'":"o.tipo_fonte IN ('ONLINE','LOJA') AND e.demonstracao = FALSE AND e.osm_id IS NOT NULL AND o.fonte_url IS NOT NULL";
}
function filtersOrError(query:Filters){
  const parsed=getLocationOrReply(query);
  if(parsed.error)throw new Error(parsed.error);
  return {location:parsed.location??null,mode:parsePriceMode(query.mode),quantity:parseQuantity(query.quantity)};
}
function asOffer(r:DBOffer){return {
  id:r.id,productId:r.productId,storeId:r.storeId,
  product:{id:r.productId,name:r.name,brand:r.brand,size:r.size,image:r.image},
  store:{id:r.storeId,name:r.storeName,neighborhood:r.neighborhood},
  price:Number(r.price),sourceType:r.sourceType,sourceUrl:r.sourceUrl??null,
  offerConditions:r.offerConditions??null,observedAt:r.observedAt,
  minimumQuantity:r.minimumQuantity,distanceKm:r.distanceKm===null?null:Number(r.distanceKm)
};}
const offerSelect=`SELECT o.id,p.id AS productId,p.nome AS name,p.marca AS brand,
  p.embalagem AS size,p.imagem AS image,e.id AS storeId,
  e.nome AS storeName,e.bairro AS neighborhood,o.preco AS price,
  o.tipo_fonte AS sourceType,o.fonte_url AS sourceUrl,o.condicao_oferta AS offerConditions,
  o.consultado_em AS observedAt,o.quantidade_minima AS minimumQuantity`;

app.get<{Querystring:Filters}>('/api/products/search',async(request,reply)=>{
  let f:ReturnType<typeof filtersOrError>;
  try { f=filtersOrError(request.query); }
  catch(err){return reply.code(400).send({error:(err as Error).message});}
  const q=String(request.query.q??'').trim();
  if(q.length>80)return reply.code(400).send({error:'Busca muito longa (máximo 80 caracteres).'});
  const geo=parts(f.location);
  const geoWhere=f.location?'AND ST_Distance_Sphere(POINT(e.longitude,e.latitude),POINT(?,?))/1000<=?':'';
  const [rows]=await pool.execute<DBOffer[]>(`${offerSelect},${geo.sql} AS distanceKm
    FROM ofertas o JOIN produtos p ON p.id=o.produto_id
    JOIN estabelecimentos e ON e.id=o.estabelecimento_id
    WHERE e.ativo=TRUE AND o.disponivel=TRUE AND ${filterMode(f.mode)}
      AND o.quantidade_minima <= ?
      AND (INSTR(LOWER(p.nome),LOWER(?))>0 OR INSTR(LOWER(p.marca),LOWER(?))>0
           OR (p.gtin IS NOT NULL AND p.gtin = ?))
      ${geoWhere}
    ORDER BY o.preco ASC, p.id ASC LIMIT 300`,[
    ...geo.args,f.quantity,q,q,q,
    ...(f.location?[f.location.lon,f.location.lat,f.location.radiusKm]:[])
  ]);
  const offers=rows.map(asOffer);
  return {mode:f.mode,isDemo:f.mode==='demo',query:q,quantity:f.quantity,
    count:offers.length,products:groupByExactProduct(offers),offers};
});

type DBProduct=RowDataPacket & {id:number;name:string;brand:string;size:string;gtin:string|null;image:string|null};
type DBHistory=RowDataPacket & {id:number;price:number;observedAt:Date;sourceType:string;storeName:string;minimumQuantity:number};
app.get<{Params:{id:string};Querystring:Filters}>('/api/products/:id',async(request,reply)=>{
  let f:ReturnType<typeof filtersOrError>;let productId:number;
  try{f=filtersOrError(request.query);productId=parseProductId(request.params.id);}
  catch(err){return reply.code(400).send({error:(err as Error).message});}
  const [products]=await pool.execute<DBProduct[]>(
    'SELECT id,nome AS name,marca AS brand,embalagem AS size,gtin,imagem AS image FROM produtos WHERE id=?',[productId]);
  const product=products[0];
  if(!product)return reply.code(404).send({error:'Produto não encontrado.'});
  const geo=parts(f.location);
  const geoWhere=f.location?'AND ST_Distance_Sphere(POINT(e.longitude,e.latitude),POINT(?,?))/1000<=?':'';
  const [rows]=await pool.execute<DBOffer[]>(`${offerSelect},${geo.sql} AS distanceKm
    FROM ofertas o JOIN produtos p ON p.id=o.produto_id
    JOIN estabelecimentos e ON e.id=o.estabelecimento_id
    WHERE p.id=? AND e.ativo=TRUE AND o.disponivel=TRUE
      AND ${filterMode(f.mode)} AND o.quantidade_minima<=? ${geoWhere}
    ORDER BY o.preco ASC,e.nome ASC LIMIT 100`,[
      ...geo.args,productId,f.quantity,
      ...(f.location?[f.location.lon,f.location.lat,f.location.radiusKm]:[])
    ]);
  // Histórico é baseado nas observações importadas e nunca é inventado.
  // Exige o mesmo modo, produto e lojas na região solicitada.
  const historyWhere=f.location?'AND ST_Distance_Sphere(POINT(e.longitude,e.latitude),POINT(?,?))/1000<=?':'';
  const [history]=await pool.execute<DBHistory[]>(`
    SELECT h.id,h.preco AS price,h.observado_em AS observedAt,
      h.tipo_fonte AS sourceType,h.quantidade_minima AS minimumQuantity,e.nome AS storeName
    FROM historico_precos h JOIN ofertas o ON o.id=h.oferta_id
    JOIN estabelecimentos e ON e.id=o.estabelecimento_id
    WHERE o.produto_id=? AND ${filterMode(f.mode)} AND e.ativo=TRUE
      AND h.quantidade_minima<=? ${historyWhere}
    ORDER BY h.observado_em DESC LIMIT 80`,[
      productId,f.quantity,...(f.location?[f.location.lon,f.location.lat,f.location.radiusKm]:[])
    ]);
  const offers=rows.map(asOffer);
  return {mode:f.mode,isDemo:f.mode==='demo',quantity:f.quantity,product,
    offers,savings:groupByExactProduct(offers)[0]?.savings??null,
    history:history.map(h=>({...h,price:Number(h.price)}))};
});

// Referências de catálogos OFICIAIS consultados e documentados manualmente.
// Separadas das ofertas geolocalizadas: não comprovam preço da loja física.
type CatalogPriceRow=RowDataPacket & {
  id:number;gtin:string;productName:string;brand:string;size:string;network:string;
  channelCode:string;channelName:string;city:string;state:string;price:number;
  minimumQuantity:number;sourceUrl:string;referenceDate:string;referenceType:string;notice:string;
};
app.get<{Querystring:Filters}>('/api/catalog/prices',async(request,reply)=>{
  const q=String(request.query.q??'').trim();
  if(q.length>80)return reply.code(400).send({error:'Pesquisa muito longa.'});
  const quantity=Number(request.query.quantity??'1');
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)
    return reply.code(400).send({error:'Quantidade precisa ser um inteiro entre 1 e 1000.'});
  const uf=String(request.query.uf??'MA').trim().toUpperCase();
  if(uf!=='MA')return reply.code(400).send({error:'Somente o Maranhão está disponível neste módulo.'});
  const [rows]=await pool.execute<CatalogPriceRow[]>(`
    SELECT id,gtin,productName,brand,size,network,channelCode,channelName,city,state,
      price,minimumQuantity,sourceUrl,referenceDate,referenceType,notice
    FROM (
      SELECT c.id,c.gtin,c.produto_nome AS productName,c.marca AS brand,c.embalagem AS size,
        c.rede AS network,c.canal_codigo AS channelCode,c.canal_nome AS channelName,
        c.cidade AS city,c.uf AS state,c.preco AS price,c.quantidade_minima AS minimumQuantity,
        c.fonte_url AS sourceUrl,DATE_FORMAT(c.referencia_em,'%Y-%m-%d') AS referenceDate,
        c.tipo_consulta AS referenceType,c.observacao AS notice,
        ROW_NUMBER() OVER (PARTITION BY c.gtin,c.canal_codigo
          ORDER BY c.quantidade_minima DESC,c.referencia_em DESC,c.id DESC) AS rn
      FROM catalogo_ofertas_documentadas c
      WHERE c.uf=? AND c.quantidade_minima<=?
        AND (INSTR(LOWER(c.produto_nome),LOWER(?))>0 OR
             INSTR(LOWER(c.marca),LOWER(?))>0 OR c.gtin=?)
    ) t WHERE rn=1 ORDER BY price ASC,channelName ASC LIMIT 100`,[uf,quantity,q,q,q]);
  return {
    source:'CATALOGO_DOCUMENTADO',query:q,quantity,uf,pricesAreLive:false,
    isPhysicalStorePrice:false,
    note:'Consultas documentadas a catálogos online: não são preço em tempo real nem confirmação de prateleira.',
    offers:rows.map(r=>({...r,price:Number(r.price),minimumQuantity:Number(r.minimumQuantity)}))
  };
});

// PREÇOS ONLINE: dados licenciados por UF, sem atribuir a uma loja física do OSM.
// Apenas lê observações sincronizadas pelo processo administrativo de integração.
type OnlinePriceRow = RowDataPacket & {
  id:number; gtin:string; productName:string; network:string; storeName:string;
  state:string; channel:string; price:number; available:number; source:string;
  observedAt:Date; syncedAt:Date;
};
app.get<{Querystring:Filters}>('/api/market/prices',async(request,reply)=>{
  const ean=String(request.query.ean??'').trim();
  if(!gtinValid(ean))return reply.code(400).send({error:'Informe um EAN/GTIN válido.'});
  const uf=String(request.query.uf??'MA').trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(uf))return reply.code(400).send({error:'UF inválida.'});
  const [rows]=await pool.execute<OnlinePriceRow[]>(`
    SELECT id, gtin, produto_nome AS productName, rede AS network,
      estabelecimento AS storeName, uf AS state, canal AS channel,
      preco AS price, disponivel AS available, fonte AS source,
      observado_em AS observedAt, sincronizado_em AS syncedAt
    FROM precos_online WHERE gtin=? AND uf=? AND disponivel=TRUE
    ORDER BY preco ASC, observado_em DESC LIMIT 60`,[ean,uf]);
  return {
    ean,uf,source:[...new Set(rows.map(r=>r.source))].join(' + ')||'Data Market',sourceWebsite:'https://datamarket.cnovatech.com.br/conectar',
    isPhysicalStorePrice:false,hasApiKey:Boolean(process.env.DATA_MARKET_API_KEY),
    note:'Preços digitais por UF, sem comprovação de valor em uma unidade física perto do consumidor.',
    offers:rows.map(r=>({...r,price:Number(r.price),available:Boolean(r.available)}))
  };
});


// CATÁLOGO COMPLETO: consulta qualquer produto presente nos dados importados.
// A busca não tem uma lista de SKUs fixa em código: cresce junto com o CSV/MySQL.
type CatalogDBRow=RowDataPacket & CatalogRow;
const catalogFields=`id,gtin,produto_nome AS productName,marca AS brand,embalagem AS size,
  rede AS network,canal_codigo AS channelCode,canal_nome AS channelName,
  cidade AS city,uf AS state,preco AS price,quantidade_minima AS minimumQuantity,
  fonte_url AS sourceUrl,DATE_FORMAT(referencia_em,'%Y-%m-%d') AS referenceDate,
  tipo_consulta AS referenceType,observacao AS notice`;
async function catalogRowsForGtins(gtins:string[]):Promise<CatalogRow[]>{
  if(gtins.length===0)return [];
  const marks=gtins.map(()=>'?').join(',');
  const [rows]=await pool.execute<CatalogDBRow[]>(`SELECT ${catalogFields}
    FROM catalogo_ofertas_documentadas WHERE uf='MA' AND gtin IN (${marks})`,gtins);
  return rows.map(r=>({...r,id:Number(r.id),price:Number(r.price),minimumQuantity:Number(r.minimumQuantity)}));
}
function searchConditions(q:string,network:string){
  const words=q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,8);
  const terms=words.map(()=>"INSTR(LOWER(CONCAT_WS(' ', produto_nome, marca, embalagem, gtin)), LOWER(?))>0");
  const where=`uf='MA'${network?' AND rede=?':''}${terms.length?' AND '+terms.join(' AND '):''}`;
  return {where,args:[...(network?[network]:[]),...words]};
}
// Redes comparadas pela opção "Comparar Atacadão + Mateus". Unidades (canais) não são redes.
const COMPARED_NETWORKS=['Atacadão','Mateus Mais'] as const;
app.get<{Querystring:Filters}>('/api/catalog/items',async(request,reply)=>{
  const q=String(request.query.q??'').trim();const network=String(request.query.network??'').trim();
  if(q.length>100||network.length>100)return reply.code(400).send({error:'Filtros muito longos.'});
  const compare=request.query.compare==='1';
  if(compare&&network)return reply.code(400).send({error:'Use o filtro de mercado OU a comparação entre redes, não os dois.'});
  let quantity:number;try{quantity=parseQuantity(request.query.quantity);}catch(err){return reply.code(400).send({error:(err as Error).message});}
  const page=Number(request.query.page??'1');
  if(!Number.isSafeInteger(page)||page<1||page>10000)return reply.code(400).send({error:'Página inválida.'});
  const limit=24;const {where,args}=searchConditions(q,network);
  if(compare){
    // Só entram GTINs válidos presentes nas DUAS redes. A pesquisa vale se qualquer uma das
    // redes descrever o produto com os termos (os nomes variam de uma rede para outra).
    // (uma única leitura da tabela: o teste dos termos entra no HAVING)
    const both=`FROM catalogo_ofertas_documentadas
      WHERE uf='MA' AND rede IN (?,?)
      GROUP BY gtin HAVING COUNT(DISTINCT rede)=2${q?` AND MAX(${where})=1`:''}`;
    const bothArgs=[...COMPARED_NETWORKS,...(q?args:[])];
    const [countRows]=await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM (SELECT gtin ${both}) t`,bothArgs);
    const [identities]=await pool.execute<RowDataPacket[]>(`SELECT gtin,MAX(referencia_em) AS lastReference ${both}
      ORDER BY lastReference DESC,gtin ASC LIMIT ? OFFSET ?`,[...bothArgs,limit,(page-1)*limit]);
    const ids=identities.map(r=>String(r.gtin)).filter(gtinValid);
    const rows=(await catalogRowsForGtins(ids)).filter(r=>(COMPARED_NETWORKS as readonly string[]).includes(r.network));
    const items=ids.map(gtin=>({...compareCatalogItem(rows,gtin,quantity),networks:compareNetworks(rows,gtin,quantity,COMPARED_NETWORKS)}))
      .filter(item=>item.product!==null);
    const total=Number(countRows[0]?.total??0);
    return {source:'CATALOGO_DOCUMENTADO',pricesAreLive:false,query:q,network:'',compare:true,comparedNetworks:COMPARED_NETWORKS,
      quantity,page,total,pages:Math.ceil(total/limit),items,
      note:'Somente produtos com o mesmo GTIN/EAN nas duas redes. De cada rede aparece a unidade com o menor preço para a quantidade pedida.'};
  }
  const [countRows]=await pool.execute<RowDataPacket[]>(`SELECT COUNT(DISTINCT gtin) AS total FROM catalogo_ofertas_documentadas WHERE ${where}`,args);
  const [identities]=await pool.execute<RowDataPacket[]>(`SELECT gtin,MAX(referencia_em) AS lastReference
    FROM catalogo_ofertas_documentadas WHERE ${where}
    GROUP BY gtin ORDER BY lastReference DESC,gtin ASC LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit]);
  const ids=identities.map(r=>String(r.gtin));
  const all=await catalogRowsForGtins(ids);
  const filtered=network?all.filter(r=>r.network===network):all;
  const items=ids.map(gtin=>compareCatalogItem(filtered,gtin,quantity)).filter(item=>item.product!==null);
  return {source:'CATALOGO_DOCUMENTADO',pricesAreLive:false,query:q,network,quantity,page,
    total:Number(countRows[0]?.total??0),pages:Math.ceil(Number(countRows[0]?.total??0)/limit),items,
    note:'Itens importados com fonte e data, não preços ao vivo. Mais itens aparecem conforme novos CSVs forem importados.'};
});
app.get<{Querystring:Filters}>('/api/catalog/compare',async(request,reply)=>{
  const gtin=String(request.query.gtin??'').trim();
  if(!gtinValid(gtin))return reply.code(400).send({error:'Código de barras inválido.'});
  let quantity:number;try{quantity=parseQuantity(request.query.quantity);}catch(err){return reply.code(400).send({error:(err as Error).message});}
  const rows=await catalogRowsForGtins([gtin]);
  if(!rows.length)return reply.code(404).send({error:'Produto ainda não cadastrado no catálogo documentado.'});
  return {source:'CATALOGO_DOCUMENTADO',pricesAreLive:false,...compareCatalogItem(rows,gtin,quantity)};
});
app.post<{Body:unknown}>('/api/catalog/basket/compare',async(request,reply)=>{
  let basket:ReturnType<typeof validateBasket>;
  try{const body=request.body as Record<string,unknown>|null;basket=validateBasket(body?.items);}
  catch(err){return reply.code(400).send({error:(err as Error).message});}
  const rows=await catalogRowsForGtins(basket.map(item=>item.gtin));
  return {source:'CATALOGO_DOCUMENTADO',pricesAreLive:false,...compareBasket(rows,basket)};
});
app.get<{Querystring:Filters}>('/api/catalog/similar',async(request,reply)=>{
  const q=String(request.query.q??'').trim();const brand=String(request.query.brand??'').trim();
  const size=String(request.query.size??'').trim();const gtin=String(request.query.gtin??'').trim();
  if(q.length<3||q.length>120||brand.length>100||size.length>40)return reply.code(400).send({error:'Informe nome do produto (3–120 caracteres).'});
  const first=q.split(/\s+/)[0];
  const [candidates]=await pool.execute<RowDataPacket[]>(`SELECT gtin,produto_nome AS name,marca AS brand,
    embalagem AS size,MAX(referencia_em) AS lastReference
    FROM catalogo_ofertas_documentadas WHERE uf='MA' AND
    INSTR(LOWER(produto_nome),LOWER(?))>0
    GROUP BY gtin,produto_nome,marca,embalagem ORDER BY lastReference DESC LIMIT 500`,[first]);
  const source={name:q,brand,size,gtin};
  const matches=candidates.map(r=>({gtin:String(r.gtin),name:String(r.name),brand:String(r.brand),size:String(r.size),
    ...productNameSuggestion(source,{gtin:String(r.gtin),name:String(r.name),brand:String(r.brand),size:String(r.size)})}))
    .filter(m=>m.possible).sort((a,b)=>b.score-a.score).slice(0,15);
  return {query:q,matches,note:'Similaridade textual é apenas sugestão. A identificação automática exige o mesmo GTIN conferido.'};
});

app.setErrorHandler((error,_request,reply)=>{
  app.log.error(error);
  reply.code(500).send({error:'Erro interno na API. Confira o MySQL, a migração 03 e o terminal do back-end.'});
});
const port=Number(process.env.PORT??3001);
const host=process.env.HOST||'127.0.0.1';
try{await app.listen({host,port}); startMarketScheduler(app.log);}
catch(err){app.log.error(err);process.exit(1);}
