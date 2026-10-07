// O painel: entrar na conta do Stremio, ler a biblioteca, ir buscar os
// detalhes de cada filme ao Cinemeta e desenhar as estatísticas.

import {
  lerBiblioteca, resumoCompleto, resumirMeta, partes, genero, pais, feitio,
  MESES, MESES_CURTOS, DIAS, DIAS_CURTOS, aoDia, numero, horasDe, mesAno, vezes, filmes,
} from '/estatisticas.js';

const $ = (s) => document.querySelector(s);
const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Lisbon';
const API = 'https://api.strem.io/api/';
const LINK = 'https://link.stremio.com/api/v2/';
const CINEMETA = 'https://v3-cinemeta.strem.io/meta/movie/';
const CHAVE_SESSAO = 'mv-sessao';
const CHAVE_METAS = 'mv-metas-v1';

const guardado = {
  ler(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  escrever(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço ou bloqueado */ } },
  apagar(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const decimal = (n) => n.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const duracao = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min` : `${min} min`);
const dataCurta = (ms) => { const p = partes(ms, FUSO); return `${p.dia} ${MESES_CURTOS[p.mes - 1]} ${p.ano}`; };
const decada = (d) => (d >= 1920 && d < 2000 ? `anos ${d % 100}` : `anos ${d}`);
const semAcentos = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// /<cfg>/configure é o que o Stremio abre no botão "Configurar" da extensão.
const caminho = location.pathname.split('/').filter(Boolean);
const cfgDoStremio = caminho.length === 2 && caminho[1] === 'configure' && caminho[0] !== 'demo' ? caminho[0] : null;
const pedeExemplo = caminho[0] === 'demo' || new URLSearchParams(location.search).has('exemplo');

let estado = { modo: null, sessao: null, cfg: null };

function mostrar(vista) {
  for (const v of ['entrada', 'carregar', 'painel']) $(`#vista-${v}`).hidden = v !== vista;
  $('#instalar').hidden = vista !== 'painel';
  $('#sair').hidden = vista !== 'painel' || estado.modo === 'demo';
  if (vista === 'entrada') {
    $('#caixa-entrar').hidden = false;
    $('#caixa-codigo').hidden = true;
  }
  window.scrollTo(0, 0);
}

function erroEntrada(texto) {
  const el = $('#erro-entrada');
  el.textContent = texto || '';
  el.hidden = !texto;
}

function progresso(fracao, texto, detalhe) {
  if (texto) $('#carregar-texto').textContent = texto;
  $('#carregar-detalhe').innerHTML = detalhe ? esc(detalhe) : '&nbsp;';
  $('#progresso > div').style.width = `${Math.round(fracao * 100)}%`;
  $('#progresso').setAttribute('aria-valuenow', String(Math.round(fracao * 100)));
}

// ——— Stremio ———

async function stremio(metodo, corpo) {
  const r = await fetch(API + metodo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const j = await r.json();
  if (j.error) {
    const e = new Error(j.error.message);
    e.doStremio = true;
    throw e;
  }
  return j.result;
}

let cancelarLink = null;

async function entrarComLink() {
  erroEntrada('');
  const botao = $('#entrar-link');
  botao.disabled = true;
  let codigo;
  try {
    const r = await fetch(`${LINK}create?type=Create`).then((x) => x.json());
    codigo = r.result;
    if (!codigo?.code) throw new Error('sem código');
  } catch {
    erroEntrada('Não foi possível falar com o Stremio. Verifica a ligação à Internet e tenta outra vez.');
    return;
  } finally {
    botao.disabled = false;
  }
  $('#codigo').textContent = codigo.code;
  $('#abrir-link').href = codigo.link;
  $('#caixa-entrar').hidden = true;
  $('#caixa-codigo').hidden = false;
  $('#abrir-link').focus();

  let cancelado = false;
  cancelarLink = () => { cancelado = true; };
  const limite = Date.now() + 5 * 60 * 1000;
  while (!cancelado && Date.now() < limite) {
    await esperar(2500);
    if (cancelado) return;
    try {
      const r = await fetch(`${LINK}read?type=Read&code=${encodeURIComponent(codigo.code)}`).then((x) => x.json());
      // Enquanto ninguém confirma, o Stremio responde com um erro; é só esperar.
      if (r.result?.authKey) return entrou(r.result.authKey);
    } catch { /* tenta outra vez daqui a pouco */ }
  }
  if (!cancelado) {
    mostrar('entrada');
    erroEntrada('O código expirou antes de ser confirmado. Carrega outra vez em “Entrar” para receberes um novo.');
  }
}

async function entrarComPalavraPasse(evento) {
  evento.preventDefault();
  erroEntrada('');
  const form = evento.target;
  const botao = form.querySelector('button');
  botao.disabled = true;
  try {
    const r = await stremio('login', {
      type: 'Login', email: form.email.value.trim(), password: form.password.value, facebook: false,
    });
    form.reset();
    await entrou(r.authKey, r.user);
  } catch (e) {
    erroEntrada(e.doStremio
      ? 'O Stremio não aceitou esse email e palavra-passe. Se entras no Stremio com o Facebook, a Google ou a Apple, usa o botão “Entrar com a minha conta do Stremio”.'
      : 'Não foi possível falar com o Stremio. Verifica a ligação à Internet e tenta outra vez.');
  } finally {
    botao.disabled = false;
  }
}

async function entrou(authKey, utilizador) {
  if (!utilizador) {
    try { utilizador = await stremio('getUser', { type: 'GetUser', authKey }); } catch { /* o nome é só simpatia */ }
  }
  const nome = (utilizador?.fullname || '').trim().split(/\s+/)[0] || '';
  estado = { modo: 'conta', sessao: { authKey, nome }, cfg: null };
  guardado.escrever(CHAVE_SESSAO, estado.sessao);
  if (location.pathname !== '/' || location.search) history.replaceState(null, '', '/');
  await carregarConta();
}

async function carregarConta() {
  mostrar('carregar');
  progresso(0.02, 'A ler o teu histórico do Stremio…');
  let itens;
  try {
    itens = await stremio('datastoreGet', { authKey: estado.sessao.authKey, collection: 'libraryItem', ids: [], all: true });
  } catch (e) {
    if (e.doStremio) {
      guardado.apagar(CHAVE_SESSAO);
      estado = { modo: null, sessao: null, cfg: null };
      mostrar('entrada');
      erroEntrada('A tua sessão do Stremio terminou. Entra outra vez.');
    } else {
      mostrar('entrada');
      erroEntrada('Não foi possível falar com o Stremio. Verifica a ligação à Internet e recarrega a página.');
    }
    return;
  }
  await construir(itens);
}

// A biblioteca vem do servidor da extensão (exemplo, ou aberto a partir do Stremio).
async function carregarDoServidor(cfg) {
  mostrar('carregar');
  progresso(0.02, cfg === 'demo' ? 'A preparar o exemplo…' : 'A ler o teu histórico do Stremio…');
  try {
    const r = await fetch(`/${encodeURIComponent(cfg)}/biblioteca.json`);
    if (!r.ok) throw Object.assign(new Error(String(r.status)), { estado: r.status });
    const { itens } = await r.json();
    await construir(itens);
  } catch (e) {
    estado = { modo: null, sessao: null, cfg: null };
    history.replaceState(null, '', '/');
    mostrar('entrada');
    erroEntrada(e.estado === 401 || e.estado === 404
      ? 'A ligação da extensão ao teu Stremio já não funciona. Entra outra vez e volta a instalar a extensão.'
      : 'Não foi possível ler o histórico. Verifica a ligação à Internet e recarrega a página.');
  }
}

// ——— Cinemeta: géneros, realizadores, notas… ———

async function detalhes(ids) {
  const cache = guardado.ler(CHAVE_METAS) || {};
  const fila = [...new Set(ids)].filter((id) => !(id in cache));
  const total = fila.length;
  let feitos = 0;
  if (total) progresso(0.05, `A juntar os detalhes de ${filmes(total)}…`, `0 de ${numero(total)}`);
  async function trabalhador() {
    while (fila.length) {
      const id = fila.shift();
      try {
        const r = await fetch(`${CINEMETA}${id}.json`);
        if (r.ok) cache[id] = resumirMeta((await r.json()).meta);
        else if (r.status === 404) cache[id] = {};
      } catch { /* fica para a próxima visita */ }
      feitos += 1;
      progresso(0.05 + 0.93 * (feitos / total), null, `${numero(feitos)} de ${numero(total)}`);
      if (feitos % 100 === 0) guardado.escrever(CHAVE_METAS, cache);
    }
  }
  await Promise.all(Array.from({ length: Math.min(12, total) }, trabalhador));
  if (total) guardado.escrever(CHAVE_METAS, cache);
  return cache;
}

async function construir(itens) {
  const { vistos, porAcabar } = lerBiblioteca(itens);
  const metas = await detalhes([...vistos, ...porAcabar].map((f) => f.id).filter((id) => /^tt\d+$/.test(id)));
  const r = resumoCompleto(vistos, metas, { fuso: FUSO });
  for (const f of porAcabar) f.ano = metas[f.id]?.a;
  progresso(1);
  desenhar(r, vistos, porAcabar);
  mostrar('painel');
}

// ——— Gráficos ———

const dica = $('#dica');

function ligarDicas(alvo, seletor, conteudo) {
  for (const el of alvo.querySelectorAll(seletor)) {
    const abrir = () => {
      const d = conteudo(Number(el.dataset.i));
      dica.innerHTML = `<strong>${esc(d.titulo)}</strong>${d.detalhe || ''}`;
      dica.hidden = false;
      const marca = (el.querySelector('i') || el).getBoundingClientRect();
      const caixa = dica.getBoundingClientRect();
      const x = Math.min(Math.max(8, marca.left + marca.width / 2 - caixa.width / 2), innerWidth - caixa.width - 8);
      let y = marca.top - caixa.height - 10;
      if (y < 8) y = marca.bottom + 10;
      dica.style.left = `${x}px`;
      dica.style.top = `${y}px`;
    };
    const fechar = () => { dica.hidden = true; };
    el.addEventListener('mouseenter', abrir);
    el.addEventListener('focus', abrir);
    el.addEventListener('mouseleave', fechar);
    el.addEventListener('blur', fechar);
  }
}
addEventListener('scroll', () => { dica.hidden = true; }, { passive: true });

function tabela(cabecalho, linhas) {
  return `<details class="tabela"><summary>Ver em tabela</summary><div class="tabela-rolar"><table>
    <thead><tr>${cabecalho.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

// Marcas "redondas" no eixo vertical: 0, 2, 4, 6 ou 0, 10, 20…
function escala(max) {
  if (max <= 0) return { passo: 1, topo: 1 };
  const bruto = max / 3;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = Math.max(1, Math.ceil([1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto)));
  return { passo, topo: Math.ceil(max / passo) * passo };
}

const listaNomes = (nomes, max = 5) => (nomes.length
  ? `<br>${esc(nomes.slice(0, max).join(', '))}${nomes.length > max ? ` e mais ${nomes.length - max}` : ''}`
  : '');

// dados: [{ x, valor, titulo, nomes? }]
function colunas(alvo, dados, cabecalho) {
  const max = Math.max(0, ...dados.map((d) => d.valor));
  const { passo, topo } = escala(max);
  const marcas = [];
  for (let v = 0; v <= topo; v += passo) marcas.push(v);
  const iMax = dados.findIndex((d) => d.valor === max);
  const pct = (v) => `${(v / topo) * 100}%`;
  alvo.innerHTML = `<div class="colunas">
    <div class="eixo-y" aria-hidden="true">${marcas.map((v) => `<span style="bottom:${pct(v)}">${numero(v)}</span>`).join('')}</div>
    <div class="area">
      ${marcas.slice(1).map((v) => `<div class="guia" style="bottom:${pct(v)}"></div>`).join('')}
      <div class="barras">${dados.map((d, i) => `<div class="barra" tabindex="0" role="img" data-i="${i}"
        aria-label="${esc(`${d.titulo}: ${filmes(d.valor)}`)}"><i style="height:${pct(d.valor)}"></i>${
        i === iMax && max > 0 ? `<b style="bottom:${pct(max)}">${numero(max)}</b>` : ''}</div>`).join('')}</div>
    </div>
    <div class="eixo-x" aria-hidden="true">${dados.map((d) => `<span>${esc(d.x)}</span>`).join('')}</div>
  </div>${tabela(cabecalho, dados.map((d) => [d.titulo, numero(d.valor)]))}`;
  ligarDicas(alvo, '.barra', (i) => ({ titulo: dados[i].titulo, detalhe: `${filmes(dados[i].valor)}${listaNomes(dados[i].nomes || [])}` }));
}

// dados: [{ nome, valor, nomes? }]
function linhas(alvo, dados, cabecalho, unidade = filmes) {
  if (!dados.length) {
    alvo.innerHTML = '<p class="mudo pequeno">Sem dados suficientes.</p>';
    return;
  }
  const max = Math.max(1, ...dados.map((d) => d.valor));
  alvo.innerHTML = `<div class="linhas">${dados.map((d, i) => `<div class="linha" tabindex="0" data-i="${i}"
      aria-label="${esc(`${d.nome}: ${unidade(d.valor)}`)}">
      <span class="nome">${esc(d.nome)}</span>
      <span class="pista"><i style="width:calc(${d.valor / max} * (100% - 3em))"></i><b>${numero(d.valor)}</b></span>
    </div>`).join('')}</div>${tabela(cabecalho, dados.map((d) => [d.nome, numero(d.valor)]))}`;
  ligarDicas(alvo, '.linha', (i) => ({ titulo: dados[i].nome, detalhe: `${unidade(dados[i].valor)}${listaNomes(dados[i].nomes || [])}` }));
}

// ——— Desenhar o painel ———

let lista = { vistos: [], mostrados: 60 };

function desenhar(r, vistos, porAcabar) {
  const demo = estado.modo === 'demo';
  $('#aviso-demo').hidden = !demo;

  // O número grande
  $('#ola').textContent = estado.sessao?.nome ? `Olá, ${estado.sessao.nome}! Já viste` : 'Já viste';
  $('#total').innerHTML = `${numero(r.total)}<small>${r.total === 1 ? 'filme' : 'filmes'}</small>`;
  const horasCinema = Math.round(r.minutosVistos / 60);
  const inicio = r.desde ? partes(r.desde, FUSO) : null;
  $('#frase').textContent = r.total
    ? [inicio && `desde ${MESES[inicio.mes - 1]} de ${inicio.ano}`, horasCinema && `${numero(horasCinema)} horas de cinema`,
      r.notaMedia && `nota média ${decimal(r.notaMedia)} no IMDb`].filter(Boolean).join(' · ')
    : 'Ainda não há filmes vistos na tua conta. Quando acabares um filme no Stremio (ou o marcares como visto), ele aparece aqui.';

  // Os quadradinhos
  const anoPassado = r.porAno.get(r.anoAtual - 1) || 0;
  const tiles = [
    ['Horas de cinema', numero(horasCinema), horasCinema >= 24 ? `≈ ${numero(horasCinema / 24)} dias seguidos` : 'a duração dos filmes que viste'],
    ['Tempo a dar no Stremio', `${numero(horasDe(r.tempoReal))} h`, 'o tempo em que o filme esteve mesmo a dar'],
    [`Em ${r.anoAtual}`, numero(r.esteAno), `${filmes(anoPassado)} em ${r.anoAtual - 1}`],
    ['Revistos', numero(r.revistos), 'filmes que viste mais de uma vez'],
    r.notaMedia && ['Nota média no IMDb', decimal(r.notaMedia), 'dos filmes que viste'],
    r.generos[0] && ['Género favorito', genero(r.generos[0][0]), filmes(r.generos[0][1]), true],
    r.decadas.length && (() => { const d = [...r.decadas].sort((a, b) => b[1] - a[1])[0]; return ['Década favorita', decada(d[0]), filmes(d[1]), true]; })(),
    r.realizadores[0] && ['Realizador favorito', r.realizadores[0][0], filmes(r.realizadores[0][1]), true],
  ].filter(Boolean);
  $('#mosaico').innerHTML = tiles.map(([rotulo, valor, nota, texto]) => `<div class="tile">
    <div class="rotulo">${esc(rotulo)}</div><div class="valor${texto ? ' texto' : ''}">${esc(valor)}</div>
    <div class="nota">${esc(nota)}</div></div>`).join('');

  // Ao longo do tempo
  const nomesPor = (chave) => {
    const m = new Map();
    for (const f of vistos) {
      if (!f.quando) continue;
      const k = chave(partes(f.quando, FUSO));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f.nome);
    }
    return m;
  };
  const porMesNomes = nomesPor((p) => `${p.ano}-${String(p.mes).padStart(2, '0')}`);
  const porAnoNomes = nomesPor((p) => p.ano);
  const agora = partes(Date.now(), FUSO);
  const tempo = {
    mes: () => {
      const dados = [];
      for (let i = 23; i >= 0; i--) {
        const total = agora.ano * 12 + (agora.mes - 1) - i;
        const ano = Math.floor(total / 12);
        const mes = (total % 12) + 1;
        const k = `${ano}-${String(mes).padStart(2, '0')}`;
        dados.push({
          x: mes === 1 ? String(ano) : mes % 3 === 1 ? MESES_CURTOS[mes - 1] : '',
          valor: r.porMes.get(k) || 0, titulo: mesAno(k), nomes: porMesNomes.get(k) || [],
        });
      }
      colunas($('#g-tempo'), dados, ['Mês', 'Filmes']);
    },
    ano: () => {
      const anos = [...r.porAno.keys()];
      const dados = [];
      if (anos.length) for (let a = anos[0]; a <= agora.ano; a++) dados.push({ x: String(a), valor: r.porAno.get(a) || 0, titulo: String(a), nomes: porAnoNomes.get(a) || [] });
      colunas($('#g-tempo'), dados, ['Ano', 'Filmes']);
    },
  };
  for (const b of document.querySelectorAll('[data-tempo]')) {
    b.onclick = () => {
      for (const o of document.querySelectorAll('[data-tempo]')) o.setAttribute('aria-pressed', String(o === b));
      tempo[b.dataset.tempo]();
    };
  }
  tempo[document.querySelector('[data-tempo][aria-pressed="true"]').dataset.tempo]();

  // Géneros e décadas
  const nomesDe = (campo) => {
    const m = new Map();
    for (const f of vistos) for (const v of f[campo] || []) { if (!m.has(v)) m.set(v, []); m.get(v).push(f.nome); }
    return m;
  };
  const porGenero = nomesDe('generos');
  linhas($('#g-generos'), r.generos.slice(0, 10).map(([g, n]) => ({ nome: genero(g), valor: n, nomes: porGenero.get(g) })), ['Género', 'Filmes']);
  const porDecada = new Map();
  for (const f of vistos) if (f.ano) { const d = Math.floor(f.ano / 10) * 10; if (!porDecada.has(d)) porDecada.set(d, []); porDecada.get(d).push(f.nome); }
  if (r.decadas.length) {
    const dados = [];
    for (let d = r.decadas[0][0]; d <= r.decadas[r.decadas.length - 1][0]; d += 10) {
      dados.push({ x: String(d), valor: porDecada.get(d)?.length || 0, titulo: decada(d), nomes: porDecada.get(d) || [] });
    }
    colunas($('#g-decadas'), dados, ['Década', 'Filmes']);
  } else $('#g-decadas').innerHTML = '<p class="mudo pequeno">Sem dados suficientes.</p>';

  // Dias e horas
  const porDiaNomes = nomesPor((p) => p.semana);
  colunas($('#g-dias'), DIAS_CURTOS.map((d, i) => ({ x: d, valor: r.porSemana[i], titulo: DIAS[i], nomes: porDiaNomes.get(i) || [] })), ['Dia', 'Filmes']);
  $('#t-dias').textContent = r.total ? `Vês mais filmes ${aoDia(r.diaFavorito)}.` : '';
  const porHoraNomes = nomesPor((p) => p.hora);
  colunas($('#g-horas'), r.porHora.map((n, h) => ({ x: h % 3 === 0 ? `${h}h` : '', valor: n, titulo: `Das ${h}h às ${(h + 1) % 24}h`, nomes: porHoraNomes.get(h) || [] })), ['Hora', 'Filmes']);
  $('#t-horas').textContent = r.total ? `A que horas acabas os filmes — costumas ver ${feitio(r.horaFavorita)}.` : '';

  // Realizadores, atores, países
  const porRealizador = nomesDe('realizadores');
  const porAtor = nomesDe('elenco');
  const porPais = nomesDe('paises');
  linhas($('#g-realizadores'), r.realizadores.slice(0, 8).map(([n, v]) => ({ nome: n, valor: v, nomes: porRealizador.get(n) })), ['Realizador', 'Filmes']);
  linhas($('#g-atores'), r.atores.slice(0, 8).map(([n, v]) => ({ nome: n, valor: v, nomes: porAtor.get(n) })), ['Ator', 'Filmes']);
  linhas($('#g-paises'), r.paises.slice(0, 8).map(([n, v]) => ({ nome: pais(n), valor: v, nomes: porPais.get(n) })), ['País', 'Filmes']);

  // Destaques
  const maisRevisto = r.maisRevistos[0];
  const destaques = [
    r.melhores[0] && ['Melhor nota', r.melhores[0], `★ ${decimal(r.melhores[0].nota)} no IMDb`],
    r.piores[0] && r.piores[0] !== r.melhores[0] && ['Pior nota', r.piores[0], `★ ${decimal(r.piores[0].nota)} no IMDb`],
    r.maisLongo && ['O mais longo', r.maisLongo, duracao(r.maisLongo.minutos)],
    r.maisCurto && r.maisCurto !== r.maisLongo && ['O mais curto', r.maisCurto, duracao(r.maisCurto.minutos)],
    r.maisAntigo && ['O mais antigo', r.maisAntigo, `estreou em ${r.maisAntigo.ano}`],
    maisRevisto && ['O que mais revisto', maisRevisto, `visto ${vezes(maisRevisto.vezes)}`],
  ].filter(Boolean);
  $('#destaques').innerHTML = destaques.map(([etiqueta, f, det]) => `<a class="destaque" href="${linkStremio(f.id)}" title="Abrir no Stremio">
      <span class="etiqueta">${esc(etiqueta)}</span>${capa(f)}
      <span class="titulo">${esc(f.nome)}</span><span class="det">${esc(det)}</span></a>`).join('')
    || '<p class="mudo pequeno">Sem dados suficientes.</p>';

  // A meio
  $('#cartao-meio').hidden = !porAcabar.length;
  $('#meio').innerHTML = porAcabar.slice(0, 12).map((f) => `<a class="filme" href="${linkStremio(f.id)}" title="Continuar no Stremio">
      ${capa(f, `<span class="meio" aria-label="${Math.round(f.progresso * 100)}% visto"><i style="width:${f.progresso * 100}%"></i></span>`)}
      <span class="titulo">${esc(f.nome)}</span><span class="det">${Math.round(f.progresso * 100)}% visto</span></a>`).join('');

  // A lista toda
  lista = { vistos, mostrados: 60 };
  $('#filtro-genero').innerHTML = '<option value="">Todos os géneros</option>'
    + r.generos.map(([g, n]) => `<option value="${esc(g)}">${esc(genero(g))} (${n})</option>`).join('');
  $('#procurar').value = '';
  desenharLista();
}

const linkStremio = (id) => `stremio:///detail/movie/${encodeURIComponent(id)}/${encodeURIComponent(id)}`;

function capa(f, extra = '') {
  return `<span class="capa"><span class="sem-capa">${esc(f.nome)}</span>${
    f.poster ? `<img loading="lazy" src="${esc(f.poster)}" alt="">` : ''}${
    f.vezes > 1 ? `<span class="selo">${f.vezes}×</span>` : ''}${extra}</span>`;
}
// Capas que não existem: fica o nome do filme.
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && e.target.closest('.capa')) e.target.remove(); }, true);

