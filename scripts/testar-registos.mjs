// Simula o que o Stremio grava quando alguém vê, revê, interrompe, marca e
// desmarca filmes, e confirma que o painel lê bem cada caso.
// As regras do simulador são as do stremio-core (src/models/player.rs e
// src/types/library/library_item.rs), ramo development, outubro de 2026.
// Correr com: bun scripts/testar-registos.mjs
import { lerBiblioteca } from '../public/estatisticas.js';

const MIN = 60000;
const DUR = 120 * MIN; // filme de 2 h

class Filme {
  constructor(id, { naBiblioteca = true } = {}) {
    this.item = {
      _id: id, name: id, type: 'movie', removed: !naBiblioteca, temp: !naBiblioteca,
      _ctime: '2026-01-01T00:00:00Z',
      state: { lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null },
    };
  }

  // Player: Action::TimeChanged (player.rs ~640-740), um passo de cada vez.
  tempo(agora, t, duracao = DUR) {
    const s = this.item.state;
    s.lastWatched = new Date(agora).toISOString();
    if (s.video_id !== this.item._id) {
      s.video_id = this.item._id;
      s.overallTimeWatched += s.timeWatched;
      s.timeWatched = 0;
      s.flaggedWatched = 0;
    } else {
      const d = Math.max(0, t - s.timeOffset);
      s.timeWatched += d;
      s.overallTimeWatched += d;
    }
    if (t > s.timeOffset) { s.timeOffset = t; s.duration = duracao; }
    if (s.flaggedWatched === 0 && s.duration > 0 && s.timeWatched > s.duration * 0.7) {
      s.flaggedWatched = 1;
      s.timesWatched += 1;
    }
    if (this.item.temp && s.timesWatched === 0) this.item.removed = true;
    if (this.item.removed) this.item.temp = true;
  }

  // Player: Action::Seek — mexe no ponto e na data, não no tempo visto.
  saltar(agora, t) {
    this.item.state.lastWatched = new Date(agora).toISOString();
    this.item.state.timeOffset = t;
  }

  // Fechar o leitor: depois dos créditos (90 %) o ponto volta a 0 (player.rs ~1300).
  fechar() {
    const s = this.item.state;
    if (s.timeOffset > s.duration * 0.9) s.timeOffset = 0;
  }

  // Ver do ponto atual até `ate` (fração), com atualizações a cada 10 s, como a app.
  ver(inicio, ate, { de = null } = {}) {
    let agora = Date.parse(inicio);
    if (de !== null) this.saltar(agora, de * DUR);
    let t = this.item.state.timeOffset;
    this.tempo(agora, t);
    while (t < ate * DUR) {
      t = Math.min(ate * DUR, t + 10000);
      agora += 10000;
      this.tempo(agora, t);
    }
    this.fechar();
    return this;
  }

  // library_item.rs: mark_as_watched(true/false)
  marcar(agora) {
    const s = this.item.state;
    s.timesWatched += 1;
    s.lastWatched = new Date(agora).toISOString();
    s.timeOffset = 0;
    return this;
  }
  desmarcar() { this.item.state.timesWatched = 0; return this; }
  tirarDaBiblioteca() { this.item.removed = true; this.item.temp = false; return this; }
}

