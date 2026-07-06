# Plano: Modo Pericial KMZ/KML

## Fase 1 - Contrato puro

- Criar estado retomavel em `.codex/state/orchestrator-state.json`.
- Criar PRD, spec, plano, tasks, harness e eval.
- Criar `src/pericialMode.ts`.
- Criar fixture e harness de parse.
- Validar com `test:pericial:parse`, `test:precision` e `lint`.

## Fase 2 - Exportacao pericial

- Adicionar manifesto pericial ao ZIP.
- Adicionar abas periciais ao XLSX ou workbook dedicado.
- Validar que os exports atuais nao regrediram.

## Fase 3 - Interface

- Expor modo pericial como opcao clara.
- Mostrar pendencias oficiais e bloqueios metodologicos.
- Evitar linguagem de conclusao pericial final.

## Fase 4 - Markdown e DOCX

- Gerar Markdown tecnico.
- Adicionar DOCX real somente com dependencia aprovada.
- Manter DOCX ausente como feature pendente explicita ate implementacao.

## Fase 5 - Fontes oficiais

- Aceitar camada oficial fornecida pelo usuario.
- Depois, se aprovado, implementar loader oficial.
- Nunca substituir base oficial por fonte comercial ou colaborativa sem rotulo.

## Fase 6 - Docker e smoke

- Rebuild Docker.
- Validar `/`, upload pericial, geocode fail-closed e export.
