# Gerenciador de bases CNEFE — plano de implementação

**Goal:** Cobertura CNEFE nacional gerenciável pelo front — detectar UF sem cobertura ao abrir um KMZ, oferecer download com tamanho e espaço livre, sinalizar versão desatualizada e administrar retenção por UF.

**Architecture:** Estende o que já existe. A detecção de UF usa caixas delimitadoras estáticas (sem dado novo). A versão de cada UF baixada fica num `versoes-uf.json` no diretório CNEFE, escrito pelo downloader (evita migração de schema no SQLite de 6,4 GB). A checagem de atualização é um `HEAD` por UF comparado com esse arquivo. Nenhum download ocorre sem confirmação.

**Tech Stack:** TypeScript, Node 24, node:sqlite, Express, React 19, Tailwind 4. Sem dependência nova.

## Global Constraints

- Sem dependência externa nova.
- `src/ufBounds.ts` é compartilhado com o browser: proibido `node:*`.
- Mensagens ao usuário em pt-BR.
- Sem `console.log` novo.
- Imutabilidade: nunca mutar objeto recebido.
- Nenhum download ou reingestão sem ação explícita do usuário.
- Todo teste novo entra no encadeamento de `npm test` (hoje 12 regressões).

---

### Task 1: Detecção de UF por coordenada

**Files:**
- Create: `src/ufBounds.ts`
- Create: `scripts/uf-bounds-regression.ts`
- Modify: `package.json` (script `test:ufbounds`, encadear em `scripts/run-all-tests.ts`)
- Modify: `scripts/run-all-tests.ts` (incluir `uf-bounds` na lista)

**Interfaces:**
- Produces: `detectUfs(coords: { lat: number; lng: number }[]): string[]` — siglas de UF candidatas, ordenadas alfabeticamente, sem repetição. Coordenada fora do Brasil não contribui.
- Produces: `UF_BOUNDS: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import assert from 'node:assert';
import { detectUfs, UF_BOUNDS } from '../src/ufBounds';

assert.equal(Object.keys(UF_BOUNDS).length, 27);

// Interior de SP (centro de São Paulo capital)
assert.deepEqual(detectUfs([{ lat: -23.5505, lng: -46.6333 }]), ['SP']);

// Interior do DF (Brasília) — DF é pequeno e fica dentro de GO
const df = detectUfs([{ lat: -15.7939, lng: -47.8828 }]);
assert.ok(df.includes('DF'), 'DF deve ser detectado em Brasília');

// Divisa: deve sugerir mais de uma candidata, nunca menos
const divisa = detectUfs([{ lat: -22.9, lng: -44.6 }]); // divisa RJ/SP/MG
assert.ok(divisa.length >= 2, 'divisa deve sugerir múltiplas UFs');

// Fora do Brasil
assert.deepEqual(detectUfs([{ lat: 48.85, lng: 2.35 }]), []);

// Lote com UFs repetidas devolve sem duplicata e ordenado
const lote = detectUfs([
  { lat: -23.5505, lng: -46.6333 },
  { lat: -23.6, lng: -46.7 },
  { lat: -12.97, lng: -38.51 } // Salvador/BA
]);
assert.deepEqual(lote, [...new Set(lote)].sort());
assert.ok(lote.includes('SP') && lote.includes('BA'));

console.log('uf bounds regression passed');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/uf-bounds-regression.ts`
Expected: FAIL — `Cannot find module '../src/ufBounds'`

- [ ] **Step 3: Implementar**

```ts
export interface UfBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Caixas envolventes das 27 UFs. Deliberadamente generosas: em divisa duas caixas
// se sobrepõem e ambas as UFs são sugeridas. Sugerir a mais é aceitável (o usuário
// confirma cada download); sugerir a menos deixaria pontos sem cobertura.
export const UF_BOUNDS: Record<string, UfBox> = {
  // preencher com as 27 caixas (minLat, maxLat, minLng, maxLng)
};

export function detectUfs(coords: { lat: number; lng: number }[]): string[] {
  const found = new Set<string>();
  for (const { lat, lng } of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    for (const [uf, box] of Object.entries(UF_BOUNDS)) {
      if (lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng) {
        found.add(uf);
      }
    }
  }
  return [...found].sort();
}
```

