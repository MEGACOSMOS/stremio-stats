// Confirma que todas as línguas têm todos os textos (bun scripts/testar-linguas.mjs):
// as mesmas chaves que o português, listas com o tamanho certo, e frases que
// não saem com "undefined" nem "NaN".
import { textos, LINGUAS, linguaDe } from '../public/textos.js';

const base = textos('pt');
// Ferramentas com argumentos próprios (datas, códigos…), testadas à parte mais abaixo.
const FERRAMENTAS = new Set(['mesAno', 'dataLonga', 'genero', 'pais', 'periodo', 'hora', 'noDia', 'numero', 'decimal']);
const TAMANHOS = { c_vazio: 4, c_painel: 5, c_sessao: 6, ordens: 4, csv_colunas: 9, meses: 12, mesesCurtos: 12, dias: 7, diasCurtos: 7, periodos: 4 };
let falhas = 0;
const falha = (l, msg) => { falhas++; console.log(`FALHA [${l}] ${msg}`); };

for (const l of Object.keys(LINGUAS)) {
  const t = textos(l);
  if (t.lingua !== l) falha(l, `textos('${l}') devolveu ${t.lingua}`);
  for (const [chave, valor] of Object.entries(base)) {
    if (FERRAMENTAS.has(chave)) continue;
    const v = t[chave];
    if (v === undefined) { falha(l, `falta "${chave}"`); continue; }
    if (typeof valor !== typeof v) { falha(l, `"${chave}" é ${typeof v}, devia ser ${typeof valor}`); continue; }
    const textosDe = typeof v === 'function'
      ? [v(1, '1'), v(3, '3'), v(22, '22'), v(1234, '1 234')]
      : Array.isArray(v) ? v : [v];
    for (const x of textosDe.flat()) {
      if (typeof x === 'string' && (/undefined|NaN|\[object/.test(x) || !x.trim()) && chave !== 'ext_exemplo') {
        falha(l, `"${chave}" dá "${x}"`);
      }
    }
    if (TAMANHOS[chave] && v.length !== TAMANHOS[chave]) falha(l, `"${chave}" tem ${v.length} elementos, devia ter ${TAMANHOS[chave]}`);
  }
  if (/undefined/.test(t.mesAno('2026-03') + t.mesAno('2026-12', true) + t.dataLonga(Date.UTC(2026, 8, 12), 'Europe/Lisbon'))) falha(l, 'datas com falhas');
  for (let d = 0; d < 7; d++) if (!t.noDia(d)) falha(l, `noDia(${d}) vazio`);
  for (const h of [3, 9, 15, 22]) if (!t.periodo(h) || !t.hora(h)) falha(l, `hora/período ${h} vazio`);
  if (t.genero('Drama') === undefined || t.genero('Sci-Fi') === 'Sci-Fi' && !['en', 'pl'].includes(l)) falha(l, `géneros por traduzir`);
  if (t.pais('Soviet Union') === 'Soviet Union' && l !== 'en') falha(l, 'países antigos por traduzir');
  if (!t.pais('Germany') || t.pais('Germany') === 'Germany' && l !== 'en') falha(l, `país não traduzido: ${t.pais('Germany')}`);
  console.log(`${l.padEnd(2)} ${LINGUAS[l].padEnd(22)} ${t.filmes(1)} · ${t.filmes(3)} · ${t.filmes(25)} · ${t.vezes(2)} · ${t.decada(1990)} · ${t.noDia(4)} · ${t.genero('Comedy')} · ${t.pais('Germany')} · ${t.mesAno('2026-03')}`);
}

// Reconhecer a língua do navegador.
for (const [etiqueta, esperado] of [['pt-BR', 'br'], ['pt-PT', 'pt'], ['pt', 'pt'], ['de-AT', 'de'], ['nl-BE', 'nl'], ['pl', 'pl'], ['tr-TR', 'tr'], ['ru-RU', 'pt']]) {
  const obtido = linguaDe(etiqueta);
  if (obtido !== esperado) falha(etiqueta, `linguaDe deu ${obtido}, devia dar ${esperado}`);
}

console.log(falhas ? `\n${falhas} falha(s)` : `\nTudo certo (${Object.keys(LINGUAS).length} línguas)`);
process.exit(falhas ? 1 : 0);
