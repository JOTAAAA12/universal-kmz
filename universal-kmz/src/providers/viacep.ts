interface ViaCepResponse {
  erro?: boolean;
  cep?: string;
  logradouro?: string;
  localidade?: string;
  uf?: string;
}

export interface ViaCepValidationResult {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  data?: ViaCepResponse;
}

const cache = new Map<string, ViaCepResponse | null>();
const TIMEOUT_MS = 5000;

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchViaCep(cep: string): Promise<ViaCepResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as ViaCepResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateCep(
  cep: string | undefined,
  _logradouro: string | undefined,
  municipio: string | undefined,
  uf: string | undefined
): Promise<ViaCepValidationResult> {
  const normalizedCep = onlyDigits(cep || '');
  if (normalizedCep.length !== 8) {
    return { ok: true, skipped: true };
  }
  let data: ViaCepResponse | null;
  if (cache.has(normalizedCep)) {
    data = cache.get(normalizedCep) || null;
  } else {
    data = await fetchViaCep(normalizedCep);
    cache.set(normalizedCep, data);
  }
  if (!data || data.erro) {
    const skipped = { ok: true, skipped: true, data };
    return skipped;
  }

  const expectedMunicipio = normalizeText(municipio || '');
  const actualMunicipio = normalizeText(data.localidade || '');
  const expectedUf = (uf || '').trim().toUpperCase();
  const actualUf = (data.uf || '').trim().toUpperCase();
  const divergences: string[] = [];

  if (expectedMunicipio && actualMunicipio && expectedMunicipio !== actualMunicipio) {
    divergences.push(`município ${municipio} != ${data.localidade}`);
  }
  if (expectedUf && actualUf && expectedUf !== actualUf) {
    divergences.push(`UF ${uf} != ${data.uf}`);
  }

  const result = divergences.length > 0
    ? { ok: false, message: `ViaCEP diverge do resultado: ${divergences.join('; ')}.`, data }
    : { ok: true, data };
  return result;
}
