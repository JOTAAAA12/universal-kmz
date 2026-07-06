# API de Configuracao e Sessoes

## Config runtime

`GET /api/config` retorna a configuracao ativa. Chaves sensiveis voltam mascaradas
com os 4 primeiros e 3 ultimos caracteres; valor vazio volta como `""`.

Campos:

- `googleServerKey`, `locationiqKey`, `geoapifyKey`
- `nominatimEmail`
- `geocoderChain`
- `viacepValidation`
- `geocodeCrosscheck`
- `stepMeters`

`POST /api/config` aceita body parcial. Para campos de chave, envie `"__KEEP__"`
para preservar o valor atual sem conhecer a chave completa; envie `""` para limpar.
Tipos invalidos retornam `400 { "error": "..." }`. A config e persistida em
`dados/config.json` e aplicada imediatamente nas proximas chamadas de geocoding.

`POST /api/config/test/:provider` testa um reverse geocode fixo em
`-23.5614,-46.6559` somente no provedor indicado. Resposta:
`{ ok, status, mensagem, endereco_resumido? }`. Para `cnefe`, inclui
`linhas_indexadas`.

## Sessoes

`POST /api/sessions` com `{ nome, payload }` salva o payload JSON opaco em
`dados/sessoes/<slug>-<timestamp>.json`, ate 100 MB. Retorna
`{ id, nome, criado_em, tamanho_bytes }`.

`GET /api/sessions` lista sessoes por data desc:
`{ id, nome, criado_em, tamanho_bytes }[]`.

`GET /api/sessions/:id` retorna `{ id, nome, criado_em, payload }`.

`DELETE /api/sessions/:id` remove a sessao e retorna `204`.

IDs aceitam apenas `[a-z0-9-]`; tentativa de path traversal retorna 400.

