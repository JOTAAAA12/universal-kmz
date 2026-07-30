import assert from 'node:assert';
import { detectUfs, UF_BOUNDS } from '../src/ufBounds';

assert.equal(Object.keys(UF_BOUNDS).length, 27);

// As 27 capitais devem resolver para EXATAMENTE a sua UF. A caixa envolvente
// sozinha sugeria estados vizinhos (Goiânia trazia MG junto); o polígono da
// malha do IBGE é o que torna a sugestão exata.
const capitais: [string, number, number, string][] = [
  ['Sao Paulo', -23.5505, -46.6333, 'SP'], ['Rio de Janeiro', -22.9068, -43.1729, 'RJ'],
  ['Belo Horizonte', -19.9167, -43.9345, 'MG'], ['Salvador', -12.9777, -38.5016, 'BA'],
  ['Manaus', -3.119, -60.0217, 'AM'], ['Porto Alegre', -30.0346, -51.2177, 'RS'],
  ['Recife', -8.0476, -34.877, 'PE'], ['Brasilia', -15.7939, -47.8828, 'DF'],
  ['Boa Vista', 2.8235, -60.6758, 'RR'], ['Cuiaba', -15.6014, -56.0979, 'MT'],
  ['Belem', -1.4558, -48.4902, 'PA'], ['Florianopolis', -27.5954, -48.548, 'SC'],
  ['Fortaleza', -3.7319, -38.5267, 'CE'], ['Goiania', -16.6869, -49.2648, 'GO'],
  ['Rio Branco', -9.9754, -67.8249, 'AC'], ['Macapa', 0.0389, -51.0664, 'AP'],
  ['Palmas', -10.184, -48.3336, 'TO'], ['Sao Luis', -2.5307, -44.3068, 'MA'],
  ['Teresina', -5.0892, -42.8019, 'PI'], ['Natal', -5.7945, -35.211, 'RN'],
  ['Joao Pessoa', -7.1195, -34.845, 'PB'], ['Maceio', -9.6498, -35.7089, 'AL'],
  ['Aracaju', -10.9472, -37.0731, 'SE'], ['Vitoria', -20.3155, -40.3128, 'ES'],
  ['Curitiba', -25.4284, -49.2733, 'PR'], ['Campo Grande', -20.4697, -54.6201, 'MS'],
  ['Porto Velho', -8.7612, -63.9004, 'RO']
];

for (const [nome, lat, lng, esperada] of capitais) {
  assert.deepEqual(detectUfs([{ lat, lng }]), [esperada], `${nome} deve resolver apenas para ${esperada}`);
}

// Ponto litorâneo: a costa é o caso que a simplificação da malha quebra.
// O centro do Rio caía no mar com a malha "intermediaria" e voltava RJ+MG.
assert.deepEqual(detectUfs([{ lat: -22.9068, lng: -43.1729 }]), ['RJ'], 'ponto litorâneo não pode vazar para a UF vizinha');

// Fora do Brasil não sugere nada.
assert.deepEqual(detectUfs([{ lat: 48.85, lng: 2.35 }]), []);

// Coordenada inválida é ignorada sem quebrar.
assert.deepEqual(detectUfs([{ lat: Number.NaN, lng: -46.6 }]), []);

// Lote com repetição devolve sem duplicata e ordenado.
const lote = detectUfs([
  { lat: -23.5505, lng: -46.6333 },
  { lat: -23.6, lng: -46.7 },
  { lat: -12.97, lng: -38.51 }
]);
assert.deepEqual(lote, ['BA', 'SP']);

// Divisa exata entre estados: pode sugerir mais de um, nunca nenhum.
const divisa = detectUfs([{ lat: -22.9, lng: -44.6 }]);
assert.ok(divisa.length >= 1, 'divisa deve sugerir ao menos uma UF');

console.log('uf bounds regression passed');
