import assert from 'node:assert';
import { normalizarEstadosCnefe, ufsSemCobertura } from '../src/cnefeCobertura';
import { detectUfs } from '../src/ufBounds';

// A rota devolve o envelope { estados: [...] }, nunca um array puro.
// Esse desembrulho já foi esquecido uma vez no CnefeManager — fica travado aqui.
const respostaReal = {
  estados: [
    { cod: '35', uf: 'SP', nome: 'Sao Paulo', estado: 'pronto', tamanho_estimado: '~1 GB zip', linhas: 22_900_000 },
    { cod: '29', uf: 'BA', nome: 'Bahia', estado: 'ausente', tamanho_estimado: null, linhas: 0 }
  ]
};

const estados = normalizarEstadosCnefe(respostaReal);
assert.equal(estados.length, 2, 'envelope { estados } deve ser desembrulhado');
assert.equal(estados[0].uf, 'SP');
assert.equal(estados[0].estado, 'pronto');

// Um array puro (ou lixo) nunca pode derrubar a tela.
assert.equal(normalizarEstadosCnefe(respostaReal.estados).length, 2);
assert.deepEqual(normalizarEstadosCnefe(null), []);
assert.deepEqual(normalizarEstadosCnefe({ estados: 'nao é lista' }), []);

// UF detectada e ausente vira aviso, com nome e tamanho vindos da API.
const ausentes = ufsSemCobertura(['SP', 'BA'], estados);
assert.equal(ausentes.length, 1, 'apenas a UF sem cobertura entra no aviso');
assert.equal(ausentes[0].uf, 'BA');
assert.equal(ausentes[0].nome, 'Bahia');
assert.equal(ausentes[0].tamanho, null);

// Todas as UFs prontas => nenhum aviso.
assert.deepEqual(ufsSemCobertura(['SP'], estados), []);

// KMZ sem coordenada válida => nenhuma UF detectada => nenhum aviso.
const semCoordenada = detectUfs([{ lat: NaN, lng: NaN }, { lat: 0, lng: 0 }]);
assert.deepEqual(semCoordenada, []);
assert.deepEqual(ufsSemCobertura(semCoordenada, estados), []);

// UF desconhecida pela API (nunca listada) conta como ausente — sugerir a mais é aceitável.
const desconhecida = ufsSemCobertura(['RR'], estados);
assert.equal(desconhecida.length, 1);
assert.equal(desconhecida[0].nome, 'RR');

console.log('cnefe cobertura regression passed');
