# Fase 2 - Cache persistente, dedup e jobs

## Implementado

- Cache persistente em `src/geocodeCache.ts`, com chave `lat,lng,language,region` arredondada a 5 casas, diretório configurável por `GEOCODE_CACHE_DIR`, limite `GEOCODE_CACHE_MAX_ITEMS`, flush com debounce/lote e escrita atômica por arquivo temporário + rename.
- `src/geocoder.ts` agora aceita cache por injeção (`GeocodeCacheStore`) e não importa `fs`; o cache em memória segue como fallback quando nenhum cache persistente é injetado.
- Deduplicação espacial de 10 m em `src/geocodeJobs.ts`, usando `getDistanceMeters`, com replicação de resultado por coordenada e `cache_hit: true` nos replicados.
- `/api/geocode` preservada, agora usando o batch deduplicado e o cache persistente injetado.
- Novo modelo de jobs em memória:
  - `POST /api/geocode/jobs`
  - `GET /api/geocode/jobs/:id`
  - `POST /api/geocode/jobs/:id/pause`
  - `POST /api/geocode/jobs/:id/resume`
- UI mínima em `src/App.tsx`: lotes com mais de 20 coordenadas usam jobs, mostram progresso e permitem pausa/retomada.
- Regressão offline em `scripts/cache-and-jobs-regression.ts` e script `npm run test:cache`.

## Validação

Executado com sucesso nesta sessão:

```powershell
npm.cmd run lint
npm.cmd run test:precision
```

Resultado observado:

- `npm.cmd run lint`: passou (`tsc --noEmit`, exit 0).
- `npm.cmd run test:precision`: passou (`precision regression passed`, exit 0).

Comandos que não chegaram a iniciar por bloqueio intermitente do runner Windows (`CreateProcessAsUserW failed: 5`):

```powershell
npm.cmd run test:cache
npm.cmd run test:providers
npm.cmd run test:upload
npm.cmd run test:export
npm.cmd run test:pericial
```
