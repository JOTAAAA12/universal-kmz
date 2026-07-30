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
