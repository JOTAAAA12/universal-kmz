import { EnderecoConsulta } from '../types';
import { GeocodeProvider } from './types';

export function generateMockAddress(lat: number, lng: number): EnderecoConsulta {
  const hashVal = Math.abs(Math.sin(lat) * Math.cos(lng) * 100000);
  const streetNum = Math.floor(hashVal % 1500) + 12;

  const streets = [
    'Avenida Paulista', 'Rua Augusta', 'Rua XV de Novembro', 'Avenida Brasil',
    'Rua das Palmeiras', 'Rua Bahia', 'Avenida Getulio Vargas', 'Rua Marechal Deodoro',
    'Avenida Atlantica', 'Rua Sete de Setembro', 'Alameda Santos', 'Rua Vergueiro'
  ];

  const neighborhoods = [
    'Bela Vista', 'Consolacao', 'Centro', 'Jardins', 'Copacabana', 'Pinheiros',
    'Botafogo', 'Vila Mariana', 'Moema', 'Butanta', 'Santana', 'Ipanema'
  ];

  const cities = [
    { city: 'Sao Paulo', uf: 'SP', cep: '01310-100' },
    { city: 'Rio de Janeiro', uf: 'RJ', cep: '22020-001' },
    { city: 'Belo Horizonte', uf: 'MG', cep: '30110-002' },
    { city: 'Curitiba', uf: 'PR', cep: '80010-010' },
    { city: 'Porto Alegre', uf: 'RS', cep: '90010-000' },
    { city: 'Salvador', uf: 'BA', cep: '40010-000' }
  ];

  const streetIdx = Math.floor(hashVal) % streets.length;
  const neighIdx = Math.floor(hashVal / 3) % neighborhoods.length;
  const cityIdx = Math.floor(hashVal / 7) % cities.length;

  const st = streets[streetIdx];
  const nh = neighborhoods[neighIdx];
  const ctDetail = cities[cityIdx];
  const formatAddress = `${st}, ${streetNum} - ${nh}, ${ctDetail.city} - ${ctDetail.uf}, ${ctDetail.cep}, Brasil`;
  const roundedLat = lat.toFixed(5);
  const roundedLng = lng.toFixed(5);

  return {
    consulta_id: `MOCK-${roundedLat}-${roundedLng}`,
    latitude: lat,
    longitude: lng,
    coordenada_normalizada: `${roundedLat},${roundedLng}`,
    endereco_formatado: formatAddress,
    logradouro: st,
    numero: String(streetNum),
    bairro: nh,
    subdistrito: '',
    distrito: '',
    municipio: ctDetail.city,
    uf: ctDetail.uf,
    cep: ctDetail.cep,
    pais: 'Brasil',
    place_id: `ChIJ_mock_place_${roundedLat.replace('.', '')}_${roundedLng.replace('.', '')}`,
    plus_code: `87JC8P${Math.floor((lat + 90) * 100).toString(16)}`,
    status_api: 'Mocked',
    quantidade_resultados: 1,
    fonte: 'mock',
    cache_hit: false,
    necessita_revisao: true
  };
}

export const mockProvider: GeocodeProvider = {
  name: 'mock',
  isEnabled: request => request.allowMock,
  reverse: async request => generateMockAddress(request.lat, request.lng)
};
