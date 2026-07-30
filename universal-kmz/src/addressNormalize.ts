const STREET_TOKEN_ALIASES: Record<string, string> = {
  r: 'rua',
  rua: 'rua',
  av: 'avenida',
  avenida: 'avenida',
  pca: 'praca',
  praca: 'praca',
  rod: 'rodovia',
  rodovia: 'rodovia',
  tv: 'travessa',
  travessa: 'travessa',
  al: 'alameda',
  alameda: 'alameda',
  estr: 'estrada',
  estrada: 'estrada',
  lgo: 'largo',
  largo: 'largo',
  dr: 'doutor',
  doutor: 'doutor',
  prof: 'professor',
  professor: 'professor',
  pe: 'padre',
  padre: 'padre',
  cel: 'coronel',
  coronel: 'coronel',
  sto: 'santo',
  santo: 'santo',
  sta: 'santa',
  santa: 'santa'
};

const NUMBER_TOKENS: Record<string, string> = {
  zero: '0',
  um: '1',
  uma: '1',
  dois: '2',
  duas: '2',
  tres: '3',
  quatro: '4',
  cinco: '5',
  seis: '6',
  sete: '7',
  oito: '8',
  nove: '9',
  dez: '10',
  onze: '11',
  doze: '12',
  treze: '13',
  catorze: '14',
  quatorze: '14',
  quinze: '15',
  dezesseis: '16',
  dezessete: '17',
  dezoito: '18',
  dezenove: '19',
  vinte: '20',
  primeiro: '1',
  primeira: '1',
  segundo: '2',
  segunda: '2',
  terceiro: '3',
  terceira: '3',
  quarto: '4',
  quarta: '4',
  quinto: '5',
  quinta: '5',
  sexto: '6',
  sexta: '6',
  setimo: '7',
  setima: '7',
  oitavo: '8',
  oitava: '8',
  nono: '9',
  nona: '9',
  decimo: '10',
  decima: '10',
  vigesimo: '20',
  vigesima: '20'
};

const COMPOUND_ORDINALS: Record<string, string> = {
  'decimo primeiro': '11',
  'decima primeira': '11',
  'decimo segundo': '12',
  'decima segunda': '12',
  'decimo terceiro': '13',
  'decima terceira': '13',
  'decimo quarto': '14',
  'decima quarta': '14',
  'decimo quinto': '15',
  'decima quinta': '15',
  'decimo sexto': '16',
  'decima sexta': '16',
  'decimo setimo': '17',
  'decima setima': '17',
  'decimo oitavo': '18',
  'decima oitava': '18',
  'decimo nono': '19',
  'decima nona': '19'
};

const CONNECTIVES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

const UF_BY_NAME: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO'
};

const UF_CODES = new Set(Object.values(UF_BY_NAME));

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d+)[ºª]/gu, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function replaceCompoundOrdinals(value: string): string {
  return Object.entries(COMPOUND_ORDINALS).reduce(
    (normalized, [ordinal, number]) => normalized.replace(new RegExp(`\\b${ordinal}\\b`, 'gu'), number),
    value
  );
}

export function normalizeStreetTokens(value: string): string[] {
  const normalized = replaceCompoundOrdinals(normalizeText(value));
  return normalized
    .split(' ')
    .map(token => STREET_TOKEN_ALIASES[token] || NUMBER_TOKENS[token] || token)
    .filter(token => token && !CONNECTIVES.has(token));
}

export function normalizeUf(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (UF_BY_NAME[normalized]) return UF_BY_NAME[normalized];

  const compact = normalized.replace(/\s/g, '').toUpperCase();
  return UF_CODES.has(compact) ? compact : normalized.toUpperCase();
}

export function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeStreetTokens(a));
  const bTokens = new Set(normalizeStreetTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function addressesLikelyEqual(a: string, b: string, threshold = 0.7): boolean {
  return tokenSimilarity(a, b) >= threshold;
}
