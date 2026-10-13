// As contas das estatísticas. Este ficheiro é usado tanto pelo painel (no
// navegador) como pela extensão que corre no Cloudflare (src/worker.js), por
// isso não pode depender de nada que só exista num dos lados.

const DIAS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const posterDe = (id) => `https://images.metahub.space/poster/medium/${id}/img`;
export const fundoDe = (id) => `https://images.metahub.space/background/medium/${id}/img`;

const instante = (v) => {
  const t = typeof v === 'string' && v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

// Quantas vezes um filme foi visto. Regras do Stremio (stremio-core):
// - "visto" é só timesWatched > 0 (LibraryItem::watched). O flaggedWatched não
//   serve: desmarcar um filme põe timesWatched a 0 mas deixa flaggedWatched a 1.
// - Num filme, timesWatched só sobe na primeira vez que passa os 70 %: o
//   flaggedWatched só volta a 0 quando muda o vídeo, o que num filme não
//   acontece. Rever não conta. Por isso as revisões estimam-se pelo tempo total
//   a dar (overallTimeWatched) a dividir pela duração: ~0,9 = 1 vez, ~1,8 = 2.
export function vezesVisto(s) {
  const marcado = s.timesWatched || 0;
  if (marcado <= 0) return 0;
  const pelaReproducao = s.duration > 0 ? Math.floor((s.overallTimeWatched || 0) / s.duration + 0.25) : 0;
  return Math.max(marcado, pelaReproducao);
}

// Da biblioteca do Stremio (tal como vem da API) aos filmes vistos e aos que
// ficaram a meio. Contam também os filmes que já foram tirados da biblioteca,
// porque o histórico continua lá.
export function lerBiblioteca(itens) {
  const vistos = [];
  const porAcabar = [];
  for (const i of Array.isArray(itens) ? itens : []) {
    if (!i || i.type !== 'movie' || typeof i._id !== 'string') continue;
    const s = i.state || {};
    const filme = {
      id: i._id,
      nome: i.name || i._id,
      poster: i.poster || (i._id.startsWith('tt') ? posterDe(i._id) : null),
      vezes: vezesVisto(s),
      quando: instante(s.lastWatched),
      adicionado: instante(i._ctime),
      duracao: s.duration || 0,
      tempoReal: s.overallTimeWatched || 0,
      progresso: s.duration ? Math.min(1, (s.timeOffset || 0) / s.duration) : 0,
    };
    if (filme.vezes > 0) vistos.push(filme);
    else if ((s.timeOffset || 0) > 0 && (!i.removed || i.temp)) porAcabar.push(filme);
  }
  semDataCerta(vistos);
  return { vistos: vistos.sort(maisRecente), porAcabar: porAcabar.sort(maisRecente) };
}

// Filmes sem data de visualização no fim; entre eles, a ordem é a da data
// que o Stremio tem (a da marcação ou importação).
export const maisRecente = (a, b) => (b.quando || 0) - (a.quando || 0)
  || (b.dataStremio || 0) - (a.dataStremio || 0);
export const maisAntigo = (a, b) => (!a.quando) - (!b.quando) || (a.quando || 0) - (b.quando || 0);

// Quando se marcam vários filmes como vistos de uma vez (ou o Stremio importa
// ou sincroniza a biblioteca), todos ficam com a data desse momento, e essa
// data não diz quando o filme foi visto: não entra nas contas por mês, dia e
// hora. Conta como lote uma série de 3 ou mais filmes com menos de 10 minutos
// entre cada um, ou 2 filmes com menos de 1 minuto. Dois filmes a 15 minutos
// (acabar um e reabrir outro já visto) mantêm as datas: o primeiro foi mesmo
// visto àquela hora.
const LOTE_INTERVALO = 10 * 60 * 1000;
const LOTE_MINIMO = 3;
const PAR_INTERVALO = 60 * 1000;
function semDataCerta(vistos) {
  const comData = vistos.filter((f) => f.quando).sort((a, b) => a.quando - b.quando);
  const duvidosos = new Set();
  let serie = comData.slice(0, 1);
  const fecharSerie = () => {
    const parColado = serie.length === 2 && serie[1].quando - serie[0].quando < PAR_INTERVALO;
    if (serie.length >= LOTE_MINIMO || parColado) for (const f of serie) duvidosos.add(f);
  };
  for (let i = 1; i < comData.length; i++) {
    if (comData[i].quando - comData[i - 1].quando < LOTE_INTERVALO) serie.push(comData[i]);
    else { fecharSerie(); serie = [comData[i]]; }
  }
  fecharSerie();
  for (const f of duvidosos) {
    f.dataStremio = f.quando;
    f.quando = null;
  }
}

// Partes de uma data no fuso horário de quem vê (o Cloudflare corre em UTC).
const formatadores = new Map();
export function partes(ms, fuso) {
  let f = formatadores.get(fuso);
  if (!f) {
    const opcoes = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23', weekday: 'short' };
    try { f = new Intl.DateTimeFormat('en-US', { ...opcoes, timeZone: fuso || 'UTC' }); }
    catch { f = new Intl.DateTimeFormat('en-US', { ...opcoes, timeZone: 'UTC' }); }
    formatadores.set(fuso, f);
  }
  const p = {};
  for (const x of f.formatToParts(ms)) p[x.type] = x.value;
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, semana: DIAS_EN.indexOf(p.weekday) };
}

const contar = (mapa, chave, n = 1) => mapa.set(chave, (mapa.get(chave) || 0) + n);
const doMaior = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt');

