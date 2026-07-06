# Harness: Modo Pericial KMZ/KML

## Gates da fatia 1

- `npm.cmd run test:pericial:parse`
- `npm.cmd run test:precision`
- `npm.cmd run lint`

## Gates da fatia 2

- `npm.cmd run test:pericial:export`
- `npm.cmd run test:export`
- `npm.cmd run lint`

## Cenario automatizado de exportacao

Fixture: `scripts/fixtures/pericial-referencia.kml`

Expectativas:

- ZIP mantem `dados-normalizados.json`, `features.geojson`, `features.kml`, `processamento-config.json`, `csv/resumo.csv` e XLSX principal.
- ZIP adiciona `pericial/manifesto-pericial.json`.
- Manifesto contem `schema_version` `pericial-kmz/v1`.
- Manifesto preserva evidencia `extended_data.prova_id`.
- Manifesto marca ausencia de base oficial como pendencia e bloqueio.

## Cenario automatizado inicial

Fixture: `scripts/fixtures/pericial-referencia.kml`

Expectativas:

- 2 Placemarks.
- 1 Point.
- 1 LineString.
- 0 Polygon.
- ExtendedData preservado.
- Modo de processamento `PERICIAL`.
- Evidencias de origem original e calculada presentes.
- Bases oficiais ausentes marcadas como pendencia critica.

## Gates futuros

- `test:pericial:official-source-block`
- `test:pericial:future-formats`
- `test:pericial:docker-smoke`

## Regras de seguranca

- Sem rede.
- Sem credenciais.
- Sem mock silencioso.
- Sem fonte comercial tratada como oficial.
