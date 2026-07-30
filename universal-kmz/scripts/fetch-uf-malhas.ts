/**
 * Baixa as malhas (polígonos) das 27 UFs do IBGE e grava em src/data/ufMalhas.json.
 * Ferramenta de desenvolvimento: roda sob demanda, o resultado é versionado.
 * Uso: npx tsx scripts/fetch-uf-malhas.ts
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CNEFE_STATES } from '../src/cnefeDownloader';

// "maxima" preserva a linha de costa. Na "intermediaria" a simplificação corta
// baías (o centro do Rio caía no mar) e o ponto ficava fora do próprio estado.
const QUALIDADE = 'maxima';
const DESTINO = path.resolve(process.cwd(), 'src', 'data', 'ufMalhas.json');

type Anel = [number, number][];

function extrairAneis(geojson: any): Anel[] {
  const aneis: Anel[] = [];
  const geometrias = geojson?.type === 'FeatureCollection'
    ? geojson.features.map((f: any) => f.geometry)
    : [geojson?.geometry ?? geojson];

  for (const geometria of geometrias) {
    if (!geometria) continue;
    if (geometria.type === 'Polygon') {
      // Só o anel externo: buracos internos não mudam a decisão de "está nesta UF".
      aneis.push(geometria.coordinates[0] as Anel);
    } else if (geometria.type === 'MultiPolygon') {
      for (const poligono of geometria.coordinates) {
        aneis.push(poligono[0] as Anel);
      }
    }
  }
  return aneis;
}

function arredondar(aneis: Anel[]): Anel[] {
  // 4 casas decimais ≈ 11 m: precisão muito além do necessário para decidir a UF,
  // e corta o arquivo pela metade.
  return aneis.map(anel => anel.map(([lng, lat]) => [
    Number(lng.toFixed(4)),
    Number(lat.toFixed(4))
  ] as [number, number]));
}

async function main() {
  const resultado: Record<string, Anel[]> = {};

  for (const estado of CNEFE_STATES) {
    const url = `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${estado.uf}` +
      `?formato=application/vnd.geo+json&qualidade=${QUALIDADE}`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!resposta.ok) throw new Error(`IBGE devolveu ${resposta.status} para ${estado.uf}`);
    const aneis = arredondar(extrairAneis(await resposta.json()));
    if (aneis.length === 0) throw new Error(`Nenhum polígono para ${estado.uf}`);
    resultado[estado.uf] = aneis;
    process.stdout.write(`${estado.uf}: ${aneis.length} anel(is), ${aneis.reduce((s, a) => s + a.length, 0)} vértices\n`);
  }

  await writeFile(DESTINO, JSON.stringify(resultado), 'utf8');
  process.stdout.write(`gravado em ${DESTINO}\n`);
}

main().catch(error => {
  process.stderr.write(`falha: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
