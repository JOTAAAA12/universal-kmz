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

Os logs do servidor embutido ficam em:

```text
%APPDATA%\Universal KMZ\logs\servidor.log
```

Se o servidor local encerrar depois da abertura, o shell tenta reiniciá-lo uma única vez e recarrega a janela. Se o novo processo não iniciar ou encerrar novamente, o aplicativo exibe uma mensagem em português, preserva esse log e encerra.

## Chaves e imagem Docker

Não passe chaves Google em `docker build`, `--build-arg` nem `build.args`: valores usados nessa fase podem permanecer no histórico das camadas. A imagem é construída sem chaves; injete somente as variáveis necessárias na execução, por exemplo pelo bloco `environment` do `docker-compose.yml` ou por um gerenciador de segredos do ambiente.

```powershell
docker compose up --build
```

Para geocodificação real, injete `GOOGLE_MAPS_SERVER_KEY` em runtime e restrinja-a ao serviço/IP que executa o backend, habilitando somente a Geocoding API. Não use essa chave no navegador. A chave de Maps JavaScript é pública por natureza, deve ser separada da chave server-side e limitada à Maps JavaScript API; enquanto a tela ainda não a lê de `GET /api/config`, informe-a pelo próprio app em vez de embuti-la no instalador.

O `docker-compose.yml` atual ainda declara `build.args` para a chave e o Map ID. Como este arquivo está fora desta lane, remova esse bloco numa alteração coordenada; o `Dockerfile` já não os consome.

## Assinatura e SmartScreen

Os binarios gerados por `electron-builder` nao estao assinados nesta fase. O Windows SmartScreen pode mostrar alerta de aplicativo desconhecido ate que exista assinatura de codigo e reputacao do publicador.

Para a distribuição Windows, use um certificado de assinatura de código mantido no cofre de segredos do pipeline, nunca no repositório. No job de release, disponibilize o certificado ao `electron-builder` por `CSC_LINK` e a senha por `CSC_KEY_PASSWORD`, gere o instalador e o portátil, e valide a assinatura antes de publicar:

```powershell
Get-ChildItem '.\release\*.exe' -File | ForEach-Object {
  Get-AuthenticodeSignature -FilePath $_.FullName
}
```

Cada resultado deve retornar `Status : Valid` e o certificado deve pertencer ao publicador esperado. Produza também hashes SHA-256 junto aos binários e confira-os antes da instalação:

```powershell
$artefatos = Get-ChildItem '.\release\*.exe' -File
foreach ($artefato in $artefatos) {
  $hash = Get-FileHash -LiteralPath $artefato.FullName -Algorithm SHA256
  "$($hash.Hash.ToLower())  $($artefato.Name)" | Set-Content -NoNewline -Encoding ascii -LiteralPath "$($artefato.FullName).sha256"
}

Get-FileHash -LiteralPath $artefatos[0].FullName -Algorithm SHA256
Get-Content -LiteralPath "$($artefatos[0].FullName).sha256"
```

Compare os valores antes de distribuir ou instalar. Publique os arquivos `.sha256` no mesmo release dos binários.

## Auto-update (decisão de infraestrutura pendente)

Não há atualização automática nesta versão. Para adotá-la, a decisão de publicação deve definir um repositório/releases autenticados ou um endpoint HTTPS estável que hospede `latest.yml`, os instaladores e os arquivos de bloco gerados pelo `electron-builder`.

Depois da decisão, a lane responsável por `package.json` deve:

1. Adicionar `electron-updater` em `dependencies` (não em `devDependencies`).
2. Incluir em `build.publish` o provedor escolhido, por exemplo:

```json
{
  "provider": "generic",
  "url": "https://downloads.exemplo.com/universal-kmz"
}
```

3. No `app.whenReady()` de `electron/main.cjs`, importar `autoUpdater` de `electron-updater` e, somente com `app.isPackaged`, chamar `autoUpdater.checkForUpdatesAndNotify()` com captura de erro no log `%APPDATA%\Universal KMZ\logs\servidor.log`.
4. No pipeline assinado, publicar atômica e conjuntamente o instalador, o portátil, `latest.yml`, os arquivos `.blockmap` e hashes SHA-256; testar upgrade e rollback no Windows antes do primeiro release público.

Não adicione `electron-updater` sem essas definições: a dependência e `build.publish` pertencem à lane dona de `package.json`.

## Icone

Existe um placeholder em `electron/icon.svg` para o shell. Para distribuicao final, substitua por uma identidade visual definitiva e, se o `electron-builder` do host exigir formato ICO no alvo Windows, gere `electron/icon.ico` a partir do SVG e ajuste `build.win.icon` em `package.json`.
