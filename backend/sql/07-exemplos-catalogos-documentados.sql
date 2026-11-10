-- PreçoClaro | 07: primeiras referências de catálogos oficiais de São Luís.
-- Execute SOMENTE depois de 06-catalogos-documentados.sql.
-- Valores obtidos de RESULTADOS INDEXADOS consultados em 09/11/2026:
-- NÃO são preços em tempo real e podem ter mudado.
-- NÃO equivalem a preço confirmado em loja física, estoque ou disponibilidade.
USE precoclaro;

INSERT IGNORE INTO catalogo_ofertas_documentadas
(gtin,produto_nome,marca,embalagem,rede,canal_codigo,canal_nome,cidade,uf,preco,
 quantidade_minima,fonte_url,referencia_em,tipo_consulta,observacao)
VALUES
('7896006711155','Arroz Branco Camil Tipo 1','Camil','5 kg','Atacadão',
 'ATACADAO_SAO_LUIS_24H','Atacadão São Luís 24h (catálogo online)','São Luís','MA',27.95,
 1,'https://www.atacadao.com.br/loja/sao-luis','2026-11-09','CONSULTA_INDEXADA',
 'Referência de página indexada. Valor online por unidade. Confirmar preço no site antes de comprar.'),
('7896006711155','Arroz Branco Camil Tipo 1','Camil','5 kg','Atacadão',
 'ATACADAO_SAO_LUIS_24H','Atacadão São Luís 24h (catálogo online)','São Luís','MA',26.95,
 6,'https://www.atacadao.com.br/loja/sao-luis','2026-11-09','CONSULTA_INDEXADA',
 'Referência de página indexada. Valor online por unidade na compra de 6 ou mais.'),
('7896006711155','Arroz Branco Camil Tipo 1','Camil','5 kg','Mateus Mais',
 'MATEUS_FOOD_EXPRESS_SLZ','Mateus Food Express São Luís (catálogo online)','São Luís','MA',23.49,
 1,'https://www.mateusmais.com.br/produtos/f7a3a08f-12bf-4507-ae1b-81d8c02790cf/f5868898-8978-47a7-8112-5c2d4410280a',
 '2026-11-09','CONSULTA_INDEXADA',
 'Referência de página indexada. Valor pode variar conforme endereço e disponibilidade.');

SELECT rede,canal_nome,produto_nome,preco,quantidade_minima,referencia_em
FROM catalogo_ofertas_documentadas ORDER BY rede,quantidade_minima;
