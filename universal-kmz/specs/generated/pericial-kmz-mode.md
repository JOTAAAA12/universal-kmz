# Spec: Modo Pericial KMZ/KML

## Contrato

O Modo Pericial e uma camada derivada sobre `ParserResult`.

Entrada:

- `ParserResult`
- metadados opcionais do projeto
- indicador explicito de disponibilidade de bases oficiais

Saida:

- resumo pericial
- evidencias normalizadas
- comparacoes declarado versus calculado
- registros de localizacao
- pendencias criticas
- bloqueios metodologicos
- resumo QA

## Fronteiras

- Nao altera `ParserResult`.
- Nao chama Google Maps.
- Nao baixa bases oficiais.
- Nao altera `server.ts`.
- Nao altera UI na fatia 1.

## Fonte oficial

Sem camada oficial carregada, o sistema deve marcar municipio oficial, recortes transmunicipais e endereco oficial como pendentes.

## Modelo de execucao continuada

`dev-orchestrator` seleciona a proxima task em `specs/tasks/pericial-kmz-mode.md`.

`autocode` executa a menor fatia pronta, usando:

- maestro caro para decisao e integracao;
- modelos baratos para leitura, fixtures e patches pequenos;
- Spark para detalhes de TypeScript, comandos e regressao.
