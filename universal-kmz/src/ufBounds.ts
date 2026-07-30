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