As caixas devem vir dos limites oficiais aproximados de cada UF, com folga de ~0,1°. O DF fica contido em GO — ambas serão sugeridas em Brasília, o que é correto.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/uf-bounds-regression.ts`
Expected: `uf bounds regression passed`

- [ ] **Step 5: Commit**

```bash
git add src/ufBounds.ts scripts/uf-bounds-regression.ts scripts/run-all-tests.ts package.json
git commit -m "feat: deteccao de UF por caixa delimitadora para sugerir download CNEFE"
```

---

### Task 2: Registrar a versão de cada UF baixada

**Files:**
- Modify: `src/cnefeDownloader.ts`
- Modify: `scripts/cnefe-downloader-regression.ts`

**Interfaces:**
- Consumes: `CnefePartMeta { etag?: string; lastModified?: string }` (já existe).
- Produces: `readUfVersions(dir: string): Promise<Record<string, { etag?: string; lastModified?: string; baixadoEm: string }>>`
- Produces: efeito — ao concluir ingestão de uma UF, gravar sua entrada em `<CNEFE_DIR>/versoes-uf.json`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `scripts/cnefe-downloader-regression.ts`, seguindo o padrão de servidor falso já usado no arquivo:

```ts
// Após um download+ingestão bem-sucedido de uma UF fake, a versão fica registrada.
const versoes = await readUfVersions(tmpDir);
assert.ok(versoes.RR, 'UF ingerida deve ter versao registrada');
assert.equal(versoes.RR.etag, '"abc123"');
assert.ok(versoes.RR.baixadoEm, 'deve registrar data do download');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/cnefe-downloader-regression.ts`
Expected: FAIL — `readUfVersions is not a function`

- [ ] **Step 3: Implementar**

```ts
const UF_VERSIONS_FILE = 'versoes-uf.json';

export interface CnefeUfVersion {
  etag?: string;
  lastModified?: string;
  baixadoEm: string;
}

