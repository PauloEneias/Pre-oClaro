-- Registros TOTALMENTE FICTÍCIOS para desenvolvimento e apresentação.
-- As coordenadas são pontos aproximados de bairros, NÃO endereços de lojas reais.
-- Não usar os preços abaixo como preços atuais de Mateus, Atacadão ou outros mercados.
USE precoclaro;

INSERT INTO estabelecimentos (id, nome, bairro, cidade, uf, latitude, longitude, demonstracao) VALUES
 (1, 'Mercado Exemplo Centro', 'Centro', 'São Luís', 'MA', -2.5299000, -44.3020000, TRUE),
 (2, 'Mercado Exemplo Renascença', 'Renascença', 'São Luís', 'MA', -2.4946000, -44.2886000, TRUE),
 (3, 'Mercado Exemplo Cohama', 'Cohama', 'São Luís', 'MA', -2.5282000, -44.2575000, TRUE),
 (4, 'Mercado Exemplo Angelim', 'Angelim', 'São Luís', 'MA', -2.5529000, -44.2465000, TRUE)
ON DUPLICATE KEY UPDATE nome = VALUES(nome), bairro = VALUES(bairro), latitude = VALUES(latitude), longitude = VALUES(longitude);

INSERT INTO produtos (id, nome, marca, embalagem, imagem) VALUES
 (1, 'Arroz Branco', 'Tio João', '5 kg', '/products/arroz.png'),
 (2, 'Café Tradicional', 'Pilão', '500 g', '/products/cafe.png'),
 (3, 'Leite Integral', 'Italac', '1 L', '/products/leite.png'),
 (4, 'Óleo de Soja', 'Liza', '900 ml', '/products/oleo.png'),
 (5, 'Açúcar Refinado', 'União', '1 kg', '/products/acucar.png'),
 (6, 'Feijão Carioca', 'Camil', '1 kg', '/products/feijao.png'),
 (7, 'Macarrão Parafuso', 'Renata', '500 g', '/products/macarrao.png'),
 (8, 'Farinha de Trigo', 'Dona Benta', '1 kg', '/products/farinha.png')
ON DUPLICATE KEY UPDATE nome = VALUES(nome), marca = VALUES(marca), embalagem = VALUES(embalagem), imagem = VALUES(imagem);

INSERT INTO ofertas (produto_id, estabelecimento_id, preco, tipo_fonte, quantidade_minima) VALUES
 (1,1,22.90,'DEMO',1),(1,2,24.70,'DEMO',1),(1,3,23.40,'DEMO',1),(1,4,25.15,'DEMO',1),
 (2,1,16.49,'DEMO',1),(2,2,17.80,'DEMO',1),(2,3,15.99,'DEMO',1),(2,4,18.10,'DEMO',1),
 (3,1,4.79,'DEMO',1),(3,2,5.12,'DEMO',1),(3,3,4.69,'DEMO',1),(3,4,5.30,'DEMO',1),
 (4,1,6.99,'DEMO',1),(4,2,7.25,'DEMO',1),(4,3,6.80,'DEMO',1),(4,4,7.59,'DEMO',1),
 (5,1,3.89,'DEMO',1),(5,2,4.40,'DEMO',1),(5,3,4.05,'DEMO',1),(5,4,3.95,'DEMO',1),
 (6,1,7.49,'DEMO',1),(6,2,7.89,'DEMO',1),(6,3,7.30,'DEMO',1),(6,4,8.10,'DEMO',1),
 (7,1,3.99,'DEMO',1),(7,2,4.20,'DEMO',1),(7,3,4.50,'DEMO',1),(7,4,4.10,'DEMO',1),
 (8,1,4.59,'DEMO',1),(8,2,4.75,'DEMO',1),(8,3,4.49,'DEMO',1),(8,4,4.95,'DEMO',1)
ON DUPLICATE KEY UPDATE preco = VALUES(preco), tipo_fonte = VALUES(tipo_fonte), quantidade_minima = VALUES(quantidade_minima);