let falhas = 0;
function verifica(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${ok ? '' : `\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`}`);
}
// Como o painel vê um filme: visto? quantas vezes? com que data? ficou a meio?
function leitura(filme) {
  const { vistos, porAcabar } = lerBiblioteca([filme.item]);
  const v = vistos[0];
  return v
    ? { visto: true, vezes: v.vezes, data: v.quando && new Date(v.quando).toISOString().slice(0, 16) }
    : { visto: false, aMeio: porAcabar.length === 1 };
}

// 1. Ver um filme até ao fim (os créditos contam): 1 vez, data = quando acabou.
verifica('visto até ao fim',
  leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.97)),
  { visto: true, vezes: 1, data: '2026-03-10T21:56' });

// 2. Parar nos 60 %: não conta como visto, fica a meio.
verifica('parado nos 60 %', leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.6)), { visto: false, aMeio: true });

// 3. Parar nos 75 %: o Stremio já o dá como visto (70 %).
verifica('parado nos 75 %', leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.75)), { visto: true, vezes: 1, data: '2026-03-10T21:30' });

// 4. Ver em duas noites (50 % + 50 %): 1 vez, data da segunda noite.
verifica('visto em duas noites',
  leitura(new Filme('a').ver('2026-03-10T21:00:00Z', 0.5).ver('2026-03-11T21:00:00Z', 0.97)),
  { visto: true, vezes: 1, data: '2026-03-11T21:56' });

// 5. Rever do início um ano depois: o Stremio não soma, mas o painel deve contar 2.
verifica('revisto um ano depois',
  leitura(new Filme('a').ver('2025-03-10T20:00:00Z', 0.97).ver('2026-03-10T20:00:00Z', 0.97, { de: 0 })),
  { visto: true, vezes: 2, data: '2026-03-10T21:56' });

// 6. Visto três vezes.
verifica('visto três vezes',
  leitura(new Filme('a').ver('2024-01-01T20:00:00Z', 0.97).ver('2025-01-01T20:00:00Z', 0.97, { de: 0 }).ver('2026-01-01T20:00:00Z', 0.97, { de: 0 })),
  { visto: true, vezes: 3, data: '2026-01-01T21:56' });

// 7. Visto e depois só uma cena (~10 min): continua 1 vez; a data passa a ser a da cena.
verifica('visto + uma cena depois',
  leitura(new Filme('a').ver('2026-02-01T20:00:00Z', 0.97).ver('2026-05-01T20:00:00Z', 0.5, { de: 0.42 })),
  { visto: true, vezes: 1, data: '2026-05-01T20:09' });

// 8. Visto e depois revisto até metade: 1 vez (meia revisão não conta).
verifica('visto + meia revisão',
  leitura(new Filme('a').ver('2026-02-01T20:00:00Z', 0.97).ver('2026-05-01T20:00:00Z', 0.5, { de: 0 })),
  { visto: true, vezes: 1, data: '2026-05-01T21:00' });

// 9. Saltar para o fim sem ver: não conta como visto.
verifica('saltou para o fim sem ver',
  leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.05).ver('2026-03-10T20:10:00Z', 0.97, { de: 0.95 })),
  { visto: false, aMeio: false });

// 10. Marcado como visto à mão, sem o ver: 1 vez, data = quando marcou.
verifica('marcado à mão',
  leitura(new Filme('a').marcar('2026-04-02T10:00:00Z')),
  { visto: true, vezes: 1, data: '2026-04-02T10:00' });

// 11. Visto e depois DESmarcado: já não é visto (era o erro).
verifica('visto e depois desmarcado',
  leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.97).desmarcar()),
  { visto: false, aMeio: false });

// 12. Desmarcado e marcado outra vez: 1 vez.
verifica('desmarcado e marcado de novo',
  leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.97).desmarcar().marcar('2026-03-12T09:00:00Z')),
  { visto: true, vezes: 1, data: '2026-03-12T09:00' });

// 13. Visto sem estar na biblioteca (fica "temporário" no Stremio): conta.
verifica('visto fora da biblioteca',
  leitura(new Filme('a', { naBiblioteca: false }).ver('2026-03-10T20:00:00Z', 0.97)),
  { visto: true, vezes: 1, data: '2026-03-10T21:56' });

// 14. Visto e depois tirado da biblioteca: continua a contar.
verifica('visto e tirado da biblioteca',
  leitura(new Filme('a').ver('2026-03-10T20:00:00Z', 0.97).tirarDaBiblioteca()),
  { visto: true, vezes: 1, data: '2026-03-10T21:56' });

// 15. Começado fora da biblioteca e abandonado aos 20 %: fica a meio, não visto.
verifica('começado fora da biblioteca, abandonado',
  leitura(new Filme('a', { naBiblioteca: false }).ver('2026-03-10T20:00:00Z', 0.2)),
  { visto: false, aMeio: true });

// 16. Séries não entram.
const serie = new Filme('s').ver('2026-03-10T20:00:00Z', 0.97);
serie.item.type = 'series';
verifica('séries ficam de fora', lerBiblioteca([serie.item]).vistos.length, 0);

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
