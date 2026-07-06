# Tasks: Modo Pericial KMZ/KML

## Completed

- [x] T1 - Criar contrato puro pericial e harness de parse.
  - Arquivos: `src/pericialMode.ts`, `scripts/harness/pericial-parse-contract.ts`, `scripts/fixtures/pericial-referencia.kml`.
  - Gates: `npm.cmd run test:pericial:parse`, `npm.cmd run test:precision`, `npm.cmd run lint`.

- [x] T2 - Adicionar manifesto pericial ao ZIP sem alterar exports atuais.
  - Arquivos candidatos: `src/exporters.ts`, `scripts/harness/pericial-export-contract.ts`.
  - Gates: `npm.cmd run test:export`, `npm.cmd run test:pericial:parse`, `npm.cmd run lint`.

## Ready

- [ ] T3 - Adicionar Excel pericial inicial com abas exigidas pelo prompt.
  - Arquivos candidatos: `src/exporters.ts`, `scripts/harness/pericial-workbook-contract.ts`.
  - Gates: `npm.cmd run test:export`, `npm.cmd run test:pericial`, `npm.cmd run lint`.

## Pending

- [ ] T4 - Adicionar relatorio Markdown tecnico.
- [ ] T5 - Expor Modo Pericial na UI.
- [ ] T6 - Adicionar endpoint/contrato futuro para DOCX com falha explicita enquanto nao implementado.
- [ ] T7 - Implementar smoke Docker pericial.

## Blocked

- [ ] B1 - Overlay municipal oficial.
  - Motivo: requer base oficial fornecida ou loader oficial aprovado.
- [ ] B2 - Endereco oficial completo.
  - Motivo: requer fonte oficial de logradouros/CEP/cadastro, nao apenas Google.

## Continuation prompt

Quando o usuario disser `seguir`, selecione a primeira task `Ready` nao concluida, valide os arquivos de origem, execute a menor mudanca reversivel e rode os gates da propria task.
