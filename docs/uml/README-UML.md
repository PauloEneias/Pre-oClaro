# Diagramas UML do PreçoClaro: projeto Modelio

## O que está nesta pasta

| Arquivo | Conteúdo | Formato |
|---|---|---|
| `PrecoClaro-Modelio.zip` | Projeto **nativo e editável** do Modelio 5.4 com os oito tipos de diagrama (nove diagramas: a sequência está em duas partes) | ZIP gerado pelo mecanismo de exportação do próprio Modelio (`IProjectService.exportProject`, o mesmo do menu *Exportar projeto*) |
| `01-diagrama-caso-de-uso.png` | Diagrama de Caso de Uso | PNG exportado pelo Modelio |
| `02-diagrama-pacotes-mvc.png` | Diagrama de Pacotes (MVC) | PNG exportado pelo Modelio |
| `03-diagrama-classes.png` | Diagrama de Classes | PNG exportado pelo Modelio |
| `04-diagrama-objetos.png` | Diagrama de Objetos | PNG exportado pelo Modelio |
| `05-diagrama-sequencia-1-requisicao.png` | Diagrama de Sequência 1: requisição e resposta | PNG exportado pelo Modelio |
| `05-diagrama-sequencia-2-processamento.png` | Diagrama de Sequência 2: processamento da busca | PNG exportado pelo Modelio |
| `06-diagrama-comunicacao.png` | Diagrama de Comunicação | PNG exportado pelo Modelio |
| `07-diagrama-maquina-de-estados.png` | Diagrama de Máquina de Estados | PNG exportado pelo Modelio |
| `08-diagrama-atividades.png` | Diagrama de Atividades | PNG exportado pelo Modelio |
| `verificacao-importacao.log` | Resultado da verificação depois de importar o ZIP num workspace novo | texto |
| `EXPLICACAO-DIAGRAMAS.md` | Explicação acadêmica de cada diagrama | Markdown |
| `fonte/` | Scripts que geram, exportam e verificam o projeto (reprodutibilidade) | Jython/Python |

As imagens foram exportadas do projeto **depois de reimportado**, e não do projeto original. Assim elas mostram exatamente o que o ZIP contém.

## Nome do projeto: `PrecoClaro_UML`

O nome pedido era `PrecoClaro-UML`, mas o Modelio 5.4 recusa hífen em nome de projeto. A mensagem do log foi: `Aborting project creation: Illegal project name 'PrecoClaro-UML'`. Por isso o projeto se chama **`PrecoClaro_UML`**. O arquivo entregue mantém o nome `PrecoClaro-Modelio.zip`.

## Como abrir no Modelio

1. Abra o Modelio 5.4 (Open Source).
2. Menu **Arquivo → Importar projeto** (*File → Import project*) e escolha `PrecoClaro-Modelio.zip`.
3. O projeto `PrecoClaro_UML` aparece na lista de projetos do workspace. Abra-o.
4. Na árvore do modelo, cada diagrama fica no seu pacote:

| Pacote | Diagrama |
|---|---|
| `01 Casos de Uso` | Diagrama de Caso de Uso (casos de uso dentro do pacote-fronteira "Sistema PreçoClaro") |
| `02 Pacotes MVC` | Diagrama de Pacotes (MVC) |
| `03 Dominio` | Diagrama de Classes |
| `04 Objetos (exemplo ilustrativo)` | Diagrama de Objetos |
| `05 Sequencia` | Duas interações: "requisição e resposta" e "processamento no servidor", cada uma com seu Diagrama de Sequência |
| `06 Comunicacao` | Interação "Adicionar produto à lista" → Diagrama de Comunicação |
| `07 Estados da coleta` | Máquina "Execução da coleta" → Diagrama de Máquina de Estados |
| `08 Atividades` | Atividade "Comparar lista de compras" → Diagrama de Atividades |

Todos os elementos (classes, atributos, associações, mensagens, estados, transições, ações, raias) são elementos UML reais do modelo, e não desenhos. Eles podem ser renomeados, movidos, apagados ou ampliados na interface do Modelio.

## Como foi verificado

Comandos executados nesta máquina com o Modelio 5.4.1 em modo *batch*:

1. **Geração:**
   ```
   modelio.exe -workspace <ws> -create PrecoClaro_UML -batch build_precoclaro_uml.ascii.py
   ```
   Todas as transações foram aceitas pelo validador de modelo do Modelio (*ModelShield*), e o projeto foi salvo com `IProjectService.saveProject`.
2. **Exportação:** `exportar_zip.py`, executado com outro projeto aberto, porque o Modelio não exporta o projeto que está aberto.
3. **Importação:** o ZIP foi extraído num workspace **vazio** (`<projeto>/project.conf` na raiz do arquivo, a mesma estrutura que a importação do Modelio espera).
4. **Abertura e conferência:**
   ```
   modelio.exe -workspace <ws novo> -open PrecoClaro_UML -batch verificar_projeto.ascii.py
   ```
   O resultado está em `verificacao-importacao.log`:
   - **9 diagramas encontrados**, nenhum faltando;
   - um teste de edição (renomear um diagrama dentro de uma transação, depois desfeita) foi aceito, o que confirma que o modelo continua editável;
   - as nove imagens foram exportadas desse projeto reimportado.

> **Limitação da verificação:** tudo foi feito pela API do Modelio em modo *batch*, sem clicar na interface gráfica, porque não tenho acesso à tela do computador. Recomenda-se abrir o ZIP uma vez pelo menu *Importar projeto* antes da apresentação.

## Ajustes visuais que podem ser feitos à mão

O script posiciona cada caixa numa grade e traça cada seta com pontos explícitos, em ângulo reto. As notas ficam fora da área principal. Dois pontos dependem do posicionamento automático do Modelio e podem ser ajustados arrastando:
- **Comunicação:** o rótulo de cada mensagem começa junto à caixa de origem e pode encostar na borda dela. Basta arrastar o rótulo.
- **Caso de Uso:** as associações dos atores externos à direita são retas inclinadas, porque o Modelio não aceitou pontos de dobra nesse tipo de ligação.

## Como gerar de novo

Na pasta `fonte/`:

```
python preparar_script.py
```

Esse passo gera as versões `*.ascii.py`. O Modelio lê o script no charset do Windows, então os acentos são convertidos em `\uXXXX`. Depois, rode os três comandos da seção anterior. A variável de ambiente `PC_UML_OUT` indica a pasta onde ficam as imagens e os logs.
