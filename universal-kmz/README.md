# Universal KMZ

Leitor local de KML/KMZ para inspeção, enriquecimento e exportação de dados geográficos. O app lê pontos, linhas, polígonos e coleções KMZ, preserva metadados do KML, calcula métricas geométricas, extrai endereços por provedores gratuitos e Google, endereça amostras por trecho de linha, roda modo pericial e exporta XLSX, GeoJSON, KML e pacote ZIP.

## O que o app faz

- Lê `.kml` e `.kmz`, incluindo múltiplos KMLs dentro do KMZ.
- Normaliza pontos, linhas, polígonos, MultiGeometry, pastas, descrições e ExtendedData.
- Geocodifica coordenadas por cadeia configurável: CNEFE offline, Google, Nominatim, Photon, LocationIQ, Geoapify, BigDataCloud e mock explícito.
- Deduplica coordenadas, usa cache persistente e pausa/retoma jobs grandes.
- Endereça trechos de linhas por amostragem e consolida logradouros consecutivos.
- Resolve endereço dominante e confrontantes para polígonos.
- Usa modo pericial com trilha de auditoria, hash original e campos de revisão.
- Exporta XLSX, GeoJSON, KML normalizado e ZIP com dados estruturados.

## Quick Start Local

```powershell
npm install
npm run dev
```

Abra `http://localhost:3000`.

Para geocodificação real, copie `.env.example` para `.env` e configure `GEOCODER_CHAIN` e as chaves desejadas. Sem chave paga, uma cadeia comum para testes é:

```env
GEOCODER_CHAIN=cnefe,nominatim,photon,bigdatacloud
NOMINATIM_EMAIL=seu-email@dominio.com
```

## Docker

```powershell
docker compose up --build
```

Por padrão o Compose publica em `http://localhost:3008`. Ajuste com:

```env
KMZ_HOST_PORT=3008
GEOCODER_CHAIN=cnefe,google,nominatim,photon,bigdatacloud
GOOGLE_MAPS_SERVER_KEY=
GOOGLE_MAPS_BROWSER_KEY=
CNEFE_DIR=/app/dados/cnefe
GEOCODE_CACHE_DIR=/app/dados
```

O volume `./dados:/app/dados` guarda CNEFE e cache persistente.

### Segurança

Por padrão, o servidor escuta em `127.0.0.1` (localhost apenas). Para uso em Docker ou rede, configure:

```env
HOST=0.0.0.0
```

No Docker, a variável `HOST` já está definida como `0.0.0.0` no `docker-compose.yml`. Em ambiente local (desenvolvimento), o servidor permanece em `127.0.0.1` por segurança padrão.

## Provedores

| Provedor | Precisa de chave? | Limite gratuito / observação | Variáveis |
| --- | --- | --- | --- |
| CNEFE offline | Não | Ilimitado localmente; depende dos CSVs baixados do IBGE | `GEOCODER_CHAIN`, `CNEFE_DIR`, `CNEFE_MAX_ROWS` |
| Nominatim público | Não | 1 req/s e `User-Agent` obrigatório; não usar para bulk pesado | `GEOCODER_CHAIN`, `NOMINATIM_EMAIL` |
| Photon | Não | Sem chave; uso justo do serviço público | `GEOCODER_CHAIN` |
| LocationIQ | Sim | Aproximadamente 5k chamadas/dia no plano free | `GEOCODER_CHAIN`, `LOCATIONIQ_API_KEY` |
| Geoapify | Sim | Aproximadamente 3k chamadas/dia no plano free | `GEOCODER_CHAIN`, `GEOAPIFY_API_KEY` |
| BigDataCloud | Não | Sem chave; granularidade baixa, sempre exige revisão | `GEOCODER_CHAIN` |
| Google Geocoding | Sim | Aproximadamente 10k chamadas/mês gratuitas no SKU de geocoding, conforme crédito/SKU da conta | `GEOCODER_CHAIN`, `GOOGLE_MAPS_SERVER_KEY` |

Variáveis transversais:

- `VIACEP_VALIDATION`: valida CEP contra ViaCEP quando `true`.
- `GEOCODE_CROSSCHECK`: consulta o próximo provedor para conferir resultados incompletos quando `true`.
- `GEOCODE_CACHE_DIR`: diretório do cache persistente.
- `GEOCODE_CACHE_MAX_ITEMS`: limite de itens em cache.
- `GOOGLE_MAPS_BROWSER_KEY`: chave pública só para o mapa no navegador.
- `GOOGLE_MAPS_MAP_ID`: Map ID opcional para Google Maps.

## CNEFE

Baixe os CSVs do CNEFE Censo 2022 no IBGE:

https://www.ibge.gov.br/estatisticas/sociais/populacao/38734-cadastro-nacional-de-enderecos-para-fins-estatisticos.html

Coloque os `.csv` descompactados em:

```text
dados/cnefe/
```

Ou defina outro diretório:

```env
CNEFE_DIR=/caminho/para/cnefe
```

Arquivos `.csv.gz` devem ser descompactados antes. O app indexa o CNEFE no boot e expõe `linhas_indexadas`, `indice_parcial` e mensagens em `/api/geocode/providers`.

## Uso justo do Nominatim

O Nominatim público não deve ser usado para carga massiva. O app reduz chamadas com deduplicação de coordenadas, cache persistente, cadeia de fallback e throttle de 1 req/s, mas bases grandes devem priorizar CNEFE offline, cache pré-aquecido ou provedor contratado.

## Variáveis principais

Veja `.env.example` para a lista completa das variáveis usadas em runtime.

## Testes

```powershell
npm run lint
npm run build
npm run test:precision
npm run test:providers
npm run test:cache
npm run test:trechos
npm run test:cnefe
npm run test:upload
npm run test:export
npm run test:pericial
```