const ORDENAR = {
  recentes: (a, b) => (b.quando || 0) - (a.quando || 0),
  antigos: (a, b) => (a.quando || 0) - (b.quando || 0),
  nota: (a, b) => (b.nota || 0) - (a.nota || 0),
  estreia: (a, b) => (b.ano || 0) - (a.ano || 0),
  revistos: (a, b) => b.vezes - a.vezes || (b.quando || 0) - (a.quando || 0),
  az: (a, b) => a.nome.localeCompare(b.nome, 'pt'),
};

function desenharLista() {
  const q = semAcentos($('#procurar').value.trim());
  const g = $('#filtro-genero').value;
  const escolhidos = lista.vistos
    .filter((f) => (!g || f.generos.includes(g))
      && (!q || semAcentos([f.nome, ...f.realizadores, ...f.elenco].join(' ')).includes(q)))
    .sort(ORDENAR[$('#ordem').value] || ORDENAR.recentes);
  const total = lista.vistos.length;
  $('#t-lista').textContent = escolhidos.length === total ? filmes(total) : `${filmes(escolhidos.length)} de ${numero(total)}`;
  $('#lista').innerHTML = escolhidos.slice(0, lista.mostrados).map((f) => `<a class="filme" href="${linkStremio(f.id)}" title="Abrir no Stremio">
      ${capa(f)}<span class="titulo">${esc(f.nome)}</span>
      <span class="det">${[f.ano, f.nota && `★ ${decimal(f.nota)}`, f.quando && dataCurta(f.quando)].filter(Boolean).map(esc).join(' · ')}</span></a>`).join('')
    || '<p class="mudo">Nenhum filme encontrado.</p>';
  $('#ver-mais').hidden = escolhidos.length <= lista.mostrados;
}

