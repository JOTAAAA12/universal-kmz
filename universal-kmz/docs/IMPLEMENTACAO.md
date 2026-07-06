# Implementacao

## Fase 1 - Geocoder multi-provedor

- Criado contrato comum de provedores em `src/providers/types.ts`.
- Google foi movido para provedor plugavel.
- Adicionados provedores Nominatim, Photon, LocationIQ, Geoapify, BigDataCloud e mock explicito.
- `src/geocoder.ts` passou a orquestrar `GEOCODER_CHAIN`, cache em memoria, cooldown de 60s e contadores por provedor.
- `server.ts` passou a expor `GET /api/geocode/providers` e a validar cadeia habilitada, nao apenas chave Google.
- `docker-compose.yml` recebeu envs da cadeia e chaves de provedores.
- Criado `scripts/provider-chain-regression.ts` e `npm run test:providers`.

Decisoes:

- Cadeia padrao sem `GEOCODER_CHAIN`: `google,nominatim,photon,bigdatacloud`.
- Provedores sem chave valida sao pulados.
- Falhas retryable, HTTP 429 e timeout colocam o provedor em cooldown e avancam para o proximo.

## Fase 2 - Cache persistente, dedup e jobs

- Criado cache persistente em `src/geocodeCache.ts`, configuravel por `GEOCODE_CACHE_DIR` e `GEOCODE_CACHE_MAX_ITEMS`.
- `src/geocoder.ts` passou a aceitar cache por injecao.
- Criada deduplicacao espacial em `src/geocodeJobs.ts`.
- `/api/geocode` passou a usar batch deduplicado e cache persistente.
- Criados endpoints de jobs:
  - `POST /api/geocode/jobs`
  - `GET /api/geocode/jobs/:id`
  - `POST /api/geocode/jobs/:id/pause`
  - `POST /api/geocode/jobs/:id/resume`
- UI passou a usar jobs para lotes com mais de 20 coordenadas.
- Criado `scripts/cache-and-jobs-regression.ts` e `npm run test:cache`.

## Fase 3 - Enderecos por trechos e poligonos

- Criado `src/lineSampling.ts` com amostragem de linhas, consolidacao de segmentos, amostragem de poligonos e resolucao de endereco dominante.
- Adicionados `TrechoEndereco`, `EnderecoPoligono`, `trechos_endereco` e `enderecos_poligono`.
- Criado `POST /api/geocode/trechos`.
- UI recebeu acao `Enderecar Trechos`, coluna de trechos enderecados e coluna de dominante/confrontantes.
- Exportadores passaram a incluir aba `Trechos_Enderecos`, CSV correspondente e propriedades GeoJSON para linhas/poligonos.
- Criado `scripts/trechos-regression.ts` e `npm run test:trechos`.

Decisao de compatibilidade:

- A aba legada `Trechos` foi mantida, e os enderecos consolidados foram para `Trechos_Enderecos`.

## Fase 4 - Precisao Brasil

- Criado provedor offline `cnefe` em `src/providers/cnefe.ts`.
- Criado indice local em `src/cnefeIndex.ts`, lendo CSV em streaming e aceitando cabecalhos alternativos.
- `GEOCODER_CHAIN` passou a aceitar `cnefe`.
- `ZERO_RESULTADOS` passou a permitir fallback para o proximo provedor.
- `/api/geocode/providers` passou a expor `linhas_indexadas`, `indice_parcial` e `mensagens`.
- Criado validador ViaCEP em `src/providers/viacep.ts`, ativado por `VIACEP_VALIDATION=true`.
- Criado cross-check opt-in por `GEOCODE_CROSSCHECK=true`.
- `docker-compose.yml` passou a montar `./dados:/app/dados`.
- Criado `scripts/cnefe-regression.ts` e `npm run test:cnefe`.

Fonte CNEFE:

https://www.ibge.gov.br/estatisticas/sociais/populacao/38734-cadastro-nacional-de-enderecos-para-fins-estatisticos.html

## Fase 5 - Polish final

- README reescrito em pt-BR com descricao real do app, quick start, Docker, provedores, CNEFE, uso justo do Nominatim e testes.
- `.env.example` refeito sem boilerplate AI Studio/Gemini e com as envs das fases 1-4.
- UI adicionou painel discreto de provedores/cotas consumindo `GET /api/geocode/providers`.
- Tabela passou a exibir badge de fonte em linhas com endereco associado.
- `TabelaView.tsx` foi reduzido com extracao de componentes de trechos e poligonos.
- `App.tsx` teve header/footer extraidos para `src/components/AppChrome.tsx`.
- `kmlParser.ts` teve helpers puros extraidos para `src/kmlGeometry.ts`, `src/kmlMetadata.ts` e `src/kmlAddress.ts`, mantendo reexports para compatibilidade.
- Relatorios `FASE1..FASE4-RELATORIO.md` foram consolidados neste arquivo.