// O que dá para saber só com a biblioteca do Stremio, sem pedir mais nada a
// ninguém. É o que a extensão mostra dentro do próprio Stremio.
export function resumoBase(vistos, { fuso = 'UTC', agora = Date.now() } = {}) {
  const anoAtual = partes(agora, fuso).ano;
  const porMes = new Map();
  const porAno = new Map();
  const porSemana = Array(7).fill(0);
  const porHora = Array(24).fill(0);
  let tempoReal = 0;
  let desde = null;
  let esteAno = 0;
  for (const f of vistos) {
    tempoReal += f.tempoReal;
    for (const t of [f.quando, f.adicionado]) if (t && (desde === null || t < desde)) desde = t;
    if (!f.quando) continue;
    const p = partes(f.quando, fuso);
    contar(porMes, `${p.ano}-${String(p.mes).padStart(2, '0')}`);
    contar(porAno, p.ano);
    porSemana[p.semana] += 1;
    porHora[p.hora] += 1;
    if (p.ano === anoAtual) esteAno += 1;
  }
  const melhorMes = [...porMes].sort(doMaior)[0] || null;
  return {
    total: vistos.length,
    vezesTotal: vistos.reduce((s, f) => s + f.vezes, 0),
    revistos: vistos.filter((f) => f.vezes > 1).length,
    maisRevistos: vistos.filter((f) => f.vezes > 1).sort((a, b) => b.vezes - a.vezes || (b.quando || 0) - (a.quando || 0)).slice(0, 10),
    ultimos: vistos.filter((f) => f.quando).slice(0, 10),
    semData: vistos.filter((f) => !f.quando).length,
    tempoReal,
    desde,
    anoAtual,
    esteAno,
    vistosEsteAno: vistos.filter((f) => f.quando && partes(f.quando, fuso).ano === anoAtual),
    porMes: new Map([...porMes].sort()),
    porAno: new Map([...porAno].sort((a, b) => a[0] - b[0])),
    porSemana,
    porHora,
    melhorMes,
    diaFavorito: porSemana.indexOf(Math.max(...porSemana)),
    horaFavorita: porHora.indexOf(Math.max(...porHora)),
  };
}

// Do "142 min" (ou "2h 22min") do Cinemeta a minutos.
export function minutos(texto) {
  if (!texto) return 0;
  const h = /(\d+)\s*h/i.exec(texto);
  const m = /(\d+)\s*min/i.exec(texto);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || (/^\s*(\d+)\s*$/.test(texto) ? +texto : 0);
}

// Detalhes de um filme no Cinemeta, reduzidos ao que as contas usam.
export function resumirMeta(meta) {
  if (!meta) return {};
  const lista = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/\s*,\s*/) : []).filter(Boolean);
  const ano = parseInt(meta.year || meta.releaseInfo, 10);
  const nota = parseFloat(meta.imdbRating);
  return {
    n: meta.name || undefined,
    a: Number.isFinite(ano) ? ano : undefined,
    g: lista(meta.genres || meta.genre),
    d: lista(meta.director),
    c: lista(meta.cast).slice(0, 6),
    p: lista(meta.country),
    r: Number.isFinite(nota) && nota > 0 ? nota : undefined,
    m: minutos(meta.runtime) || undefined,
  };
}

// Tudo o resto: géneros, décadas, realizadores, atores, países e notas.
// `metas` é { id: resumirMeta(...) } para os filmes que o Cinemeta conhece.
export function resumoCompleto(vistos, metas, opcoes) {
  const base = resumoBase(vistos, opcoes);
  const generos = new Map();
  const decadas = new Map();
  const realizadores = new Map();
  const atores = new Map();
  const paises = new Map();
  const comNota = [];
  const comDuracao = [];
  const comAno = [];
  let minutosVistos = 0;
  let semDuracao = 0;
  for (const f of vistos) {
    const m = metas[f.id] || {};
    f.ano = m.a;
    f.nota = m.r;
    f.generos = m.g || [];
    f.realizadores = m.d || [];
    f.elenco = m.c || [];
    f.paises = m.p || [];
    f.minutos = m.m || Math.round(f.duracao / 60000) || 0;
    if (m.n && /^tt\d+$/.test(f.nome)) f.nome = m.n;
    for (const g of f.generos) contar(generos, g);
    for (const d of f.realizadores) contar(realizadores, d);
    for (const c of f.elenco) contar(atores, c);
    for (const p of f.paises) contar(paises, p);
    if (f.ano) { contar(decadas, Math.floor(f.ano / 10) * 10); comAno.push(f); }
    if (f.nota) comNota.push(f);
    if (f.minutos) { comDuracao.push(f); minutosVistos += f.minutos * f.vezes; } else semDuracao += 1;
  }
  const porNota = [...comNota].sort((a, b) => b.nota - a.nota || a.nome.localeCompare(b.nome, 'pt'));
  const porDuracao = [...comDuracao].sort((a, b) => b.minutos - a.minutos);
  const porAno = [...comAno].sort((a, b) => a.ano - b.ano);
  return {
    ...base,
    generos: [...generos].sort(doMaior),
    decadas: [...decadas].sort((a, b) => a[0] - b[0]),
    realizadores: [...realizadores].sort(doMaior),
    atores: [...atores].sort(doMaior),
    paises: [...paises].sort(doMaior),
    notaMedia: comNota.length ? comNota.reduce((s, f) => s + f.nota, 0) / comNota.length : null,
    melhores: porNota.slice(0, 5),
    piores: porNota.slice(-5).reverse(),
    maisLongo: porDuracao[0] || null,
    maisCurto: porDuracao[porDuracao.length - 1] || null,
    maisAntigo: porAno[0] || null,
    maisNovo: porAno[porAno.length - 1] || null,
    minutosVistos,
    semDuracao,
  };
}

export const horasDe = (ms) => Math.round(ms / 3600000);
