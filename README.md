# Universal KMZ

Leitor de KML/KMZ com geocodificação reversa **offline e gratuita** para todo o Brasil, feito para trabalho pericial: transforma um arquivo de geolocalização em relatório Excel com endereços completos, sem depender de API paga.

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

## Baixar

**[⬇️ Baixar a última versão](https://github.com/JOTAAAA12/universal-kmz/releases/latest)** — Windows 64 bits.

| Arquivo | Quando usar |
|---|---|
| `Universal KMZ 1.0.0.exe` | Versão portátil. Não instala nada, é só executar. |
| `Universal KMZ Setup 1.0.0.exe` | Instalador, com atalhos no menu Iniciar e área de trabalho. |

O Windows exibirá um aviso do SmartScreen dizendo que o editor é desconhecido, porque o executável ainda não tem assinatura digital. Clique em **Mais informações** e depois em **Executar assim mesmo**.

## Por que existe

Geocodificar milhares de coordenadas custa caro: cada ponto é uma chamada à API paga. Ao mesmo tempo, o IBGE publica o **CNEFE** — o Cadastro Nacional de Endereços para Fins Estatísticos, levantado no Censo 2022 — com mais de 100 milhões de endereços brasileiros com coordenada, de graça.

Este programa usa o CNEFE como fonte primária: baixa a base do estado que você precisa, indexa localmente em SQLite e resolve endereços offline, em milissegundos. São Paulo sozinho são 22,9 milhões de endereços. O Google entra apenas para desenhar o mapa, se você quiser; a geocodificação — que é onde a conta cresce — não sai da sua máquina.

## Integridade pericial

Num laudo, existe diferença jurídica entre "este endereço veio do arquivo original" e "este endereço foi inferido por uma base externa". Um sistema que sobrescreve o primeiro com o segundo em silêncio não enriquece dado: corrompe prova.

O programa trata isso como invariante. Endereço vindo de fonte externa — CNEFE, Google, Nominatim, qualquer uma — **nunca** sobrescreve o endereço original do KML. Ele vira registro separado, marcado para revisão, com o conflito descrito. Divergência de município ou UF é sempre sinalizada. Há teste automatizado que falha se essa regra quebrar.

## O que faz

- Lê `.kml` e `.kmz`, inclusive com múltiplos KMLs dentro do mesmo KMZ, namespaces prefixados e arquivos legados em ISO-8859-1.
- Normaliza pontos, linhas, polígonos, MultiGeometry, pastas, descrições e ExtendedData.
- Geocodifica por cadeia configurável: CNEFE offline, Google, Nominatim, Photon, LocationIQ, Geoapify e BigDataCloud.
- Gerencia as bases do CNEFE por estado pelo próprio app: baixar, atualizar e remover, com espaço em disco à vista e aviso quando o IBGE publica versão nova.
- Avisa quando o arquivo aberto tem pontos num estado sem cobertura, mostrando o tamanho real do download antes de você decidir.
- Endereça trechos de linha por amostragem e consolida logradouros consecutivos; resolve endereço dominante e confrontantes de polígonos.
- Deduplica coordenadas, mantém cache persistente com validade e permite pausar e retomar trabalhos grandes.
- Exporta XLSX, GeoJSON, KML normalizado e pacote ZIP.

## Uso básico

Abra o programa, arraste o arquivo `.kmz` ou `.kml` e escolha o modo de processamento. Se houver pontos num estado sem base indexada, um aviso oferece o download daquele estado — recusar não trava nada: os pontos seguem pelos provedores gratuitos e ficam sinalizados como sem cobertura CNEFE.

O gerenciador de bases fica no painel de configurações, com os 27 estados, quantas linhas cada um tem indexadas e a data da versão local.

Os dados ficam em `%APPDATA%\Universal KMZ`. O servidor embutido escuta apenas em `127.0.0.1` — nada é exposto à rede.

## Rodar a partir do código

Requer Node.js 24 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. Para geocodificação real, copie `.env.example` para `.env` e ajuste a cadeia de provedores. Uma configuração sem custo:

```env
GEOCODER_CHAIN=cnefe,nominatim,photon,bigdatacloud
NOMINATIM_EMAIL=seu-email@dominio.com
```

Docker:

```bash
docker compose up --build
```

Gerar o executável Windows:

```bash
npm run dist
```

## Testes

```bash
npm test
```

São 14 baterias de regressão cobrindo parser, provedores, CNEFE, downloader, cache, jobs, exportação, contratos de API e as invariantes do modo pericial. O CI roda `lint`, `test` e `build` a cada push.

## Tecnologias

TypeScript, Node 24 (com `node:sqlite` embutido, sem dependência nativa), Express, React 19, Vite, Tailwind 4 e Electron.

## Licença

[MIT](LICENSE).

Os dados do CNEFE e as malhas territoriais são do **IBGE**, distribuídos publicamente e sujeitos aos termos do próprio instituto. Este projeto apenas os consome; não os redistribui.
