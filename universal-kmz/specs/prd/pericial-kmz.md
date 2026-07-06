# PRD: Modo Pericial KMZ/KML

## Objetivo

Transformar o prompt pericial KMZ/KML em uma funcionalidade auditavel do Leitor KMZ, preservando o comportamento atual de leitura, geocodificacao e exportacao.

## Escopo da primeira entrega

- Receber o `ParserResult` ja produzido pelo app.
- Gerar uma analise pericial pura, sem chamada externa e sem mutar o resultado original.
- Classificar evidencias por origem.
- Registrar bloqueios quando bases oficiais nao estiverem disponiveis.
- Criar harness automatizado para validar o contrato inicial.

## Fora de escopo nesta fatia

- Interseccao real com limites municipais oficiais.
- Geocodificacao real com credenciais.
- DOCX final.
- Roteamento de diligencia por API externa.
- Mudancas de UI e backend de upload.

## Regras de evidencia

Cada informacao deve declarar uma origem:

- `ORIGINAL_KML_KMZ`
- `DOCUMENTO_FORNECIDO`
- `BASE_OFICIAL`
- `CALCULADO_GEOESPACIAL`
- `INFERIDO_DO_NOME`
- `INFERIDO_OPERACIONAL`
- `PENDENTE_DE_CAMPO`
- `FONTE_AUXILIAR_NAO_OFICIAL`

Google Maps e outras fontes comerciais podem apoiar a diligencia, mas nao devem ser promovidas a fonte oficial.

## Criterios de aceite

- A funcao pericial aceita `ParserResult` e retorna um objeto deterministico.
- ExtendedData do KML aparece como evidencia `ORIGINAL_KML_KMZ`.
- Comprimentos, areas e coordenadas calculadas aparecem como `CALCULADO_GEOESPACIAL`.
- Ausencia de bases oficiais gera pendencia critica.
- O harness `test:pericial:parse` passa sem rede, credenciais ou Docker.
- Os gates existentes `test:precision` e `lint` continuam passando.

## Stop conditions

- Qualquer tentativa de inventar municipio, CEP, numero predial ou aceite de obra bloqueia a entrega.
- Qualquer fallback silencioso para mock geocoding bloqueia a entrega.
- Qualquer regressao em parser/export/geocoder existente bloqueia a entrega.
