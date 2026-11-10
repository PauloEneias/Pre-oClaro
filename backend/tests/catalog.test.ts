import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseCatalogCsv,catalogHeader} from '../src/catalogCsv.js';
const base=[
  '7896006711155','Arroz Branco Camil Tipo 1','Camil','5 kg','Atacadão',
  'ATACADAO_SAO_LUIS_24H','Atacadão São Luís 24h (catálogo online)','São Luís','MA','27,95','1',
  'https://www.atacadao.com.br/loja/sao-luis','2026-11-09','CONSULTA_INDEXADA',
  'Resultado de índice do catálogo não verificado ao vivo'
];
function csv(line=base){return `${catalogHeader.join(';')}\n${line.join(';')}\n`;}
const today=new Date('2026-11-10T00:00:00Z');
test('leitura do registro do catálogo e preço com vírgula',()=>{
  const rows=parseCatalogCsv(csv(),today);
  assert.equal(rows.length,1);assert.equal(rows[0].price,27.95);
  assert.equal(rows[0].minimumQuantity,1);assert.equal(rows[0].referenceType,'CONSULTA_INDEXADA');
});
test('permite preço de atacado com quantidade mínima',()=>{
  const r=[...base];r[9]='26,95';r[10]='6';
  assert.equal(parseCatalogCsv(csv(r),today)[0].minimumQuantity,6);
});
test('impede rede divergente do domínio oficial',()=>{
  const r=[...base];r[11]='https://www.example.org/falso';
  assert.throws(()=>parseCatalogCsv(csv(r),today),/catálogo oficial/);
});
test('impede data futura e GTIN inválido',()=>{
  const r=[...base];r[12]='2027-01-01';assert.throws(()=>parseCatalogCsv(csv(r),today),/futura/);
  const q=[...base];q[0]='7896006711154';assert.throws(()=>parseCatalogCsv(csv(q),today),/GTIN/);
});
test('impede repetição da mesma oferta no mesmo arquivo',()=>{
  assert.throws(()=>parseCatalogCsv(csv()+base.join(';')+'\n',today),/duplicada/);
});
