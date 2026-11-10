import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOsmElements, privacyQueryPosition, nearbyFromOsm } from '../src/osm.js';

test('interpreta supermercado real de nó e prédio do OpenStreetMap',()=>{
  const parsed=parseOsmElements([
    {type:'node',id:123,lat:-2.52,lon:-44.25,tags:{shop:'supermarket',name:'Mercado Teste','addr:street':'Rua Teste','addr:housenumber':'12'}},
    {type:'way',id:456,center:{lat:-2.53,lon:-44.26},tags:{shop:'supermarket',name:'Atacarejo Exemplo'}},
    {type:'node',id:789,lat:0,lon:0,tags:{shop:'supermarket'}},
  ]);
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].osmId,'node/123');
  assert.equal(parsed[0].address,'Rua Teste, 12');
  assert.equal(parsed[1].latitude,-2.53);
});

test('não compartilha GPS exato com o serviço externo',()=>{
  assert.deepEqual(privacyQueryPosition(-2.531789,-44.259123),{lat:-2.53,lon:-44.26});
});

test('filtra lojas pela distância real em linha reta',()=>{
  const items=parseOsmElements([
    {type:'node',id:1,lat:-2.53,lon:-44.25,tags:{name:'Perto',shop:'supermarket'}},
    {type:'node',id:2,lat:-2.70,lon:-44.40,tags:{name:'Longe',shop:'supermarket'}}
  ]);
  assert.deepEqual(nearbyFromOsm(items,-2.53,-44.25,5).map(s=>s.name),['Perto']);
});