$('#procurar').addEventListener('input', () => { lista.mostrados = 60; desenharLista(); });
$('#ordem').addEventListener('change', () => { lista.mostrados = 60; desenharLista(); });
$('#filtro-genero').addEventListener('change', () => { lista.mostrados = 60; desenharLista(); });
$('#ver-mais').addEventListener('click', () => { lista.mostrados += 120; desenharLista(); });

// ——— Instalar a extensão no Stremio ———

async function linkDaExtensao() {
  if (estado.cfg) return estado.cfg;
  const r = await fetch('/api/ligar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: estado.sessao.authKey, fuso: FUSO }),
  });
  if (!r.ok) throw new Error(String(r.status));
  estado.cfg = (await r.json()).cfg;
  return estado.cfg;
}

$('#instalar').addEventListener('click', async () => {
  const botao = $('#instalar');
  botao.disabled = true;
  try {
    const cfg = await linkDaExtensao();
    const url = `${location.origin}/${cfg}/manifest.json`;
    $('#instalar-url').value = url;
    $('#instalar-abrir').href = url.replace(/^https?:\/\//, 'stremio://');
    // O Stremio troca stremio:// por https://, que não existe num endereço local:
    // aqui só serve copiar o link e colá-lo na pesquisa das extensões.
    const local = location.protocol === 'http:';
    $('#instalar-abrir').hidden = local;
    $('#instalar-local').hidden = !local;
    $('#instalar-cuidado').hidden = cfg === 'demo';
    $('#janela-instalar').showModal();
  } catch {
    alert('Não foi possível criar o link da extensão. Tenta outra vez daqui a pouco.');
  } finally {
    botao.disabled = false;
  }
});
$('#instalar-fechar').addEventListener('click', () => $('#janela-instalar').close());
$('#instalar-copiar').addEventListener('click', async () => {
  const campo = $('#instalar-url');
  try { await navigator.clipboard.writeText(campo.value); } catch { campo.select(); document.execCommand('copy'); }
  $('#instalar-copiar').textContent = 'Copiado';
  setTimeout(() => { $('#instalar-copiar').textContent = 'Copiar'; }, 2000);
});

// ——— Botões da entrada ———

function sair() {
  guardado.apagar(CHAVE_SESSAO);
  estado = { modo: null, sessao: null, cfg: null };
  if (location.pathname !== '/' || location.search) history.replaceState(null, '', '/');
  erroEntrada('');
  mostrar('entrada');
}

$('#entrar-link').addEventListener('click', entrarComLink);
$('#cancelar-link').addEventListener('click', () => { cancelarLink?.(); mostrar('entrada'); });
$('#form-login').addEventListener('submit', entrarComPalavraPasse);
$('#ver-exemplo').addEventListener('click', () => {
  estado = { modo: 'demo', sessao: null, cfg: 'demo' };
  carregarDoServidor('demo');
});
$('#sair').addEventListener('click', sair);
$('#demo-entrar').addEventListener('click', sair);

// ——— Arranque ———

const sessao = guardado.ler(CHAVE_SESSAO);
if (pedeExemplo) {
  estado = { modo: 'demo', sessao: null, cfg: 'demo' };
  carregarDoServidor('demo');
} else if (cfgDoStremio) {
  estado = { modo: 'stremio', sessao: null, cfg: cfgDoStremio };
  carregarDoServidor(cfgDoStremio);
} else if (sessao?.authKey) {
  estado = { modo: 'conta', sessao, cfg: null };
  carregarConta();
} else {
  mostrar('entrada');
}
