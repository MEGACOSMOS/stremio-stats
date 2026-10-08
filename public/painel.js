// O painel: entrar na conta do Stremio, ler a biblioteca, ir buscar os
// detalhes de cada filme ao Cinemeta e desenhar as estatísticas.

import { lerBiblioteca, resumoCompleto, maisRecente, maisAntigo, resumirMeta, partes, horasDe } from '/estatisticas.js';
import { textos, linguaDe, LINGUAS } from '/textos.js';

const $ = (s) => document.querySelector(s);
const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Lisbon';
const API = 'https://api.strem.io/api/';
const LINK = 'https://link.stremio.com/api/v2/';
const CINEMETA = 'https://v3-cinemeta.strem.io/meta/movie/';
const CHAVE_SESSAO = 'mv-sessao';
const CHAVE_METAS = 'mv-metas-v1';
const CHAVE_LINGUA = 'mv-lingua';

const guardado = {
  ler(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  escrever(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço ou bloqueado */ } },
  apagar(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const duracao = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min` : `${min} min`);
const semAcentos = (x) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// /<cfg>/configure é o que o Stremio abre no botão "Configurar" da extensão.
const caminho = location.pathname.split('/').filter(Boolean);
const eDemo = (x) => /^demo(-[a-z]{2})?$/.test(x || '');
const cfgDoStremio = caminho.length === 2 && caminho[1] === 'configure' && !eDemo(caminho[0]) ? caminho[0] : null;
const parametros = new URLSearchParams(location.search);
const pedeExemplo = eDemo(caminho[0]) || parametros.has('exemplo');

// ——— Língua ———

const linguaEscolhida = parametros.get('lang') || guardado.ler(CHAVE_LINGUA);
let t = textos(linguaDe(linguaEscolhida, navigator.languages || [], navigator.language));

const seletor = $('#lingua');
seletor.innerHTML = Object.entries(LINGUAS).map(([codigo, nome]) => `<option value="${codigo}" lang="${codigo}">${nome}</option>`).join('');

let ultimoErro = null;
let ultimoDesenho = null;

function aplicarTextos() {
  document.documentElement.lang = t.local;
  document.title = t.titulo;
  document.querySelector('meta[name="description"]').content = t.descricao_pagina;
  seletor.value = t.lingua;
  for (const el of document.querySelectorAll('[data-t]')) {
    const chave = el.dataset.t;
    if (chave.endsWith('_html')) el.innerHTML = t[chave];
    else el.textContent = t[chave];
  }
  for (const el of document.querySelectorAll('[data-t-ph]')) el.placeholder = t[el.dataset.tPh];
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t[el.dataset.tAria]);
  if (ultimoErro) erroEntrada(ultimoErro);
}

seletor.addEventListener('change', () => {
  if (janelaFilmes.open) fecharPagina();
  t = textos(seletor.value);
  guardado.escrever(CHAVE_LINGUA, t.lingua);
  aplicarTextos();
  if (ultimoDesenho) desenhar(...ultimoDesenho);
});

// ——— Vistas ———

let estado = { modo: null, sessao: null, cfg: null };

function mostrar(vista) {
  for (const v of ['entrada', 'carregar', 'painel']) $(`#vista-${v}`).hidden = v !== vista;
  $('#instalar').hidden = vista !== 'painel';
  $('#sair').hidden = vista !== 'painel' || estado.modo === 'demo';
  if (vista === 'entrada') {
    $('#caixa-entrar').hidden = false;
    $('#caixa-codigo').hidden = true;
    ultimoDesenho = null;
  }
  window.scrollTo(0, 0);
}

// Guarda a chave do erro para o voltar a escrever se a língua mudar.
function erroEntrada(chave) {
  ultimoErro = chave || null;
  const el = $('#erro-entrada');
  el.textContent = chave ? t[chave] : '';
  el.hidden = !chave;
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
  erroEntrada(null);
  const botao = $('#entrar-link');
  botao.disabled = true;
  let codigo;
  try {
    const r = await fetch(`${LINK}create?type=Create`).then((x) => x.json());
    codigo = r.result;
    if (!codigo?.code) throw new Error('sem código');
  } catch {
    erroEntrada('erro_ligacao');
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
    erroEntrada('erro_codigo');
  }
}

async function entrarComPalavraPasse(evento) {
  evento.preventDefault();
  erroEntrada(null);
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
    erroEntrada(e.doStremio ? 'erro_senha' : 'erro_ligacao');
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
  progresso(0.02, t.a_ler);
  let itens;
  try {
    itens = await stremio('datastoreGet', { authKey: estado.sessao.authKey, collection: 'libraryItem', ids: [], all: true });
  } catch (e) {
    if (e.doStremio) {
      guardado.apagar(CHAVE_SESSAO);
      estado = { modo: null, sessao: null, cfg: null };
      mostrar('entrada');
      erroEntrada('erro_sessao');
    } else {
      mostrar('entrada');
      erroEntrada('erro_recarregar');
    }
    return;
  }
  await construir(itens);
}

// A biblioteca vem do servidor da extensão (exemplo, ou aberto a partir do Stremio).
async function carregarDoServidor(cfg) {
  mostrar('carregar');
  progresso(0.02, eDemo(cfg) ? t.a_preparar : t.a_ler);
  try {
    const r = await fetch(`/${encodeURIComponent(cfg)}/biblioteca.json`);
    if (!r.ok) throw Object.assign(new Error(String(r.status)), { estado: r.status });
    const { itens, lingua } = await r.json();
    // Aberto a partir do Stremio sem língua escolhida neste navegador: a da extensão.
    if (lingua && !linguaEscolhida && !eDemo(cfg) && lingua !== t.lingua) {
      t = textos(lingua);
      aplicarTextos();
    }
    await construir(itens);
  } catch (e) {
    estado = { modo: null, sessao: null, cfg: null };
    history.replaceState(null, '', '/');
    mostrar('entrada');
    erroEntrada(e.estado === 401 || e.estado === 404 ? 'erro_link' : 'erro_historico');
  }
}

// ——— Cinemeta: géneros, realizadores, notas… ———

async function detalhes(ids) {
  const cache = guardado.ler(CHAVE_METAS) || {};
  const fila = [...new Set(ids)].filter((id) => !(id in cache));
  const total = fila.length;
  let feitos = 0;
  if (total) progresso(0.05, t.a_juntar(t.filmes(total)), t.x_de_y(0, t.numero(total)));
  async function trabalhador() {
    while (fila.length) {
      const id = fila.shift();
      try {
        const r = await fetch(`${CINEMETA}${id}.json`);
        if (r.ok) cache[id] = resumirMeta((await r.json()).meta);
        else if (r.status === 404) cache[id] = {};
      } catch { /* fica para a próxima visita */ }
      feitos += 1;
      progresso(0.05 + 0.93 * (feitos / total), null, t.x_de_y(t.numero(feitos), t.numero(total)));
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
  ultimoDesenho = [r, vistos, porAcabar];
}

// ——— Gráficos ———

const dica = $('#dica');

function ligarDicas(alvo, seletorMarca, conteudo) {
  for (const el of alvo.querySelectorAll(seletorMarca)) {
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
  return `<details class="tabela"><summary>${esc(t.ver_tabela)}</summary><div class="tabela-rolar"><table>
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

// Nomes de alguns filmes para a dica, e o convite a clicar.
function detalheDica(valor, filmesDaBarra = [], max = 5) {
  const nomes = filmesDaBarra.map((f) => f.nome);
  return `${esc(t.filmes(valor))}${nomes.length
    ? `<br>${esc(nomes.slice(0, max).join(', '))}${nomes.length > max ? esc(t.e_mais(nomes.length - max)) : ''}
       <br><em>${esc(t.dica_clicar)}</em>`
    : ''}`;
}

const semDados = () => `<p class="mudo pequeno">${esc(t.sem_dados)}</p>`;

// Barras com filmes são botões: clicar (ou Enter/Espaço) abre a página com
// todos os filmes dessa barra.
const atributosMarca = (d) => (d.filmes?.length ? 'role="button" tabindex="0"' : 'role="img" tabindex="0"');

function ligarCliques(alvo, seletorMarca, dados, contexto) {
  for (const el of alvo.querySelectorAll(seletorMarca)) {
    const d = dados[Number(el.dataset.i)];
    if (!d.filmes?.length) continue;
    const abrir = () => { dica.hidden = true; abrirPagina(d.titulo, contexto, d.filmes); };
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  }
}

// dados: [{ x, valor, titulo, filmes? }]
function colunas(alvo, dados, cabecalho, contexto) {
  const max = Math.max(0, ...dados.map((d) => d.valor));
  const { passo, topo } = escala(max);
  const marcas = [];
  for (let v = 0; v <= topo; v += passo) marcas.push(v);
  const iMax = dados.findIndex((d) => d.valor === max);
  const pct = (v) => `${(v / topo) * 100}%`;
  alvo.innerHTML = `<div class="colunas">
    <div class="eixo-y" aria-hidden="true">${marcas.map((v) => `<span style="bottom:${pct(v)}">${t.numero(v)}</span>`).join('')}</div>
    <div class="area">
      ${marcas.slice(1).map((v) => `<div class="guia" style="bottom:${pct(v)}"></div>`).join('')}
      <div class="barras">${dados.map((d, i) => `<div ${atributosMarca(d)} class="barra${d.filmes?.length ? ' clicavel' : ''}" data-i="${i}"
        aria-label="${esc(`${d.titulo}: ${t.filmes(d.valor)}`)}"><i style="height:${pct(d.valor)}"></i>${
        i === iMax && max > 0 ? `<b style="bottom:${pct(max)}">${t.numero(max)}</b>` : ''}</div>`).join('')}</div>
    </div>
    <div class="eixo-x" aria-hidden="true">${dados.map((d) => `<span>${esc(d.x)}</span>`).join('')}</div>
  </div>${tabela(cabecalho, dados.map((d) => [d.titulo, t.numero(d.valor)]))}`;
  ligarDicas(alvo, '.barra', (i) => ({ titulo: dados[i].titulo, detalhe: detalheDica(dados[i].valor, dados[i].filmes) }));
  ligarCliques(alvo, '.barra', dados, contexto);
}

// dados: [{ nome, valor, filmes? }]
function linhas(alvo, dados, cabecalho, contexto) {
  if (!dados.length) {
    alvo.innerHTML = semDados();
    return;
  }
  const max = Math.max(1, ...dados.map((d) => d.valor));
  for (const d of dados) d.titulo = d.nome;
  alvo.innerHTML = `<div class="linhas">${dados.map((d, i) => `<div ${atributosMarca(d)} class="linha${d.filmes?.length ? ' clicavel' : ''}" data-i="${i}"
      aria-label="${esc(`${d.nome}: ${t.filmes(d.valor)}`)}">
      <span class="nome">${esc(d.nome)}</span>
      <span class="pista"><i style="width:calc(${d.valor / max} * (100% - 3em))"></i><b>${t.numero(d.valor)}</b></span>
    </div>`).join('')}</div>${tabela(cabecalho, dados.map((d) => [d.nome, t.numero(d.valor)]))}`;
  ligarDicas(alvo, '.linha', (i) => ({ titulo: dados[i].nome, detalhe: detalheDica(dados[i].valor, dados[i].filmes) }));
  ligarCliques(alvo, '.linha', dados, contexto);
}

// ——— A página com os filmes de uma barra ———

const janelaFilmes = $('#janela-filmes');
let paginaNoHistorico = false;

function abrirPagina(titulo, contexto, filmesDaBarra) {
  const ordenados = [...filmesDaBarra].sort(maisRecente);
  $('#pagina-titulo').textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  $('#pagina-sub').textContent = `${contexto} · ${t.filmes(ordenados.length)}`;
  $('#pagina-filmes').innerHTML = ordenados.map(cartaoFilme).join('');
  if (!janelaFilmes.open) {
    janelaFilmes.showModal();
    // O botão "anterior" do navegador (ou do telemóvel) fecha a página.
    history.pushState({ pagina: true }, '', '#filmes');
    paginaNoHistorico = true;
  }
  janelaFilmes.scrollTop = 0;
  $('#pagina-voltar').focus();
}

function fecharPagina() {
  if (paginaNoHistorico) {
    paginaNoHistorico = false;
    history.back(); // o popstate fecha a janela
  } else if (janelaFilmes.open) janelaFilmes.close();
}

$('#pagina-voltar').addEventListener('click', fecharPagina);
janelaFilmes.addEventListener('cancel', (e) => { e.preventDefault(); fecharPagina(); }); // tecla Esc
addEventListener('popstate', () => {
  paginaNoHistorico = false;
  if (janelaFilmes.open) janelaFilmes.close();
});

// ——— Desenhar o painel ———

let lista = { vistos: [], mostrados: 60 };

function desenhar(r, vistos, porAcabar) {
  $('#aviso-demo').hidden = estado.modo !== 'demo';

  // O número grande
  $('#ola').textContent = estado.sessao?.nome ? t.ola(estado.sessao.nome) : t.ja_viste;
  $('#total').innerHTML = `${t.numero(r.total)}<small>${esc(t.filme_palavra(r.total))}</small>`;
  const horasCinema = Math.round(r.minutosVistos / 60);
  const inicio = r.desde ? partes(r.desde, FUSO) : null;
  $('#frase').textContent = r.total
    ? [inicio && t.desde(t.meses[inicio.mes - 1], inicio.ano), horasCinema && t.horas_cinema(t.numero(horasCinema)),
      r.notaMedia && t.nota_media_frase(t.decimal(r.notaMedia))].filter(Boolean).join(' · ')
    : t.sem_filmes;

  // Os quadradinhos
  const anoPassado = r.porAno.get(r.anoAtual - 1) || 0;
  const decadaFavorita = r.decadas.length ? [...r.decadas].sort((a, b) => b[1] - a[1])[0] : null;
  const tiles = [
    [t.t_horas, t.numero(horasCinema), horasCinema >= 24 ? t.t_dias_seguidos(t.numero(horasCinema / 24)) : t.t_duracao],
    [t.t_tempo, `${t.numero(horasDe(r.tempoReal))} h`, t.t_tempo_nota],
    [t.t_ano(r.anoAtual), t.numero(r.esteAno), t.t_ano_nota(t.filmes(anoPassado), r.anoAtual - 1)],
    [t.t_revistos, t.numero(r.revistos), t.t_revistos_nota],
    r.notaMedia && [t.t_nota, t.decimal(r.notaMedia), t.t_nota_nota],
    r.generos[0] && [t.t_genero, t.genero(r.generos[0][0]), t.filmes(r.generos[0][1]), true],
    decadaFavorita && [t.t_decada, t.decada(decadaFavorita[0]), t.filmes(decadaFavorita[1]), true],
    r.realizadores[0] && [t.t_realizador, r.realizadores[0][0], t.filmes(r.realizadores[0][1]), true],
  ].filter(Boolean);
  $('#mosaico').innerHTML = tiles.map(([rotulo, valor, nota, texto]) => `<div class="tile">
    <div class="rotulo">${esc(rotulo)}</div><div class="valor${texto ? ' texto' : ''}">${esc(valor)}</div>
    <div class="nota">${esc(nota)}</div></div>`).join('');

  // Ao longo do tempo
  const filmesPor = (chave) => {
    const m = new Map();
    for (const f of vistos) {
      if (!f.quando) continue;
      const k = chave(partes(f.quando, FUSO));
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    }
    return m;
  };
  const porMesFilmes = filmesPor((p) => `${p.ano}-${String(p.mes).padStart(2, '0')}`);
  const porAnoFilmes = filmesPor((p) => p.ano);
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
          x: mes === 1 ? String(ano) : mes % 3 === 1 ? t.mesesCurtos[mes - 1] : '',
          valor: r.porMes.get(k) || 0, titulo: t.mesAno(k), filmes: porMesFilmes.get(k) || [],
        });
      }
      colunas($('#g-tempo'), dados, [t.col_mes, t.col_filmes], t.g_tempo);
    },
    ano: () => {
      const anos = [...r.porAno.keys()];
      const dados = [];
      if (anos.length) for (let a = anos[0]; a <= agora.ano; a++) dados.push({ x: String(a), valor: r.porAno.get(a) || 0, titulo: String(a), filmes: porAnoFilmes.get(a) || [] });
      colunas($('#g-tempo'), dados, [t.col_ano, t.col_filmes], t.g_tempo);
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
  const filmesDe = (campo) => {
    const m = new Map();
    for (const f of vistos) for (const v of f[campo] || []) { if (!m.has(v)) m.set(v, []); m.get(v).push(f); }
    return m;
  };
  const porGenero = filmesDe('generos');
  linhas($('#g-generos'), r.generos.slice(0, 10).map(([g, n]) => ({ nome: t.genero(g), valor: n, filmes: porGenero.get(g) })), [t.col_genero, t.col_filmes], t.g_generos);
  const porDecada = new Map();
  for (const f of vistos) if (f.ano) { const d = Math.floor(f.ano / 10) * 10; if (!porDecada.has(d)) porDecada.set(d, []); porDecada.get(d).push(f); }
  if (r.decadas.length) {
    const dados = [];
    for (let d = r.decadas[0][0]; d <= r.decadas[r.decadas.length - 1][0]; d += 10) {
      dados.push({ x: String(d), valor: porDecada.get(d)?.length || 0, titulo: t.decada(d), filmes: porDecada.get(d) || [] });
    }
    colunas($('#g-decadas'), dados, [t.col_decada, t.col_filmes], t.g_decadas);
  } else $('#g-decadas').innerHTML = semDados();

  // Dias e horas
  const porDiaFilmes = filmesPor((p) => p.semana);
  colunas($('#g-dias'), t.diasCurtos.map((d, i) => ({ x: d, valor: r.porSemana[i], titulo: t.dias[i], filmes: porDiaFilmes.get(i) || [] })), [t.col_dia, t.col_filmes], t.g_dias);
  const avisoData = r.semData ? t.sem_data_aviso(t.filmes(r.semData), r.semData) : '';
  $('#t-tempo').textContent = t.sub_tempo + avisoData;
  $('#t-dias').textContent = (r.ultimos.length ? t.ves_mais(t.noDia(r.diaFavorito)) : '') + avisoData;
  const porHoraFilmes = filmesPor((p) => p.hora);
  colunas($('#g-horas'), r.porHora.map((n, h) => ({ x: h % 3 === 0 ? t.hora(h) : '', valor: n, titulo: t.das_as(h, (h + 1) % 24), filmes: porHoraFilmes.get(h) || [] })), [t.col_hora, t.col_filmes], t.g_horas);
  $('#t-horas').textContent = (r.ultimos.length ? t.sub_horas(t.periodo(r.horaFavorita)) : '') + avisoData;

  // Realizadores, atores, países
  const porRealizador = filmesDe('realizadores');
  const porAtor = filmesDe('elenco');
  const porPais = filmesDe('paises');
  linhas($('#g-realizadores'), r.realizadores.slice(0, 8).map(([n, v]) => ({ nome: n, valor: v, filmes: porRealizador.get(n) })), [t.col_realizador, t.col_filmes], t.g_realizadores);
  linhas($('#g-atores'), r.atores.slice(0, 8).map(([n, v]) => ({ nome: n, valor: v, filmes: porAtor.get(n) })), [t.col_ator, t.col_filmes], t.g_atores);
  linhas($('#g-paises'), r.paises.slice(0, 8).map(([n, v]) => ({ nome: t.pais(n), valor: v, filmes: porPais.get(n) })), [t.col_pais, t.col_filmes], t.g_paises);

  // Destaques
  const maisRevisto = r.maisRevistos[0];
  const destaques = [
    r.melhores[0] && [t.d_melhor, r.melhores[0], t.no_imdb(t.decimal(r.melhores[0].nota))],
    r.piores[0] && r.piores[0] !== r.melhores[0] && [t.d_pior, r.piores[0], t.no_imdb(t.decimal(r.piores[0].nota))],
    r.maisLongo && [t.d_longo, r.maisLongo, duracao(r.maisLongo.minutos)],
    r.maisCurto && r.maisCurto !== r.maisLongo && [t.d_curto, r.maisCurto, duracao(r.maisCurto.minutos)],
    r.maisAntigo && [t.d_antigo, r.maisAntigo, t.estreou(r.maisAntigo.ano)],
    maisRevisto && [t.d_revisto, maisRevisto, t.visto_vezes(t.vezes(maisRevisto.vezes))],
  ].filter(Boolean);
  $('#destaques').innerHTML = destaques.map(([etiqueta, f, det]) => `<a class="destaque" href="${linkStremio(f.id)}" title="${esc(t.abrir_stremio)}">
      <span class="etiqueta">${esc(etiqueta)}</span>${capa(f)}
      <span class="titulo">${esc(f.nome)}</span><span class="det">${esc(det)}</span></a>`).join('')
    || semDados();

  // A meio
  $('#cartao-meio').hidden = !porAcabar.length;
  $('#meio').innerHTML = porAcabar.slice(0, 12).map((f) => {
    const visto = t.pct_visto(Math.round(f.progresso * 100));
    return `<a class="filme" href="${linkStremio(f.id)}" title="${esc(t.continuar_stremio)}">
      ${capa(f, `<span class="meio" aria-label="${esc(visto)}"><i style="width:${f.progresso * 100}%"></i></span>`)}
      <span class="titulo">${esc(f.nome)}</span><span class="det">${esc(visto)}</span></a>`;
  }).join('');

  // A lista toda (mantém os filtros escolhidos se a língua mudar)
  const generoAntes = $('#filtro-genero').value;
  const anoAntes = $('#filtro-ano').value;
  const mesmaLista = lista.vistos === vistos;
  lista = { vistos, mostrados: mesmaLista ? lista.mostrados : 60 };
  $('#filtro-genero').innerHTML = `<option value="">${esc(t.todos_generos)}</option>`
    + r.generos.map(([g, n]) => `<option value="${esc(g)}">${esc(t.genero(g))} (${n})</option>`).join('');
  const anos = [...r.porAno].sort((a, b) => b[0] - a[0]);
  $('#filtro-ano').innerHTML = `<option value="">${esc(t.qualquer_ano)}</option>`
    + anos.map(([a, n]) => `<option value="${a}">${esc(t.vistos_em(a, n))}</option>`).join('')
    + (r.semData ? `<option value="sem">${esc(t.sem_data_certa(r.semData))}</option>` : '');
  if (mesmaLista) {
    $('#filtro-genero').value = generoAntes;
    $('#filtro-ano').value = anoAntes;
  } else $('#procurar').value = '';
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
  recentes: maisRecente,
  antigos: maisAntigo,
  nota: (a, b) => (b.nota || 0) - (a.nota || 0),
  estreia: (a, b) => (b.ano || 0) - (a.ano || 0),
  revistos: (a, b) => b.vezes - a.vezes || maisRecente(a, b),
  az: (a, b) => a.nome.localeCompare(b.nome, t.local),
};

function desenharLista() {
  const q = semAcentos($('#procurar').value.trim());
  const g = $('#filtro-genero').value;
  const ano = $('#filtro-ano').value;
  const doAno = (f) => !ano || (ano === 'sem' ? !f.quando : f.quando && partes(f.quando, FUSO).ano === Number(ano));
  const escolhidos = lista.vistos
    .filter((f) => (!g || f.generos.includes(g)) && doAno(f)
      && (!q || semAcentos([f.nome, ...f.realizadores, ...f.elenco].join(' ')).includes(q)))
    .sort(ORDENAR[$('#ordem').value] || ORDENAR.recentes);
  const total = lista.vistos.length;
  $('#t-lista').textContent = escolhidos.length === total ? t.filmes(total) : t.n_de_total(t.filmes(escolhidos.length), t.numero(total));
  $('#lista').innerHTML = escolhidos.slice(0, lista.mostrados).map(cartaoFilme).join('')
    || `<p class="mudo">${esc(t.nenhum)}</p>`;
  $('#ver-mais').hidden = escolhidos.length <= lista.mostrados;
}

// Capa, título, ano · nota · quando o viste. Usado na lista e na página de uma barra.
function cartaoFilme(f) {
  const p = f.quando ? partes(f.quando, FUSO) : null;
  const quando = p ? `${p.dia} ${t.mesesCurtos[p.mes - 1]} ${p.ano}` : t.sem_data;
  return `<a class="filme" href="${linkStremio(f.id)}" title="${esc(t.abrir_stremio)}">
      ${capa(f)}<span class="titulo">${esc(f.nome)}</span>
      <span class="det">${[f.ano, f.nota && `★ ${t.decimal(f.nota)}`, quando].filter(Boolean).map(esc).join(' · ')}</span></a>`;
}

$('#procurar').addEventListener('input', () => { lista.mostrados = 60; desenharLista(); });
$('#ordem').addEventListener('change', () => { lista.mostrados = 60; desenharLista(); });
$('#filtro-genero').addEventListener('change', () => { lista.mostrados = 60; desenharLista(); });
$('#filtro-ano').addEventListener('change', () => { lista.mostrados = 60; desenharLista(); });
$('#descarregar').addEventListener('click', descarregar);
$('#ver-mais').addEventListener('click', () => { lista.mostrados += 120; desenharLista(); });

// Lista em CSV com ";" e acentos, que o Excel abre bem.
function descarregar() {
  const celula = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const dataHora = (ms) => {
    const p = partes(ms, FUSO);
    return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')} ${String(p.hora).padStart(2, '0')}h`;
  };
  const linhasCsv = [t.csv_colunas]
    .concat([...lista.vistos].sort(maisRecente).map((f) => [
      f.nome, f.ano || '',
      f.quando ? dataHora(f.quando) : f.dataStremio ? dataHora(f.dataStremio) : '',
      f.quando ? t.csv_sim : t.csv_nao,
      f.vezes, f.generos.map(t.genero).join(', '), f.realizadores.join(', '),
      f.nota ? t.decimal(f.nota) : '', f.minutos || '',
    ]));
  const texto = '﻿' + linhasCsv.map((l) => l.map(celula).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  a.download = t.csv_ficheiro;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ——— Instalar a extensão no Stremio ———

// O link leva a língua do painel, por isso é feito de novo de cada vez.
async function linkDaExtensao() {
  if (estado.modo === 'demo') return t.lingua === 'pt' ? 'demo' : `demo-${t.lingua}`;
  const pedido = estado.modo === 'conta' ? { authKey: estado.sessao.authKey } : { cfg: estado.cfg };
  const r = await fetch('/api/ligar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pedido, fuso: FUSO, lingua: t.lingua }),
  });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).cfg;
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
    $('#instalar-cuidado').hidden = eDemo(cfg);
    $('#janela-instalar').showModal();
  } catch {
    alert(t.erro_instalar);
  } finally {
    botao.disabled = false;
  }
});
$('#instalar-fechar').addEventListener('click', () => $('#janela-instalar').close());
$('#instalar-copiar').addEventListener('click', async () => {
  const campo = $('#instalar-url');
  try { await navigator.clipboard.writeText(campo.value); } catch { campo.select(); document.execCommand('copy'); }
  $('#instalar-copiar').textContent = t.copiado;
  setTimeout(() => { $('#instalar-copiar').textContent = t.copiar; }, 2000);
});

// ——— Botões da entrada ———

function sair() {
  guardado.apagar(CHAVE_SESSAO);
  estado = { modo: null, sessao: null, cfg: null };
  if (location.pathname !== '/' || location.search) history.replaceState(null, '', '/');
  erroEntrada(null);
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

aplicarTextos();
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
