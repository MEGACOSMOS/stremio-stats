// As contas das estatísticas. Este ficheiro é usado tanto pelo painel (no
// navegador) como pela extensão que corre no Cloudflare (src/worker.js), por
// isso não pode depender de nada que só exista num dos lados.

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// A semana começa à segunda, como em Portugal.
export const DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
export const DIAS_CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
// "à sexta", mas "ao sábado".
export const aoDia = (i) => `${i >= 5 ? 'ao' : 'à'} ${DIAS[i]}`;
const DIAS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const posterDe = (id) => `https://images.metahub.space/poster/medium/${id}/img`;
export const fundoDe = (id) => `https://images.metahub.space/background/medium/${id}/img`;

const instante = (v) => {
  const t = typeof v === 'string' && v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

// Da biblioteca do Stremio (tal como vem da API) aos filmes vistos e aos que
// ficaram a meio. "Visto" é o mesmo critério que o próprio Stremio usa:
// timesWatched > 0 (ou marcado à mão como visto). Contam também os filmes que
// já foram tirados da biblioteca, porque o histórico continua lá.
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
      vezes: Math.max(s.timesWatched || 0, s.flaggedWatched ? 1 : 0),
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
// ou sincroniza a biblioteca), todos ficam com a data desse momento. Ninguém
// acaba dois filmes com menos de 20 minutos de intervalo, por isso essas datas
// não dizem quando o filme foi visto: não entram nas contas por mês, dia e hora.
const INTERVALO_MINIMO = 20 * 60 * 1000;
function semDataCerta(vistos) {
  const comData = vistos.filter((f) => f.quando).sort((a, b) => a.quando - b.quando);
  const duvidosos = new Set();
  for (let i = 1; i < comData.length; i++) {
    if (comData[i].quando - comData[i - 1].quando < INTERVALO_MINIMO) {
      duvidosos.add(comData[i]);
      duvidosos.add(comData[i - 1]);
    }
  }
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

// ——— Palavras em português ———

const GENEROS = {
  Action: 'Ação', Adventure: 'Aventura', Animation: 'Animação', Biography: 'Biografia',
  Comedy: 'Comédia', Crime: 'Crime', Documentary: 'Documentário', Drama: 'Drama',
  Family: 'Família', Fantasy: 'Fantasia', 'Film-Noir': 'Film noir', History: 'História',
  Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Mistério',
  Romance: 'Romance', 'Sci-Fi': 'Ficção científica', 'Science Fiction': 'Ficção científica',
  Short: 'Curta-metragem', Sport: 'Desporto', Thriller: 'Thriller', War: 'Guerra',
  Western: 'Western', News: 'Notícias', 'Reality-TV': 'Reality show', 'Talk-Show': 'Talk show',
  'Game-Show': 'Concurso',
};
export const genero = (g) => GENEROS[g] || g;

const PAISES = {
  'United States': 'Estados Unidos', USA: 'Estados Unidos', 'United Kingdom': 'Reino Unido', UK: 'Reino Unido',
  France: 'França', Germany: 'Alemanha', 'West Germany': 'Alemanha Ocidental', Italy: 'Itália', Spain: 'Espanha',
  Portugal: 'Portugal', Brazil: 'Brasil', Japan: 'Japão', 'South Korea': 'Coreia do Sul', Korea: 'Coreia do Sul',
  China: 'China', 'Hong Kong': 'Hong Kong', Taiwan: 'Taiwan', India: 'Índia', Canada: 'Canadá',
  Australia: 'Austrália', 'New Zealand': 'Nova Zelândia', Mexico: 'México', Argentina: 'Argentina',
  Ireland: 'Irlanda', Belgium: 'Bélgica', Netherlands: 'Países Baixos', Denmark: 'Dinamarca', Sweden: 'Suécia',
  Norway: 'Noruega', Finland: 'Finlândia', Poland: 'Polónia', Russia: 'Rússia', 'Soviet Union': 'União Soviética',
  Switzerland: 'Suíça', Austria: 'Áustria', 'Czech Republic': 'Chéquia', Czechia: 'Chéquia', Hungary: 'Hungria',
  Greece: 'Grécia', Turkey: 'Turquia', Iran: 'Irão', Israel: 'Israel', 'South Africa': 'África do Sul',
  Chile: 'Chile', Colombia: 'Colômbia', Thailand: 'Tailândia', Indonesia: 'Indonésia', Iceland: 'Islândia',
  'United Arab Emirates': 'Emirados Árabes Unidos', Morocco: 'Marrocos', Egypt: 'Egito',
};
export const pais = (p) => PAISES[p] || p;

export function feitio(hora) {
  if (hora >= 5 && hora < 12) return 'de manhã';
  if (hora >= 12 && hora < 19) return 'à tarde';
  if (hora >= 19) return 'à noite';
  return 'de madrugada';
}

export const numero = (n) => Math.round(n).toLocaleString('pt-PT');
export const horasDe = (ms) => Math.round(ms / 3600000);
export function mesAno(chave, curto = false) {
  const [a, m] = String(chave).split('-').map(Number);
  return `${(curto ? MESES_CURTOS : MESES)[m - 1]} ${a}`;
}
export const vezes = (n) => (n === 1 ? '1 vez' : `${n} vezes`);
export const filmes = (n) => (n === 1 ? '1 filme' : `${numero(n)} filmes`);
