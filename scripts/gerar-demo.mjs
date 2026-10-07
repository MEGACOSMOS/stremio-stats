// Gera src/demo.json: uma biblioteca do Stremio fictícia (filmes reais, histórico
// inventado) no mesmo formato que a API do Stremio devolve. Serve para o botão
// "Ver um exemplo" e para testar sem uma conta verdadeira.
// Correr com: bun scripts/gerar-demo.mjs

const IDS = `tt0111161 tt0068646 tt0468569 tt0071562 tt0050083 tt0108052 tt0167260 tt0110912
tt0120737 tt0060196 tt0109830 tt0137523 tt1375666 tt0167261 tt0080684 tt0133093 tt0099685
tt0073486 tt0114369 tt0047478 tt0102926 tt0317248 tt0118799 tt0076759 tt0120815 tt0245429
tt0120689 tt0816692 tt6751668 tt0114814 tt0110413 tt0103064 tt0088763 tt0253474 tt0054215
tt0172495 tt0407887 tt0482571 tt0110357 tt2582802 tt1675434 tt0095765 tt0034583 tt0064116
tt0047396 tt0095327 tt1853728 tt0078748 tt0209144 tt0082971 tt4154756 tt0910970 tt0405094
tt0057012 tt1345836 tt0364569 tt0090605 tt0119698 tt0112573 tt0114709 tt0361748 tt0180093
tt0338013 tt0211915 tt0119217 tt0266697 tt15398776 tt1745960 tt9362722 tt1160419 tt15239678
tt0993846 tt2380307 tt4633694 tt7286456 tt6966692 tt1392190 tt2267998 tt1130884 tt0105236
tt0118715 tt0107290 tt0120338 tt3783958 tt5013056 tt1856101 tt0083658 tt0081505 tt0062622`
  .split(/\s+/).filter(Boolean);
const POR_ACABAR = ['tt0499549', 'tt0848228', 'tt0758758'];
const SERIES = [['tt0903747', 'Breaking Bad'], ['tt0944947', 'Game of Thrones']];

let semente = 20261007;
const aleatorio = () => {
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const escolher = (pesos) => {
  const total = pesos.reduce((a, b) => a + b, 0);
  let r = aleatorio() * total;
  for (let i = 0; i < pesos.length; i++) if ((r -= pesos[i]) < 0) return i;
  return pesos.length - 1;
};

async function meta(id) {
  const r = await fetch(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`);
  const m = (await r.json()).meta || {};
  const min = Number(/(\d+)\s*min/.exec(m.runtime || '')?.[1]) || 110;
  return { name: m.name || id, min };
}

const INICIO = Date.parse('2023-01-15T00:00:00Z');
const FIM = Date.parse('2026-10-06T00:00:00Z');
// Mais filmes ao fim de semana e à noite, como acontece na vida real.
const PESO_DIA = [3, 1, 1, 1.2, 1.4, 3.2, 3.6]; // domingo..sábado
const PESO_HORA = [3, 1.6, 0.6, 0.2, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.8, 1.2, 1.4, 1.2, 1, 1.2, 2, 3.6, 5, 4.6];

function dataAoAcaso() {
  for (;;) {
    const dia = new Date(INICIO + aleatorio() * (FIM - INICIO));
    if (aleatorio() * 3.6 > PESO_DIA[dia.getUTCDay()]) continue;
    const hora = escolher(PESO_HORA);
    // A hora é a de Lisboa; em UTC fica uma hora antes no horário de verão.
    dia.setUTCHours(hora - 1, Math.floor(aleatorio() * 60), Math.floor(aleatorio() * 60), 0);
    return dia;
  }
}

function item(id, name, min, estado) {
  const ultima = dataAoAcaso();
  const criado = new Date(ultima.getTime() - aleatorio() * 30 * 864e5);
  const duracao = min * 60000;
  return {
    _id: id, name, type: 'movie',
    poster: `https://images.metahub.space/poster/medium/${id}/img`,
    posterShape: 'poster', removed: estado.removido || false, temp: estado.temp || false,
    _ctime: criado.toISOString(), _mtime: ultima.toISOString(),
    state: {
      lastWatched: ultima.toISOString(), timeWatched: 0,
      timeOffset: estado.parado ? Math.round(duracao * estado.parado) : 0,
      overallTimeWatched: estado.marcado ? 0 : Math.round(duracao * (estado.parado || estado.vezes * (0.93 + aleatorio() * 0.1))),
      timesWatched: estado.vezes, flaggedWatched: estado.vezes > 0 ? 1 : 0,
      duration: estado.marcado ? 0 : duracao, video_id: id, watched: '', noNotif: false,
    },
    behaviorHints: { defaultVideoId: id, featuredVideoId: null, hasScheduledVideos: false },
  };
}

const biblioteca = [];
for (const id of IDS) {
  const { name, min } = await meta(id);
  const vezes = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 4][Math.floor(aleatorio() * 12)];
  const r = aleatorio();
  biblioteca.push(item(id, name, min, {
    vezes,
    // Alguns marcados como vistos à mão (sem duração), alguns já tirados da biblioteca.
    marcado: r < 0.08, removido: r > 0.8, temp: r > 0.9,
  }));
}
for (const id of POR_ACABAR) {
  const { name, min } = await meta(id);
  biblioteca.push(item(id, name, min, { vezes: 0, parado: 0.2 + aleatorio() * 0.5 }));
}
for (const [id, name] of SERIES) {
  const s = item(id, name, 50, { vezes: 12 });
  s.type = 'series';
  biblioteca.push(s);
}

await Bun.write(new URL('../src/demo.json', import.meta.url), JSON.stringify(biblioteca));
console.log(`demo.json: ${biblioteca.length} itens`);