Validacao da Fase 5:

- `npm.cmd run lint`: passou (`tsc --noEmit`).
- `npm.cmd run build`: passou; Vite manteve aviso de chunk acima de 500 kB.
- `npm.cmd run test:precision`: passou (`precision regression passed`).
- `git grep -n "console\.log" -- src server.ts`: nenhum `console.log` residual encontrado.
- `git grep -c "^" -- src`: todos os arquivos em `src/` abaixo de 800 linhas totais (`App.tsx` 770, `TabelaView.tsx` 781, `kmlParser.ts` 684).
- `git diff --check`: passou; apenas avisos LF -> CRLF do Git.

Validacao no host (pos-sessao do Codex):

- Todas as suites rodaram no host e passaram: `test:precision`, `test:providers`, `test:cache`, `test:trechos`, `test:cnefe`, `test:upload`, `test:export`, `test:pericial`, alem de `lint` e `build`.
- Nota: dentro do sandbox do Codex os scripts `tsx` nao iniciavam (`CreateProcessAsUserW failed: 5`); a validacao final foi feita fora do sandbox.

## Fase 6B - Frontend: APIs, navegacao e sessoes

- Criado painel global de configuracoes em `src/components/SettingsPanel.tsx`, aberto pela engrenagem do header.
- O painel consome `GET /api/config`, salva via `POST /api/config`, preserva chaves nao alteradas com `__KEEP__`, permite limpar campos com string vazia e nao grava chaves no `localStorage`.
- Adicionados testes por provedor via `POST /api/config/test/:provider`, com retorno visual de sucesso/erro e mensagem real do backend.
- Adicionada cadeia de provedores reordenavel, toggles de ViaCEP/cross-check e `stepMeters` dos trechos.
- Criado fluxo global de sessoes em `src/components/SessionManager.tsx`, com salvar estado atual, listar, abrir e excluir sessoes via `/api/sessions`.
- Header passou a ter botoes de configuracoes, abrir/salvar sessao, Novo arquivo com confirmacao e indicador discreto de alteracoes nao salvas.
- Criada navegacao de fluxo em `src/components/WorkflowNav.tsx`, com Voltar e breadcrumb Upload / Tabela / Download.
- Extraidas `GeocodeControlBar` e `WorkspaceTabs` para manter `App.tsx` menor e isolar controles de navegacao/geocodificacao.
- Tabela de pontos passou a exibir selos de granularidade e selo `verificado` quando ha fonte externa e `necessita_revisao=false`.

Validacao da Fase 6B:

- `npm.cmd run lint`: passou (`tsc --noEmit`).
- `npm.cmd run build`: passou; Vite manteve o aviso conhecido de chunk acima de 500 kB.

## Fase 6A - Backend config runtime e sessoes

- Criado `src/runtimeConfig.ts` para resolver config runtime sem auto-persistir defaults no boot, mascarar chaves em `GET /api/config`, aceitar `__KEEP__` em `POST /api/config` e gerar snapshot de env para a cadeia de geocoding.
- Decisao de precedencia: `dados/config.json` guarda apenas overrides explicitamente enviados via `POST /api/config`; campos ausentes ou strings vazias legadas caem para `.env`/defaults, enquanto `null` no JSON significa limpeza explicita do usuario e bloqueia fallback para `.env`.
- Criado `src/sessionStore.ts` para CRUD de sessoes em `dados/sessoes`, com slug seguro, limite de 100 MB e bloqueio de path traversal.
- `server.ts` passou a expor `GET/POST /api/config`, `POST /api/config/test/:provider` e `POST/GET/DELETE /api/sessions`, usando a config runtime nas chamadas de geocoding sem reiniciar.
- `POST /api/geocode/trechos` passou a usar `stepMeters` da config runtime quando o request nao informar valor.
- Criado contrato curto para o frontend em `docs/API-CONFIG.md`.
- Criado `scripts/config-and-sessions-regression.ts` e `npm run test:config`.

Validacao esperada da Fase 6A:

- `npm.cmd run test:config`
- `npm.cmd run lint`
- `npm.cmd run build`
