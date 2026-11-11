/** MODEL/REPOSITORY — estabelecimentos (lojas reais do OpenStreetMap e de demonstração). */
import type { RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import type { LocationFilter } from '../location.js';
import type { RealStore } from '../osm.js';

export type StoreRow = {
  id: number; name: string; neighborhood: string; city: string; state: string;
  address: string | null; osmId: string | null; updatedAt: Date;
  latitude: number; longitude: number; isDemo: boolean; distanceKm: number | null;
  /** Rede identificada pelo vínculo com a coleta (ATACADAO:…, MATEUS:…); null se não há vínculo. */
  network: string | null;
  /** Ofertas com fonte documentada disponíveis nesta loja. */
  offersCount: number;
};

/** Cadastro público das lojas devolvidas pelo OpenStreetMap. Nunca grava a posição do usuário. */
export async function upsertOsmStores(stores: RealStore[]): Promise<void> {
  if (!stores.length) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const s of stores) {
      await connection.execute(
        `INSERT INTO estabelecimentos
           (nome,bairro,cidade,uf,latitude,longitude,demonstracao,ativo,osm_id,endereco,fonte_localizacao,atualizado_em)
         VALUES(?,?,?,?,?,?,FALSE,TRUE,?,?,'OpenStreetMap',NOW())
         ON DUPLICATE KEY UPDATE
           nome=VALUES(nome),bairro=VALUES(bairro),cidade=VALUES(cidade),uf=VALUES(uf),
           latitude=VALUES(latitude),longitude=VALUES(longitude),endereco=VALUES(endereco),
           fonte_localizacao='OpenStreetMap',demonstracao=FALSE,ativo=TRUE,atualizado_em=NOW()`,
        [s.name, s.neighborhood, s.city, s.state, s.latitude, s.longitude, s.osmId, s.address]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/** Lojas reais dentro do raio, com a distância em linha reta calculada pelo MySQL. */
export async function findNearbyStores(location: LocationFilter): Promise<StoreRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.id,e.nome AS name,e.bairro AS neighborhood,e.cidade AS city,e.uf AS state,
       e.endereco AS address,e.osm_id AS osmId,e.atualizado_em AS updatedAt,
       e.latitude,e.longitude,e.codigo_externo AS externalCode,
       ST_Distance_Sphere(POINT(e.longitude, e.latitude), POINT(?, ?)) / 1000 AS distanceKm,
       (SELECT COUNT(*) FROM ofertas o WHERE o.estabelecimento_id=e.id AND o.disponivel=TRUE
          AND o.tipo_fonte IN ('ONLINE','LOJA') AND o.fonte_url IS NOT NULL) AS offersCount
     FROM estabelecimentos e
     WHERE e.ativo=TRUE AND e.osm_id IS NOT NULL AND e.demonstracao=FALSE
     HAVING distanceKm <= ?
     ORDER BY distanceKm ASC
     LIMIT 100`,
    [location.lon, location.lat, location.radiusKm]
  );
  return rows.map((r) => ({
    id: Number(r.id), name: String(r.name), neighborhood: String(r.neighborhood), city: String(r.city),
    state: String(r.state), address: r.address ?? null, osmId: r.osmId ?? null, updatedAt: r.updatedAt,
    latitude: Number(r.latitude), longitude: Number(r.longitude), isDemo: false,
    distanceKm: r.distanceKm === null ? null : Number(r.distanceKm),
    network: String(r.externalCode ?? '').startsWith('ATACADAO:') ? 'Atacadão'
      : String(r.externalCode ?? '').startsWith('MATEUS:') ? 'Mateus Mais' : null,
    offersCount: Number(r.offersCount),
  }));
}

/** Nome da loja (cabeçalho do filtro "ofertas desta loja"). */
export async function findStoreName(id: number): Promise<string | null> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT nome FROM estabelecimentos WHERE id=? AND ativo=TRUE', [id]);
  return rows[0] ? String(rows[0].nome) : null;
}
