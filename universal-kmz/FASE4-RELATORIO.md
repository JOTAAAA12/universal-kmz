# Fase 4 - Precisão Brasil

## Entregas

- Provedor offline `cnefe` criado em `src/providers/cnefe.ts`.
- Índice local CNEFE criado em `src/cnefeIndex.ts`, com leitura CSV em streaming, parser tolerante a `;`, aspas e cabeçalhos alternativos.
- `GEOCODER_CHAIN` passa a aceitar `cnefe` como item da cadeia, por exemplo `cnefe,google,nominatim,photon,bigdatacloud`.
- `ZERO_RESULTADOS` não encerra a cadeia quando houver próximo provedor habilitado.
- `GET /api/geocode/providers` expõe `linhas_indexadas`, `indice_parcial` e `mensagens` quando `cnefe` está na cadeia.
- Validador ViaCEP criado em `src/providers/viacep.ts` e aplicado no servidor quando `VIACEP_VALIDATION=true`.
- Cross-check opt-in criado em `src/geocoder.ts` via `GEOCODE_CROSSCHECK=true`, com no máximo uma consulta extra ao próximo provedor.
- `docker-compose.yml` atualizado com `CNEFE_DIR`, `VIACEP_VALIDATION`, `GEOCODE_CROSSCHECK` e volume `./dados:/app/dados`.
- Regressão offline criada em `scripts/cnefe-regression.ts` e script `npm run test:cnefe`.

## CNEFE local

Baixe os CSVs do CNEFE Censo 2022 no site do IBGE:

https://www.ibge.gov.br/estatisticas/sociais/populacao/38734-cadastro-nacional-de-enderecos-para-fins-estatisticos.html

Coloque um ou mais arquivos `.csv` descompactados em:

```text
dados/cnefe/
```

Ou defina:

```text
CNEFE_DIR=/caminho/para/cnefe
```

Arquivos `.csv.gz` não são lidos diretamente nesta fase, porque não foi adicionada dependência de gzip. Descompacte antes de iniciar o servidor.

## Variáveis

```text
GEOCODER_CHAIN=cnefe,google,nominatim,photon,bigdatacloud
CNEFE_DIR=./dados/cnefe
CNEFE_MAX_ROWS=3000000
VIACEP_VALIDATION=false
GEOCODE_CROSSCHECK=false
```

## Comportamento

- O CNEFE busca o vizinho mais próximo em até 150 m.
- Até 30 m: `granularidade=CNEFE_ALTA` e `necessita_revisao=false`.
- De 30 m a 150 m: `granularidade=CNEFE_MEDIA` e `necessita_revisao=true`.
- Sem match em 150 m: `ZERO_RESULTADOS`, permitindo fallback para o próximo provedor.
- Se `CNEFE_MAX_ROWS` for atingido, o índice fica parcial e a mensagem aparece no relatório de providers.
- ViaCEP divergente em município/UF marca `necessita_revisao=true` e preenche `observacao_validacao`.
- Falha de rede ViaCEP é ignorada e não derruba a geocodificação.
- Cross-check concordante remove `necessita_revisao`; divergente preserva o primeiro resultado e anota a divergência.

## Validação prevista

Com o runner Node/npm disponível:

```text
npm run lint
npm run build
npm run test:cnefe
npm run test:precision
npm run test:providers
npm run test:cache
npm run test:trechos
npm run test:upload
npm run test:export
npm run test:pericial
```
