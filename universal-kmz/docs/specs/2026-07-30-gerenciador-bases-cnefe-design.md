# Gerenciador de bases CNEFE por UF — download sob demanda, atualização e retenção

Data: 2026-07-30
Status: aprovado para implementação

## Objetivo

Permitir endereços completos e precisos em todo o Brasil sem custo de API paga, usando o CNEFE
(Censo 2022 do IBGE) como fonte primária de geocodificação reversa. Hoje o app já baixa, ingere e
remove bases por UF; falta cobrir o ciclo de vida completo: saber quando uma UF é necessária,
saber quando a versão local está desatualizada, e administrar o espaço ocupado.

O mapa continua sendo o Google Maps. O custo do Google vem da Geocoding API (uma chamada por
ponto), não da exibição do mapa — com cobertura CNEFE nacional, a cadeia de geocodificação não
precisa de provedor pago.

## Não-escopo

- Substituir a renderização do mapa (MapLibre/OSM) — descartado explicitamente.
- Exportar imagens de mapa nos relatórios — necessidade separada, não tratada aqui.
- Outras bases públicas além do CNEFE — só entram se houver um problema concreto que as exija.
- Atualização automática de base sem ação do usuário — proibida por natureza do uso pericial.

## Comportamento

### 1. Detecção de UF sem cobertura

Ao concluir o parse de um KML/KMZ, o app determina em quais UFs os pontos caem usando uma tabela
estática de caixas delimitadoras (bounding boxes) das 27 unidades federativas, em
`src/ufBounds.ts`. Não há dado novo a baixar e nenhuma dependência de rede.

A aproximação é deliberada: em divisa de estado as caixas se sobrepõem e a detecção devolve mais
de uma UF candidata. Como o resultado serve apenas para *sugerir download*, sugerir a mais é
aceitável; sugerir a menos não é. A precisão do endereço continua vindo do CNEFE, nunca da caixa.

Cruzando as UFs detectadas com as UFs indexadas (já disponíveis via estatística por `uf` no
índice), obtém-se a lista de UFs ausentes.

### 2. Aviso antes de baixar

Havendo UF ausente, o front exibe um aviso por UF contendo: nome da UF, tamanho real do arquivo
remoto (via `HEAD` no IBGE — já executado hoje na verificação de disco) e espaço livre em disco.

- **Aceitar** enfileira o download na fila existente (baixar → extrair → ingerir). Ao concluir, os
  pontos que ficaram sem cobertura são regeocodificados através da API de jobs atual, com pausa e
  retomada.
- **Recusar** não trava nada: os pontos daquela UF seguem pela cadeia de reserva (Nominatim,
  Photon) e ficam sinalizados na tabela como sem cobertura CNEFE.

Nunca há download sem confirmação explícita.

### 3. Selo de atualização

No boot, para cada UF indexada, um `HEAD` compara `ETag`/`Last-Modified` remotos com os valores
persistidos no download original. Divergindo, a UF recebe o selo "atualização disponível" no
gerenciador, ao lado da data da versão local.

A atualização só ocorre por clique. O IBGE publica arquivo completo por UF, então atualizar
significa rebaixar e reingerir aquela UF inteira (referência: SP levou ~11 minutos apenas de
ingestão). A checagem não transfere bytes de dados e falha em silêncio quando não há rede.

### 4. Retenção

O gerenciador passa a exibir, por UF: linhas indexadas, tamanho ocupado, data da versão local,
selo de atualização, e as ações manter/atualizar/remover. No topo, total ocupado e espaço livre.

A remoção por UF já opera sobre a coluna `uf` indexada (não sobre o nome do arquivo). Manter o
Brasil inteiro projeta-se na ordem de 30 GB — extrapolado de SP, que tem 22,9 milhões de endereços
e ocupa 6,4 GB de índice. A gestão de retenção é requisito, não conveniência.

### 5. Rastreabilidade pericial

A data/versão da base usada é registrada junto do resultado. Atualizar uma UF não reescreve
laudos anteriores: um relatório emitido com a base de março permanece descrito como tal. O selo
informa; a decisão é do usuário.

## Superfícies de código

| Arquivo | Mudança |
|---|---|
| `src/ufBounds.ts` (novo) | Caixas das 27 UFs e `detectUfs(coords): string[]` |
| `src/cnefeDownloader.ts` | `checkRemoteVersion(uf)` por `HEAD`, comparando com `ETag`/`Last-Modified` persistidos |
| `src/cnefeIndex.ts` | Persistir `ETag`/data por UF no `meta`; expor na estatística por UF |
| `server.ts` | Rota de checagem em lote; `atualizacao_disponivel` e `versao_local` na listagem existente |
| `src/components/CnefeManager.tsx` | Selo, data da versão, botão atualizar, total ocupado |
| `src/App.tsx` | Aviso de UF ausente após o parse; regeocodificação após ingestão |

## Testes

- `detectUfs`: ponto no interior de uma UF devolve uma; ponto em divisa devolve as candidatas;
  coordenada fora do Brasil devolve vazio.
- Checagem de versão contra servidor HTTP falso: `ETag` igual (sem selo), `ETag` diferente (com
  selo), servidor indisponível (sem selo, sem erro visível).
- Transição de estados no gerenciador: indexada → atualização disponível → atualizando → indexada.
- Fluxo de recusa: UF ausente recusada mantém os pontos sinalizados e não dispara download.

Todos entram em `npm test`, que hoje encadeia 12 regressões.

## Riscos

- **Divisa de estado**: a caixa delimitadora sugere UF a mais. Mitigado por ser sugestão, e por o
  usuário confirmar cada download.
- **Espaço em disco**: 27 UFs somam dezenas de GB. Mitigado pela verificação de espaço já
  existente e pela gestão de retenção desta spec.
- **Tempo de ingestão**: atualizar um estado grande custa minutos. Mitigado por ser sempre uma
  ação explícita, nunca automática.
- **Republicação do IBGE**: caso o IBGE altere o layout do CSV, a ingestão de uma UF nova pode
  falhar enquanto as já indexadas seguem íntegras. A falha é por UF e não corrompe o índice.
