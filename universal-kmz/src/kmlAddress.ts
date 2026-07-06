import { extractExtendedData, extractFromHtmlOrText } from './kmlMetadata';

export function extractAddressFromPlacemark(pl: any, name: string): {
  endereco_formatado?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  pais?: string;
  origem_endereco?: 'Original' | 'Geocoding API' | 'Manual' | 'Carregado' | 'Indisponível';
  status_api?: 'PENDENTE' | 'SUCESSO' | 'ZERO_RESULTS' | 'FALHA' | 'Mocked';
} {
  const extDict = extractExtendedData(pl.ExtendedData);
  let descDict: Record<string, string> = {};
  if (pl.description) {
    descDict = extractFromHtmlOrText(String(pl.description));
  }

  const combinedDict: Record<string, string> = { ...descDict, ...extDict };
  const cleanKey = (k: string): string => k.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '')
    .trim();

  const normDict: Record<string, string> = {};
  for (const [k, v] of Object.entries(combinedDict)) {
    normDict[cleanKey(k)] = String(v).trim();
  }

  const logradouroKeys = [
    'logradouro', 'logr', 'rua', 'avenida', 'street', 'streetname', 'street_name', 'nomederua', 'nome_rua', 'via', 'nomelogr', 'nome_logr', 'enderecologradouro', 'endereco_logradouro'
  ];
  const numeroKeys = ['numero', 'nro', 'nr', 'number', 'streetnum', 'street_num', 'numimovel', 'num_imovel', 'num'];
  const bairroKeys = ['bairro', 'sublocality', 'neighborhood', 'barr', 'bair', 'bairronome', 'bairro_nome', 'subloc'];
  const municipioKeys = ['municipio', 'cidade', 'city', 'localidade', 'mun', 'cidadenome', 'cidade_nome', 'municipios'];
  const ufKeys = ['uf', 'estado', 'state', 'siglauf', 'sigla_uf', 'est', 'estnome', 'est_nome'];
  const cepKeys = ['cep', 'zip', 'postalcode', 'postal_code', 'zipcode', 'zip_code'];
  const fullAddrKeys = [
    'endereco', 'endereço', 'address', 'enderecocompleto', 'endereco_completo', 'fulladdress', 'full_address', 'ender', 'descr_completa', 'endereco_completo_original'
  ];

  let logradouro = '';
  let numero = '';
  let bairro = '';
  let municipio = '';
  let uf = '';
  let cep = '';
  let endereco_formatado = '';
  const pais = 'Brasil';

  for (const k of logradouroKeys) if (normDict[k]) { logradouro = normDict[k]; break; }
  for (const k of numeroKeys) if (normDict[k]) { numero = normDict[k]; break; }
  for (const k of bairroKeys) if (normDict[k]) { bairro = normDict[k]; break; }
  for (const k of municipioKeys) if (normDict[k]) { municipio = normDict[k]; break; }
  for (const k of ufKeys) if (normDict[k]) { uf = normDict[k]; break; }
  for (const k of cepKeys) if (normDict[k]) { cep = normDict[k]; break; }
  for (const k of fullAddrKeys) if (normDict[k]) { endereco_formatado = normDict[k]; break; }

  for (const [k, v] of Object.entries(normDict)) {
    if (!logradouro && (k.includes('rua') || k.includes('logradouro') || k.includes('avenida') || k.includes('street') || k.includes('logr'))) logradouro = String(v);
    if (!numero && (k.includes('numero') || k === 'num' || k === 'nro' || k === 'nr' || k === 'number' || k.includes('num_'))) numero = String(v);
    if (!bairro && (k.includes('bairro') || k.includes('neighborhood') || k.includes('bair'))) bairro = String(v);
    if (!municipio && (k.includes('municipio') || k.includes('cidade') || k.includes('city') || k === 'mun')) municipio = String(v);
    if (!uf && (k === 'uf' || k.includes('estado') || k === 'state')) uf = String(v);
    if (!cep && (k === 'cep' || k.includes('zip') || k.includes('postal'))) cep = String(v);
    if (!endereco_formatado && (k.includes('endereco') || k.includes('address') || k === 'ender')) endereco_formatado = String(v);
  }

  if (pl.address) {
    endereco_formatado = String(pl.address).trim();
  }

  if (name && !logradouro) {
    const prefixRegex = /^(Rua|Avenida|Travessa|Alameda|Estrada|Rodovia|Praça|Viela|Av\.?|R\.?|Al\.?|Trv\.?|Pç\.?|Rod\.?|Estr\.?)\s+([^,]+)(?:,\s*(\d+|s\/n|S\/N))?(?:\s*-\s*(.+))?$/i;
    const match = prefixRegex.exec(name.trim());
    if (match) {
      logradouro = `${match[1]} ${match[2]}`.trim();
      if (match[3]) numero = match[3].trim();
      if (match[4]) {
        const parts = match[4].trim().split(/[,-]/);
        if (parts.length > 0) bairro = parts[0].trim();
        if (parts.length > 1) municipio = parts[1].trim();
      }
    }
  }

  if (!endereco_formatado && (logradouro || bairro || cep)) {
    const parts = [];
    if (logradouro) parts.push(numero ? `${logradouro}, ${numero}` : logradouro);
    if (bairro) parts.push(bairro);
    if (municipio) parts.push(uf ? `${municipio} - ${uf}` : municipio);
    else if (uf) parts.push(uf);
    if (cep) parts.push(cep);
    endereco_formatado = parts.join(' - ');
  }

  const hasAddressDetail = Boolean(endereco_formatado || logradouro || numero || bairro || cep);
  const hasAnyAddressMetadata = Boolean(hasAddressDetail || municipio || uf);

  if (hasAnyAddressMetadata) {
    return {
      endereco_formatado: hasAddressDetail ? endereco_formatado || undefined : undefined,
      logradouro: logradouro || undefined,
      numero: numero || undefined,
      bairro: bairro || undefined,
      municipio: municipio || undefined,
      uf: uf || undefined,
      cep: cep || undefined,
      pais,
      origem_endereco: hasAddressDetail ? 'Carregado' : 'Original',
      status_api: hasAddressDetail ? 'SUCESSO' : 'PENDENTE'
    };
  }

  return {};
}
