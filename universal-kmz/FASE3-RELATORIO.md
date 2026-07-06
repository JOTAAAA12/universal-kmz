# Fase 3 - Enderecos por trechos e poligonos

## Implementado

- `src/lineSampling.ts`
  - `samplePolyline(coords, stepMeters = 100)` com vertices, interpolacao linear lat/lng, distancia via `getDistanceMeters` e deduplicacao global de pontos a menos de 10 m.
  - `consolidateSegments(samples)` agrupando amostras consecutivas por logradouro normalizado sem acento/caixa.
  - `samplePolygon(anelExterno)` como centroide + vertices, removendo fechamento duplicado do anel.
  - `resolveDominantPolygonAddress(samples)` com moda por logradouro/municipio e confrontantes unicos.
- `src/types.ts`
  - `TrechoEndereco`.
  - `EnderecoPoligono`.
  - Campos opcionais `trechos_endereco` e `enderecos_poligono` em `ParserResult`.
- `POST /api/geocode/trechos`
  - Body: `{ linhas: [{ id, coordenadas }], poligonos: [{ id, anel_externo }], stepMeters? }`.
  - Reusa `geocodeCoordinateBatch` de `src/geocodeJobs.ts` para preservar dedup/cache da Fase 2 e manter a ordem original das amostras.
  - Retorna `trechos_por_linha` e `endereco_por_poligono`.
  - Observacao: nao usei diretamente `GeocodeJobManager` neste endpoint porque o snapshot atual acumula resultados por grupos deduplicados, sem indice original suficiente para remontar amostras por geometria com seguranca.
- UI
  - Botao `Enderecar Trechos` em `TabelaView.tsx`, reaproveitando o estado/progresso visual da geocodificacao existente.
  - Coluna de trechos enderecados nas linhas.
  - Coluna de dominante/confrontantes nos poligonos.
- Exportadores
  - Mantida a aba legada `Trechos`.
  - Adicionada a aba `Trechos_Enderecos` com colunas: `linha_id`, `ordem`, `logradouro`, `numero_inicio`, `numero_fim`, `bairro`, `municipio`, `uf`, `extensao_m`, `amostras`, `necessita_revisao`.
  - GeoJSON inclui `trechos_endereco` e `trechos_endereco_resumo` nas propriedades dos LineString.
  - GeoJSON inclui dominante/confrontantes nos Polygon quando disponivel.
- Teste novo
  - `scripts/trechos-regression.ts`.
  - Script npm `test:trechos`.

## Decisoes de compatibilidade

- A entrega pedia uma nova aba chamada `Trechos`, mas o contrato existente ja tinha uma aba `Trechos` para metadados das linhas. Para nao quebrar o consumidor atual, mantive `Trechos` e adicionei `Trechos_Enderecos`.
- `scripts/export-contract-regression.ts` foi atualizado para esperar a nova aba e o CSV `csv/trechos-enderecos.csv`.

## Validacao executada

- `npm.cmd run lint`: passou.
- `npm.cmd run build`: passou. O Vite manteve o aviso preexistente de chunk acima de 500 kB.
- `npm.cmd run test:precision`: passou.
- `git diff --check`: passou, com avisos de conversao LF -> CRLF no proximo toque do Git.

## Validacao bloqueada

Os demais gates via `tsx` nao foram concluidos nesta sessao porque o sandbox do Windows passou a negar criacao de processo com:

`windows sandbox: runner error: CreateProcessAsUserW failed: 5`

Comandos afetados durante as tentativas:

- `npm.cmd run test:trechos`
- `tsx scripts/trechos-regression.ts`
- `npm.cmd run test:providers`
- `npm.cmd run test:export`

Nao declaro a Fase 3 como totalmente validada enquanto `test:trechos`, `test:providers`, `test:cache`, `test:upload`, `test:export` e `test:pericial` nao rodarem com sucesso nesse host.

## Arquivos alterados

- `package.json`
- `server.ts`
- `src/types.ts`
- `src/lineSampling.ts`
- `src/kmlParser.ts`
- `src/App.tsx`
- `src/components/TabelaView.tsx`
- `src/components/DownloadView.tsx`
- `src/exporters.ts`
- `scripts/trechos-regression.ts`
- `scripts/export-contract-regression.ts`
- `FASE3-RELATORIO.md`
