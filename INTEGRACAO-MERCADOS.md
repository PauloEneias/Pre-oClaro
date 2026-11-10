# PreçoClaro — Etapa 3: integração opcional de preços online (Mateus / Atacadão)

Este pacote **não promete** acesso ao estoque ou aos preços de prateleira do Mateus e do Atacadão. Ele implementa uma integração **condicionada a uma API key própria** com a **Data Market (terceiro, não API oficial das redes)**. A documentação pública consultada em 09/11/2026 anuncia dados online do Mateus no Maranhão, mas cita Atacadão em SP. Por isso **não está comprovada a cobertura do Atacadão de São Luís**. Confira antes de apresentar a integração como operante.

- Provedor: https://datamarket.cnovatech.com.br/conectar
- API documentada: `GET https://datamarket.cnovatech.com.br/api/v1/market/products/ean/{ean}` com cabeçalho `X-API-Key`
- A página do provedor informa teste gratuito de 14 dias/50 consultas, com CNPJ e restrição de uso em produção: confirme os detalhes diretamente com ele.
- **Não há scraping não autorizado** nem obtenção de chaves embutidas no código. O sistema não contorna login ou CAPTCHA.
- Se não houver dados: mostramos lista vazia e mensagem honesta, jamais preços fictícios com rótulo de real.

## Instalação

1. Extraia o ZIP completo e abra no VS Code.
2. No MySQL Workbench execute os arquivos existentes `backend/sql/01-schema.sql`, `03-localizacao-real.sql`, `04-comparacao-historico.sql` (se ainda não executados), **depois** `backend/sql/05-precos-online.sql`.
3. Compreenda as condições e a cobertura da API de terceiros. Se ela for adequada, obtenha uma chave própria no site do provedor. **Não mande sua API key para ninguém**.
4. Na pasta `backend`, copie `.env.example` para `.env` e informe `DB_PASSWORD` e `DATA_MARKET_API_KEY` (nunca no React).
5. Para testar manualmente apenas um produto (exemplo: **EAN 7896006711155**, Arroz Camil Branco 5 kg):

   ```powershell
   cd backend
   npm install
   npm run sync:market -- 7896006711155
   ```

   Se retornar `matched: 0`, significa que a API não devolveu ofertas elegíveis das duas redes em MA, ou não há cobertura para esse EAN. Isso NÃO é erro do comparador.
6. Para consultar registros gravados no MySQL, inicie o back-end (`npm run dev`) e o React em outro terminal, na raiz (`npm install`, `npm run dev`). Na página **Comparar preços**, escolha **Ofertas com fonte documentada** e use o bloco **Consultar preços online** com o EAN.
7. End-point sem autenticação para **ler** dados já sincronizados, sem expor a API key: `http://localhost:3001/api/market/prices?ean=7896006711155&uf=MA`.

## Atualização automática opcional

Só depois de confirmar que o teste manual funciona, a cobertura e as cotas do seu plano, configure `backend/.env`:

```ini
DATA_MARKET_API_KEY=sua_chave_privada
MARKET_SYNC_ENABLED=true
MARKET_SYNC_EANS=7896006711155
MARKET_SYNC_INTERVAL_HOURS=24
```

Ao executar `npm run dev` no back-end, o sistema consulta esses códigos inicialmente e depois a cada 24 horas **enquanto o servidor estiver ligado**. No máximo 10 códigos por ciclo, sem atualização por visita de usuário. Não existe execução em segundo plano quando o servidor estiver desligado.

## Dados e limitações

- Os registros importados são exclusivamente de canais **e-commerce/delivery**, classificados por UF. Uma loja pode atender o Maranhão sem ser a unidade física mais próxima.
- A API pode não cobrir todas as redes, cidades, lojas ou produtos. A presença de "Mateus MA" em material promocional não prova que há preço para o seu EAN.
- Não misturamos esse catálogo com a busca por raio dos mercados OSM; o banco usa tabelas independentes `precos_online` e `historico_precos_online`.
- Mantemos o GTIN exato, nome, rede, canal, preço, estado, horário da coleta e provedor. Nunca reatribuímos preço de SP a MA.
- Sempre indicamos ao usuário a origem e as limitações do preço.
- A API pode requerer CNPJ e plano pago para produção; para projeto universitário, confirme os requisitos antes de assumir a integração como fonte definitiva.

## Testes

```powershell
cd backend
npm test
npm run typecheck
```

**Validação neste ambiente:** código TS/TSX verificado quanto à sintaxe; funções de normalização testadas com **resposta simulada**. Não foi feita requisição autenticada ao provedor nem teste ponta a ponta com MySQL, pois não possuímos a chave do usuário e um MySQL em execução.

## Plano B sem chave de terceiros

Se não for possível obter a chave ou a cobertura local, utilize `backend/scripts/import-price-csv.ts` com preços verdadeiros, data e fonte documentada, até conseguir API oficial ou parceria com os supermercados. Isso permite entregar comparação real sem inventar uma coleta contínua que não existe.
