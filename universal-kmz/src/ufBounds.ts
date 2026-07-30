import ufMalhas from './data/ufMalhas.json';

export interface UfBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Caixas envolventes das 27 UFs, derivadas da malha de UFs do IBGE (2024)
// com folga mínima de 0,1°. Em divisas, caixas sobrepostas sugerem todas as
// UFs candidatas: sugerir a mais é aceitável; omitir uma deixaria sem cobertura.
export const UF_BOUNDS: Record<string, UfBox> = {
  AC: { minLat: -11.246, maxLat: -7.013, minLng: -74.087, maxLng: -66.523 },
  AL: { minLat: -10.601, maxLat: -8.713, minLng: -38.338, maxLng: -35.051 },
  AM: { minLat: -9.919, maxLat: 2.336, minLng: -73.899, maxLng: -55.993 },
  AP: { minLat: -1.337, maxLat: 4.605, minLng: -54.977, maxLng: -49.775 },
  BA: { minLat: -18.449, maxLat: -8.432, minLng: -46.678, maxLng: -37.241 },
  CE: { minLat: -7.959, maxLat: -2.684, minLng: -41.524, maxLng: -37.152 },
  DF: { minLat: -16.15, maxLat: -15.401, minLng: -48.386, maxLng: -47.208 },
  ES: { minLat: -21.402, maxLat: -17.791, minLng: -41.98, maxLng: -28.747 },
  GO: { minLat: -19.599, maxLat: -12.294, minLng: -53.349, maxLng: -45.807 },
  MA: { minLat: -10.362, maxLat: -0.949, minLng: -48.856, maxLng: -41.696 },
  MG: { minLat: -23.023, maxLat: -14.133, minLng: -51.147, maxLng: -39.756 },
  MS: { minLat: -24.169, maxLat: -17.066, minLng: -58.269, maxLng: -50.822 },
  MT: { minLat: -18.142, maxLat: -7.249, minLng: -61.734, maxLng: -50.124 },
  PA: { minLat: -9.942, maxLat: 2.733, minLng: -58.999, maxLng: -45.961 },
  PB: { minLat: -8.403, maxLat: -5.925, minLng: -38.866, maxLng: -34.693 },
  PE: { minLat: -9.583, maxLat: -3.704, minLng: -41.459, maxLng: -32.277 },
  PI: { minLat: -11.029, maxLat: -2.649, minLng: -46.129, maxLng: -40.27 },
  PR: { minLat: -26.818, maxLat: -22.416, minLng: -54.721, maxLng: -47.923 },
  RJ: { minLat: -23.469, maxLat: -20.663, minLng: -44.99, maxLng: -40.857 },
  RN: { minLat: -7.083, maxLat: -4.716, minLng: -38.683, maxLng: -34.868 },
  RO: { minLat: -13.794, maxLat: -7.875, minLng: -66.911, maxLng: -59.674 },
  RR: { minLat: -1.681, maxLat: 5.37, minLng: -64.927, maxLng: -58.787 },
  RS: { minLat: -33.852, maxLat: -26.982, minLng: -57.75, maxLng: -49.591 },
  SC: { minLat: -29.456, maxLat: -25.855, minLng: -53.938, maxLng: -48.227 },
  SE: { minLat: -11.669, maxLat: -9.415, minLng: -38.346, maxLng: -36.295 },
  SP: { minLat: -25.458, maxLat: -19.679, minLng: -53.211, maxLng: -44.061 },
  TO: { minLat: -13.569, maxLat: -5.068, minLng: -50.843, maxLng: -45.599 }
};

type Anel = [number, number][];
const MALHAS = ufMalhas as unknown as Record<string, Anel[]>;

function dentroDoAnel(lat: number, lng: number, anel: Anel): boolean {
  // Ray casting. O anel vem do IBGE como [lng, lat].
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [lngI, latI] = anel[i];
    const [lngJ, latJ] = anel[j];
    const cruza = (latI > lat) !== (latJ > lat) &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

function ufsCandidatasPorCaixa(lat: number, lng: number): string[] {
  return Object.entries(UF_BOUNDS)
    .filter(([, box]) => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng)
    .map(([uf]) => uf);
}

/**
 * UFs candidatas para um conjunto de coordenadas.
 *
 * A caixa envolvente serve de pré-filtro barato; o polígono da UF (malha do IBGE)
 * decide. Sem o polígono, um ponto em Goiânia sugeria também MG só porque as
 * caixas se sobrepõem.
 *
 * Se nenhum polígono contiver o ponto — buraco da simplificação, ponto no mar,
 * coordenada em divisa exata — voltamos às candidatas da caixa. Sugerir a mais é
 * aceitável (o usuário confirma cada download); omitir deixaria pontos sem cobertura.
 */
export function detectUfs(coords: { lat: number; lng: number }[]): string[] {
  const found = new Set<string>();

  for (const { lat, lng } of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const candidatas = ufsCandidatasPorCaixa(lat, lng);
    if (candidatas.length === 0) continue;

    const porPoligono = candidatas.filter(uf =>
      (MALHAS[uf] || []).some(anel => dentroDoAnel(lat, lng, anel)));

    for (const uf of porPoligono.length > 0 ? porPoligono : candidatas) {
      found.add(uf);
    }
  }

  return [...found].sort();
}