export async function readUfVersions(dir: string): Promise<Record<string, CnefeUfVersion>> {
  try {
    const raw = await readFile(path.join(dir, UF_VERSIONS_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUfVersion(dir: string, uf: string, meta: CnefePartMeta, agora: string) {
  const atual = await readUfVersions(dir);
  const proximo = {
    ...atual,
    [uf.toUpperCase()]: {
      ...(meta.etag ? { etag: meta.etag } : {}),
      ...(meta.lastModified ? { lastModified: meta.lastModified } : {}),
      baixadoEm: agora
    }
  };
  await writeFile(path.join(dir, UF_VERSIONS_FILE), JSON.stringify(proximo, null, 2), 'utf8');
}
```

Chamar `writeUfVersion` no ponto em que a ingestão de uma UF conclui com sucesso (mesmo bloco que hoje remove o zip), usando o meta obtido no download. Um arquivo corrompido é tratado como vazio — nunca derruba o boot.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/cnefe-downloader-regression.ts`
Expected: `cnefe downloader regression passed`

- [ ] **Step 5: Commit**

```bash
git add src/cnefeDownloader.ts scripts/cnefe-downloader-regression.ts
git commit -m "feat: registrar ETag e data da versao de cada UF CNEFE ingerida"
```

---

### Task 3: Checagem de atualização por UF

**Files:**
- Modify: `src/cnefeDownloader.ts`
- Modify: `scripts/cnefe-downloader-regression.ts`

**Interfaces:**
- Consumes: `readUfVersions` (Task 2), `CNEFE_BASE_URL`, `CNEFE_STATES`.
- Produces: `checkUfUpdates(ufs: string[], dir: string, fetchFn?: typeof fetch): Promise<Record<string, { atualizacaoDisponivel: boolean; versaoLocal: string | null }>>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// ETag igual -> sem atualização
let head = { etag: '"abc123"' };
let r = await checkUfUpdates(['RR'], tmpDir, fakeHeadFetch(() => head));
assert.equal(r.RR.atualizacaoDisponivel, false);

// ETag diferente -> atualização disponível
head = { etag: '"novo999"' };
r = await checkUfUpdates(['RR'], tmpDir, fakeHeadFetch(() => head));
assert.equal(r.RR.atualizacaoDisponivel, true);

// Servidor indisponível -> sem selo e sem exceção
r = await checkUfUpdates(['RR'], tmpDir, async () => { throw new Error('offline'); });
assert.equal(r.RR.atualizacaoDisponivel, false);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/cnefe-downloader-regression.ts`
Expected: FAIL — `checkUfUpdates is not a function`

- [ ] **Step 3: Implementar**

```ts
export async function checkUfUpdates(
  ufs: string[],
  dir: string,
  fetchFn: FetchLike = fetch
): Promise<Record<string, { atualizacaoDisponivel: boolean; versaoLocal: string | null }>> {
  const versoes = await readUfVersions(dir);
  const entradas = await Promise.all(ufs.map(async uf => {
    const chave = uf.toUpperCase();
    const local = versoes[chave];
    if (!local) return [chave, { atualizacaoDisponivel: false, versaoLocal: null }] as const;
    try {
      const resposta = await fetchFn(zipUrlForUf(chave), { method: 'HEAD' });
      const remoto = metaFromResponse(resposta);
      const iguais = metaMatches(local, remoto);
      return [chave, {
        atualizacaoDisponivel: iguais === false,
        versaoLocal: local.baixadoEm
      }] as const;
    } catch {
      // Offline ou IBGE fora do ar: não sinaliza nada.
      return [chave, { atualizacaoDisponivel: false, versaoLocal: local.baixadoEm }] as const;
    }
  }));
  return Object.fromEntries(entradas);
}
```

`metaFromResponse` e `metaMatches` já existem no arquivo (linhas ~119 e ~134). `metaMatches` devolve `null` quando não há dado suficiente para comparar — nesse caso não se sinaliza atualização.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/cnefe-downloader-regression.ts`
Expected: `cnefe downloader regression passed`

- [ ] **Step 5: Commit**

```bash
git add src/cnefeDownloader.ts scripts/cnefe-downloader-regression.ts
git commit -m "feat: checagem de atualizacao de UF CNEFE por HEAD sem baixar dados"
```

---

### Task 4: Expor atualização e retenção na API

**Files:**
- Modify: `server.ts` (rotas `/api/cnefe/*`, hoje nas linhas ~503-556)
- Modify: `scripts/config-and-sessions-regression.ts`

**Interfaces:**
- Consumes: `checkUfUpdates` (Task 3), `getCnefeIndexedUfStats` (existente).
- Produces: `GET /api/cnefe/estados` passa a incluir por item `atualizacao_disponivel: boolean`, `versao_local: string | null`, `linhas: number`.
- Produces: `GET /api/cnefe/atualizacoes` → `{ [uf: string]: { atualizacao_disponivel: boolean; versao_local: string | null } }`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
const estados = await getJson(`${base}/api/cnefe/estados`);
assert.ok(Array.isArray(estados));
assert.ok('atualizacao_disponivel' in estados[0], 'listagem deve trazer selo de atualizacao');
assert.ok('versao_local' in estados[0], 'listagem deve trazer versao local');

const atualizacoes = await getJson(`${base}/api/cnefe/atualizacoes`);
assert.equal(typeof atualizacoes, 'object');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx scripts/config-and-sessions-regression.ts`
Expected: FAIL — chave `atualizacao_disponivel` ausente

- [ ] **Step 3: Implementar**

Na rota que monta a lista de estados, cruzar as três fontes já disponíveis:

```ts
app.get('/api/cnefe/estados', async (_req, res) => {
  try {
    const [estados, stats] = await Promise.all([
      downloadManager.listStates(),
      getCnefeIndexedUfStats()
    ]);
    const indexadas = estados.filter(e => e.estado === 'pronto').map(e => e.uf);
    const updates = await checkUfUpdates(indexadas, resolveCnefeDir());
    const porUf = new Map(stats.map(s => [s.uf.toUpperCase(), s]));
    res.json(estados.map(estado => ({
      ...estado,
      linhas: porUf.get(estado.uf.toUpperCase())?.rows ?? 0,
      atualizacao_disponivel: updates[estado.uf.toUpperCase()]?.atualizacaoDisponivel ?? false,
      versao_local: updates[estado.uf.toUpperCase()]?.versaoLocal ?? null
    })));
  } catch (error) {
    res.status(500).json({ error: 'Falha ao listar estados CNEFE.' });
  }
});
```

Adicionar a rota `GET /api/cnefe/atualizacoes` chamando `checkUfUpdates` para as UFs indexadas. A checagem falha em silêncio (Task 3), então a listagem nunca quebra por falta de rede.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx scripts/config-and-sessions-regression.ts`
Expected: `config and sessions regression passed`

- [ ] **Step 5: Commit**

```bash
git add server.ts scripts/config-and-sessions-regression.ts
git commit -m "feat: API expoe selo de atualizacao e linhas indexadas por UF"
```

---

### Task 5: Gerenciador com selo, versão e total ocupado

**Files:**
- Modify: `src/components/CnefeManager.tsx`

**Interfaces:**
- Consumes: `GET /api/cnefe/estados` com `atualizacao_disponivel`, `versao_local`, `linhas` (Task 4); `GET /api/cnefe/disco` (existente).

- [ ] **Step 1: Estender o tipo local**

```ts
interface CnefeEstado {
  // campos existentes...
  linhas?: number;
  atualizacao_disponivel?: boolean;
  versao_local?: string | null;
}
```

- [ ] **Step 2: Selo e ação de atualizar**

Para cada UF com `estado === 'pronto'`:
- exibir `linhas` formatado e `versao_local` como data legível (`toLocaleDateString('pt-BR')`);
- quando `atualizacao_disponivel`, exibir um selo âmbar "Atualização disponível" com `role="status"`;
- botão "Atualizar" que dispara `POST /api/cnefe/estados/:uf/download` (a rota já rebaixa e reingere), com confirmação em texto informando que a reingestão leva minutos.

No topo do painel, somar `linhas` de todas as UFs prontas e exibir junto do espaço livre que já vem de `/api/cnefe/disco`.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npx vite build`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/CnefeManager.tsx
git commit -m "feat: gerenciador CNEFE mostra versao, selo de atualizacao e total indexado"
```

---

### Task 6: Aviso de UF sem cobertura ao abrir um KMZ

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/CoberturaAviso.tsx`

**Interfaces:**
- Consumes: `detectUfs` (Task 1), `GET /api/cnefe/estados` (Task 4).
- Produces: componente `CoberturaAviso` com props `{ ufsAusentes: { uf: string; nome: string; tamanho: string | null }[]; espacoLivre: string; onBaixar: (uf: string) => void; onDispensar: () => void }`.

- [ ] **Step 1: Detectar após o parse**

Ao concluir o upload e obter `ParserResult`, coletar as coordenadas dos pontos e chamar `detectUfs`. Cruzar com a listagem de `/api/cnefe/estados` para achar as UFs detectadas cujo `estado !== 'pronto'`.

- [ ] **Step 2: Exibir o aviso**

`CoberturaAviso` lista cada UF ausente com o tamanho real do arquivo (campo `tamanho_estimado`, já presente em `CnefeStateInfo`) e o espaço livre. Dois caminhos:
- **Baixar** enfileira via `POST /api/cnefe/estados/:uf/download` e acompanha pelo progresso já existente; ao concluir, os pontos sem endereço são regeocodificados pelo fluxo de jobs atual.
- **Dispensar** fecha o aviso; os pontos daquela UF seguem pela cadeia de reserva e a tabela os mantém sinalizados como sem cobertura CNEFE.

Nenhum download parte sem clique. O aviso é dispensável e não bloqueia a análise.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npx vite build`
Expected: exit 0

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npm test`
Expected: todas as regressões `ok`, incluindo `uf-bounds`

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/CoberturaAviso.tsx
git commit -m "feat: avisar UF sem cobertura CNEFE ao abrir KMZ, com tamanho e espaco livre"
```
