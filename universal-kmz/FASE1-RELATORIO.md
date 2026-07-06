# Fase 1 - Geocoder multi-provedor

## Arquivos criados

- `src/providers/types.ts`: contrato comum, throttle, timeout com `AbortController`, helpers de mapeamento e falhas.
- `src/providers/google.ts`: lógica Google movida para provedor plugável.
- `src/providers/nominatim.ts`: Nominatim com `User-Agent`, `NOMINATIM_EMAIL`, throttle 1 req/s e mapeamento OSM.
- `src/providers/photon.ts`: Photon com throttle 1 req/s.
- `src/providers/locationiq.ts`: LocationIQ condicionado a `LOCATIONIQ_API_KEY`, throttle 2 req/s.
- `src/providers/geoapify.ts`: Geoapify condicionado a `GEOAPIFY_API_KEY`, throttle 5 req/s.
- `src/providers/bigdatacloud.ts`: fallback sem chave, sempre aproximado e com revisão.
- `src/providers/mock.ts`: mock preservado, habilitado apenas quando permitido.
- `scripts/provider-chain-regression.ts`: regressão offline para fallback, skip por chave ausente e fixture Nominatim.

## Arquivos alterados

- `src/geocoder.ts`: agora orquestra `GEOCODER_CHAIN`, cache, cooldown de 60s, contadores por provedor e fallback automático.
- `server.ts`: adicionada rota `GET /api/geocode/providers` e validação por cadeia habilitada, não mais somente por chave Google.
- `docker-compose.yml`: expõe `GEOCODER_CHAIN`, `LOCATIONIQ_API_KEY`, `GEOAPIFY_API_KEY` e `NOMINATIM_EMAIL`.
- `package.json`: adiciona `npm run test:providers`.
- `scripts/precision-regression.ts`: fixa cadeia Google/mock nos testes legados para continuar offline.

## Decisões

- Cadeia padrão sem `GEOCODER_CHAIN`: `google,nominatim,photon,bigdatacloud`.
- Com `GEOCODER_MODE=mock` ou mock explícito sem cadeia configurada, a cadeia vira `mock`.
- Provedores sem chave válida são pulados silenciosamente.
- Falhas retryable, HTTP 429 e timeout colocam o provedor em cooldown por 60s e avançam para o próximo.

## Como testar

```bash
npm run lint
npm run test:providers
npx tsx scripts/precision-regression.ts
```
