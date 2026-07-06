# Empacotamento Windows

## Fase 8C - Electron

O Universal KMZ agora tem um shell Electron que reaproveita o backend Express e o frontend React existentes. O shell inicia o bundle `dist/server.cjs` em um processo filho, aguarda a porta local responder e abre a interface em `http://127.0.0.1:<PORT>`.

## Fluxo de desenvolvimento do shell

1. Instale as dependencias novas quando necessario:

```powershell
npm.cmd install
```

2. Gere o frontend e o bundle do servidor:

```powershell
npm.cmd run build
```

3. Abra o shell Electron apontando para o build local:

```powershell
npm.cmd run electron:dev
```

O script `electron:dev` nao roda Vite em modo watch. Ele espera que `npm.cmd run build` ja tenha criado `dist/index.html` e `dist/server.cjs`.

## Gerar instaladores

No host Windows, rode:

```powershell
npm.cmd run dist
```

O script executa `npm run build && electron-builder`. Os artefatos saem em `release/`, incluindo alvo NSIS instalavel e versao portable.

## Dados do usuario

O instalador nao empacota `dados/`. A aplicacao instalada inicia sem CNEFE local e o usuario baixa as UFs pela ferramenta da Fase 8B.

No Windows, os dados gravaveis ficam na raiz `userData` do Electron, definida pelo nome do app `Universal KMZ`:

```text
%APPDATA%\Universal KMZ
```

Dentro dessa raiz ficam `config.json`, `sessoes/`, cache de geocodificacao e a subpasta:

```text
%APPDATA%\Universal KMZ\cnefe
```

A subpasta `cnefe` recebe `*.sqlite`, `*.csv`, downloads parciais e arquivos extraidos dos estados CNEFE.

## Assinatura e SmartScreen

Os binarios gerados por `electron-builder` nao estao assinados nesta fase. O Windows SmartScreen pode mostrar alerta de aplicativo desconhecido ate que exista assinatura de codigo e reputacao do publicador.

## Icone

Existe um placeholder em `electron/icon.svg` para o shell. Para distribuicao final, substitua por uma identidade visual definitiva e, se o `electron-builder` do host exigir formato ICO no alvo Windows, gere `electron/icon.ico` a partir do SVG e ajuste `build.win.icon` em `package.json`.
