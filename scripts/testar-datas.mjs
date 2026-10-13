// Testa a data atribuída a cada filme (bun scripts/testar-datas.mjs).
// Cada caso é uma pequena biblioteca no formato da API do Stremio.
import { lerBiblioteca, resumoBase, partes } from '../public/estatisticas.js';

const filme = (id, lastWatched, extra = {}) => ({
  _id: id, name: id, type: 'movie', _mtime: '2026-10-01T00:00:00Z',
  state: { lastWatched, timesWatched: 1, flaggedWatched: 1, duration: 6e6, overallTimeWatched: 6e6, ...extra },
});
const minutos = (base, m) => new Date(Date.parse(base) + m * 60000).toISOString();

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ordenar = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
  const ok = JSON.stringify(ordenar(obtido)) === JSON.stringify(ordenar(esperado));
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${ok ? '' : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}
const datas = (itens, fuso = 'Europe/Lisbon') => {
  const { vistos } = lerBiblioteca(itens);
  return Object.fromEntries(vistos.map((f) => {
    if (!f.quando) return [f.id, null];
    const p = partes(f.quando, fuso);
    return [f.id, `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')} ${p.hora}h`];
  }));
};

// Fuso horário: Lisboa no inverno (UTC+0), no verão (UTC+1), mudança de hora e passagem de ano.
verifica('hora de inverno em Lisboa', datas([filme('a', '2026-01-15T22:30:00Z')]), { a: '2026-01-15 22h' });
verifica('hora de verão em Lisboa', datas([filme('a', '2026-07-15T21:30:00Z')]), { a: '2026-07-15 22h' });
verifica('noite da mudança de hora', datas([filme('a', '2026-03-29T00:30:00Z'), filme('b', '2026-03-29T01:30:00Z')]), { a: '2026-03-29 0h', b: '2026-03-29 2h' });
verifica('passagem de ano em Lisboa', datas([filme('a', '2025-12-31T23:30:00Z')]), { a: '2025-12-31 23h' });
verifica('passagem de ano noutro fuso (Nova Iorque)', datas([filme('a', '2026-01-01T03:30:00Z')], 'America/New_York'), { a: '2025-12-31 22h' });
verifica('depois da meia-noite conta no dia seguinte', datas([filme('a', '2026-05-02T23:10:00Z')]), { a: '2026-05-03 0h' });

// Sem data: campo vazio ou em falta.
verifica('lastWatched vazio fica sem data', datas([filme('a', '')]), { a: null });
verifica('lastWatched em falta fica sem data', datas([filme('a', undefined)]), { a: null });

// Uma sessão de cinema normal: filmes seguidos, com horas de intervalo.
verifica('maratona (2 h entre filmes) fica com datas',
  datas([filme('a', '2026-02-07T16:00:00Z'), filme('b', '2026-02-07T18:10:00Z'), filme('c', '2026-02-07T20:20:00Z')]),
  { a: '2026-02-07 16h', b: '2026-02-07 18h', c: '2026-02-07 20h' });

// Marcados de uma vez (ou importados): datas iguais ou a segundos de distância.
const lote = Array.from({ length: 30 }, (_, i) => filme(`m${i}`, minutos('2026-06-14T10:00:00Z', i * 0.05)));
verifica('30 filmes marcados de uma vez ficam sem data', Object.values(datas(lote)).every((d) => d === null), true);
const importados = Array.from({ length: 5 }, (_, i) => filme(`i${i}`, '2026-06-20T08:00:00Z'));
verifica('5 filmes importados no mesmo segundo ficam sem data', Object.values(datas(importados)).every((d) => d === null), true);

// Acabar um filme e reabrir outro (já visto) pouco depois: o primeiro foi mesmo
// visto àquela hora e não deve perder a data.
verifica('filme acabado + outro reaberto 15 min depois',
  datas([filme('acabado', '2026-04-10T21:00:00Z'), filme('reaberto', '2026-04-10T21:15:00Z', { timeOffset: 120000 })]),
  { acabado: '2026-04-10 22h', reaberto: '2026-04-10 22h' });

// Dois marcados à mão seguidos (segundos de diferença) e três marcados devagar.
verifica('2 filmes marcados com 20 s de diferença ficam sem data',
  datas([filme('a', '2026-08-01T10:00:00Z'), filme('b', '2026-08-01T10:00:20Z')]), { a: null, b: null });
verifica('3 filmes marcados com 5 min entre cada ficam sem data',
  datas([filme('a', '2026-08-02T10:00:00Z'), filme('b', '2026-08-02T10:05:00Z'), filme('c', '2026-08-02T10:10:00Z')]), { a: null, b: null, c: null });

// Um lote no meio de filmes normais não estraga as datas dos outros.
const misto = [filme('antes', '2026-06-13T20:00:00Z'), ...lote, filme('depois', '2026-06-15T21:00:00Z')];
const m = datas(misto);
verifica('lote no meio de filmes normais', [m.antes, m.depois], ['2026-06-13 21h', '2026-06-15 22h']);

// As contas por mês só usam filmes com data.
const r = resumoBase(lerBiblioteca(misto).vistos, { fuso: 'Europe/Lisbon' });
verifica('junho conta só os 2 filmes com data', r.porMes.get('2026-06'), 2);
verifica('os 30 do lote contam como sem data', r.semData, 30);

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
