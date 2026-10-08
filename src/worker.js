// A extensão para o Stremio (e o servidor do painel).
//
// O Stremio não diz às extensões quem é o utilizador, por isso o link de
// instalação leva consigo a chave de sessão do Stremio, cifrada com o SEGREDO
// deste Worker: quem visse o link não ficava com acesso à conta, só às
// estatísticas. Leva também o fuso horário e a língua escolhida no painel.
//
//   /manifest.json                       extensão por configurar
//   /<cfg>/manifest.json                 extensão de uma pessoa
//   /<cfg>/catalog/movie/<id>[/<extra>].json
//   /<cfg>/meta/movie/mvest:<cartão>.json
//   /<cfg>/biblioteca.json               filmes da biblioteca, para o painel
//   /<cfg>/configure                     o painel (botão "Configurar" do Stremio)
//   /api/ligar                           cria o <cfg> (a partir da chave de sessão ou de outro <cfg>)
//   /cartao.svg                          capa dos cartões de estatísticas
//
// <cfg> = "demo" (ou "demo-en", "demo-fr"…) usa a biblioteca de exemplo em src/demo.json.

import DEMO from './demo.json';
import { lerBiblioteca, resumoBase, maisAntigo, maisRecente, partes as partesData, horasDe, fundoDe } from '../public/estatisticas.js';
import { textos, linguaDe, LINGUAS } from '../public/textos.js';

const VERSAO = '1.1.0';
const PREFIXO = 'mvest:';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (dados, { estado = 200, cache = 0 } = {}) => new Response(JSON.stringify(dados), {
  status: estado,
  headers: {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache ? `public, max-age=${cache}` : 'no-store',
  },
});

class SessaoInvalida extends Error {}

export default {
  async fetch(pedido, env) {
    if (pedido.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(pedido.url);
    const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      return await encaminhar(pedido, env, url, partes);
    } catch (erro) {
      if (erro instanceof SessaoInvalida) return json({ erro: 'sessao' }, { estado: 401 });
      console.error(erro);
      return json({ erro: 'interno' }, { estado: 500 });
    }
  },
};

const linguaDoPedido = (pedido) => linguaDe((pedido.headers.get('Accept-Language') || '').split(','));

async function encaminhar(pedido, env, url, partes) {
  const origem = url.origin;
  if (partes[0] === 'manifest.json') return json(manifesto(origem, null, textos(linguaDoPedido(pedido))));
  if (partes[0] === 'cartao.svg') return cartaoSvg(url.searchParams);
  if (partes[0] === 'configure') return painel(env, origem);
  if (partes[0] === 'api' && partes[1] === 'ligar' && pedido.method === 'POST') {
    const { authKey, cfg: outro, fuso, lingua } = await pedido.json().catch(() => ({}));
    // Mudar a língua de um link que já existe (painel aberto a partir do Stremio).
    const antigo = typeof outro === 'string' ? await lerCfg(env, outro) : null;
    const chaveSessao = typeof authKey === 'string' && authKey ? authKey : antigo?.k;
    if (!chaveSessao) return json({ erro: 'pedido' }, { estado: 400 });
    await biblioteca(chaveSessao); // confirma que a sessão é válida antes de dar um link
    const dados = { k: chaveSessao, f: fuso || antigo?.f, l: lingua in LINGUAS ? lingua : antigo?.l };
    return json({ cfg: await cifrar(env, dados) });
  }

  if (partes.length < 2) return new Response('Não encontrado', { status: 404, headers: CORS });
  const [cfgTexto, recurso] = partes;
  const cfg = await lerCfg(env, cfgTexto);
  if (!cfg) return json({ erro: 'link' }, { estado: 404 });
  const base = `${origem}/${encodeURIComponent(cfgTexto)}`;
  const t = textos(cfg.l || 'pt');

  if (recurso === 'manifest.json') return json(manifesto(origem, cfg, t), { cache: 3600 });
  if (recurso === 'configure') return painel(env, origem);

  let itens;
  try {
    itens = cfg.demo ? DEMO : await biblioteca(cfg.k);
  } catch (erro) {
    if (!(erro instanceof SessaoInvalida)) throw erro;
    if (recurso === 'catalog') return json({ metas: [cartaoSessao(origem, t)], cacheMaxAge: 60 });
    if (recurso === 'meta') return json({ meta: cartaoSessao(origem, t) });
    throw erro;
  }

  if (recurso === 'biblioteca.json') {
    return json({ itens: itens.filter((i) => i && i.type === 'movie'), demo: !!cfg.demo, lingua: cfg.l || null });
  }

  const { vistos } = lerBiblioteca(itens);
  const fuso = cfg.f || 'Europe/Lisbon';

  if (recurso === 'catalog') {
    const [, , tipo, id, extraTexto] = partes;
    if (tipo !== 'movie') return json({ metas: [] });
    const extra = Object.fromEntries(new URLSearchParams((extraTexto || '').replace(/\.json$/, '')));
    const catId = id.replace(/\.json$/, '');
    if (catId === 'mv-estatisticas') {
      return json({ metas: cartoes(vistos, fuso, origem, base, t).map(previa), cacheMaxAge: 300 });
    }
    if (catId === 'mv-vistos') {
      const lista = ordenar(vistos, extra.genre, t);
      const salto = Math.max(0, parseInt(extra.skip, 10) || 0);
      return json({
        metas: lista.slice(salto, salto + 100).map((f) => ({
          id: f.id, type: 'movie', name: f.nome, poster: f.poster, posterShape: 'poster',
        })),
        cacheMaxAge: 300,
      });
    }
    return json({ metas: [] });
  }

  if (recurso === 'meta') {
    const id = (partes[3] || '').replace(/\.json$/, '');
    const cartao = cartoes(vistos, fuso, origem, base, t).find((c) => c.id === id);
    return cartao ? json({ meta: cartao, cacheMaxAge: 300 }) : json({ meta: null }, { estado: 404 });
  }

  return new Response('Não encontrado', { status: 404, headers: CORS });
}

// ——— Stremio ———

function manifesto(origem, cfg, t) {
  const m = {
    id: 'community.estatisticas.filmes',
    version: VERSAO,
    name: t.ext_nome,
    description: t.ext_descricao,
    logo: `${origem}/logo.svg`,
    background: `${origem}/fundo.svg`,
    types: ['movie'],
    resources: ['catalog', { name: 'meta', types: ['movie'], idPrefixes: [PREFIXO] }],
    idPrefixes: [PREFIXO],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: !cfg },
  };
  if (cfg) {
    m.catalogs = [
      { type: 'movie', id: 'mv-estatisticas', name: t.cat_estatisticas },
      {
        type: 'movie', id: 'mv-vistos', name: t.cat_vistos,
        extra: [{ name: 'genre', options: t.ordens, isRequired: false }, { name: 'skip', isRequired: false }],
        extraSupported: ['genre', 'skip'],
      },
    ];
    if (cfg.demo) m.name += t.ext_exemplo;
  }
  return m;
}

// O Stremio devolve o texto da opção escolhida em "Descobrir".
function ordenar(vistos, ordem, t) {
  const lista = [...vistos];
  const qual = t.ordens.indexOf(ordem);
  if (qual === 1) return lista.sort(maisAntigo);
  if (qual === 2) return lista.sort((a, b) => b.vezes - a.vezes || maisRecente(a, b));
  if (qual === 3) return lista.sort((a, b) => a.nome.localeCompare(b.nome, t.local));
  return lista; // já vêm do mais recente para o mais antigo
}

const previa = ({ id, type, name, poster, posterShape, description }) => ({ id, type, name, poster, posterShape, description });

const linhas = (itens) => itens.map((x) => `• ${x}`).join('\n');
const barra = (n, max) => '█'.repeat(Math.max(n ? 1 : 0, Math.round((n / (max || 1)) * 12)));
const maiuscula = (x) => x.charAt(0).toUpperCase() + x.slice(1);

// Os "filmes" falsos que aparecem na fila "As minhas estatísticas".
function cartoes(vistos, fuso, origem, base, t) {
  const r = resumoBase(vistos, { fuso });
  const painelUrl = `${base}/configure`;
  const fundo = r.ultimos[0]?.id?.startsWith('tt') ? fundoDe(r.ultimos[0].id) : `${origem}/fundo.svg`;
  const data = (ms) => t.dataLonga(ms, fuso);
  const lista = [];
  const cartao = (chave, rotulo, valor, sub, nome, descricao) => {
    const capa = new URL(`${origem}/cartao.svg`);
    capa.search = new URLSearchParams({ r: rotulo, v: valor, s: sub, c: String(lista.length), m: t.marca_cartao }).toString();
    lista.push({
      id: PREFIXO + chave, type: 'movie', name: nome, poster: capa.toString(), posterShape: 'poster',
      background: fundo, description: descricao, releaseInfo: rotulo,
      links: [{ name: t.link_painel, category: t.link_categoria, url: painelUrl }],
      behaviorHints: { defaultVideoId: null },
    });
  };

  if (!r.total) {
    const [rotulo, sub, nome, desc] = t.c_vazio;
    cartao('vazio', rotulo, '0', sub, nome, desc);
    return lista;
  }

  const inicio = r.desde ? partesData(r.desde, fuso) : null;
  cartao('total', t.c_total_rotulo, t.numero(r.total),
    inicio ? t.c_total_desde(t.mesesCurtos[inicio.mes - 1], inicio.ano) : t.c_total_sem_data,
    t.c_total_nome(t.filmes(r.total)),
    t.c_total_desc(t.filmes(r.total), r.desde ? data(r.desde) : null)
    + (r.revistos ? t.c_total_revistos(r.revistos, t.numero(r.vezesTotal)) : '')
    + `\n\n${t.c_total_painel}`);

  const horas = horasDe(r.tempoReal);
  if (horas > 0) {
    const dias = r.tempoReal / 864e5;
    cartao('horas', t.c_horas_rotulo, `${t.numero(horas)} h`,
      dias >= 1 ? t.c_horas_dias(t.numero(dias), Math.round(dias) === 1) : t.c_horas_sub,
      t.c_horas_nome(t.numero(horas)),
      `${t.c_horas_desc(t.numero(horas), dias >= 1 ? t.numero(dias) : null)}\n\n${t.c_horas_nota}`);
  }

  cartao('ano', t.t_ano(r.anoAtual), t.numero(r.esteAno), t.c_ano_sub(r.esteAno),
    t.c_ano_nome(t.filmes(r.esteAno), r.anoAtual),
    r.esteAno
      ? `${t.c_ano_desc(t.filmes(r.esteAno))}\n${linhas(r.vistosEsteAno.slice(0, 25).map((f) => f.nome))}${r.esteAno > 25 ? `\n${t.c_ano_mais(r.esteAno - 25)}` : ''}`
      : t.c_ano_nenhum(r.anoAtual));

  const semData = r.semData ? `\n\n${t.c_sem_data(t.filmes(r.semData), r.semData)}` : '';
  const ultimo = r.ultimos[0];
  if (ultimo) {
    cartao('ultimo', t.c_ultimo_rotulo, ultimo.nome, ultimo.quando ? data(ultimo.quando) : '',
      t.c_ultimo_nome(ultimo.nome),
      `${t.c_ultimo_desc}\n${linhas(r.ultimos.map((f) => `${f.nome}${f.quando ? ` — ${data(f.quando)}` : ''}`))}`);
  }

  if (r.maisRevistos.length) {
    const top = r.maisRevistos[0];
    cartao('revisto', t.c_revisto_rotulo, top.nome, t.visto_vezes(t.vezes(top.vezes)),
      t.c_revisto_nome(top.nome),
      `${t.c_revisto_desc}\n${linhas(r.maisRevistos.map((f) => `${f.nome} — ${t.vezes(f.vezes)}`))}`);
  }

  if (r.ultimos.length) {
    const maxDia = Math.max(...r.porSemana);
    const dia = maiuscula(t.dias[r.diaFavorito]);
    cartao('dia', t.c_dia_rotulo, dia, t.filmes(maxDia), t.c_dia_nome(t.dias[r.diaFavorito]),
      `${t.c_dia_desc(t.noDia(r.diaFavorito))}\n${linhas(t.dias.map((d, i) => `${d}: ${barra(r.porSemana[i], maxDia)} ${r.porSemana[i]}`))}`
      + `\n\n${t.c_dia_nota}${semData}`);

    const h = r.horaFavorita;
    const periodos = [[5, 12], [12, 19], [19, 24], [0, 5]]
      .map(([de, ate], i) => [t.periodos[i], r.porHora.slice(de, ate).reduce((a, b) => a + b, 0)]);
    const maxPeriodo = Math.max(...periodos.map((p) => p[1]));
    cartao('hora', t.c_hora_rotulo, t.hora(h), t.c_hora_sub(t.periodo(h)), t.c_hora_nome(h),
      `${t.c_hora_desc(h)}\n${linhas(periodos.map(([nome, n]) => `${nome}: ${barra(n, maxPeriodo)} ${n}`))}${semData}`);
  }

  if (r.melhorMes) {
    const meses = [...r.porMes].sort((a, b) => b[1] - a[1]).slice(0, 5);
    cartao('mes', t.c_mes_rotulo, t.mesAno(r.melhorMes[0], true), t.filmes(r.melhorMes[1]),
      t.c_mes_nome(t.mesAno(r.melhorMes[0])),
      `${t.c_mes_desc}\n${linhas(meses.map(([m, n]) => `${t.mesAno(m)} — ${t.filmes(n)}`))}${semData}`);
  }

  const [rotulo, valor, sub, nome, desc] = t.c_painel;
  cartao('painel', rotulo, valor, sub, nome, desc);
  return lista;
}

function cartaoSessao(origem, t) {
  const [rotulo, valor, sub, nome, desc, link] = t.c_sessao;
  const capa = `${origem}/cartao.svg?${new URLSearchParams({ r: rotulo, v: valor, s: sub, c: '0', m: t.marca_cartao })}`;
  return {
    id: `${PREFIXO}sessao`, type: 'movie', name: nome, poster: capa, posterShape: 'poster', description: desc,
    links: [{ name: link, category: t.link_categoria, url: `${origem}/` }],
  };
}

// ——— Capas dos cartões ———

const CORES = [['#5b3fd1', '#1b1035'], ['#c2410c', '#2a1208'], ['#0f766e', '#071f1d'], ['#a21caf', '#26082a'],
  ['#1d4ed8', '#0a1633'], ['#b45309', '#271605'], ['#be123c', '#2a0711'], ['#4d7c0f', '#121d05'], ['#6d28d9', '#170b2e']];

const escapar = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Parte um texto em linhas de até `largura` caracteres.
function partir(texto, largura, maxLinhas) {
  const palavras = String(texto).split(/\s+/);
  const res = [];
  let atual = '';
  for (const p of palavras) {
    if (atual && (atual + ' ' + p).length > largura) { res.push(atual); atual = p; } else atual = atual ? `${atual} ${p}` : p;
  }
  if (atual) res.push(atual);
  if (res.length > maxLinhas) {
    res.length = maxLinhas;
    res[maxLinhas - 1] = res[maxLinhas - 1].replace(/\s*\S*$/, '') + '…';
  }
  return res;
}

function cartaoSvg(q) {
  const rotulo = (q.get('r') || '').slice(0, 40);
  const valor = (q.get('v') || '').slice(0, 60);
  const sub = (q.get('s') || '').slice(0, 40);
  const marca = (q.get('m') || 'ESTATÍSTICAS').slice(0, 20);
  const [cor, escuro] = CORES[(parseInt(q.get('c'), 10) || 0) % CORES.length];
  // Números grandes; nomes de filmes em várias linhas, mais pequenos.
  const curto = valor.length <= 7;
  const tamanho = curto ? (valor.length <= 4 ? 120 : 84) : valor.length <= 14 ? 44 : 36;
  const linhasValor = curto ? [valor] : partir(valor, tamanho > 40 ? 11 : 13, 4);
  const altura = tamanho * 1.08;
  const topo = 248 - ((linhasValor.length - 1) * altura) / 2;
  const texto = linhasValor.map((l, i) => `<text x="32" y="${topo + i * altura}" class="v">${escapar(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${cor}"/><stop offset="1" stop-color="${escuro}"/></linearGradient>
<radialGradient id="b" cx="0.9" cy="0.05" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<style>text{font-family:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;fill:#fff}.r{font-size:20px;font-weight:600;opacity:.85}.v{font-size:${tamanho}px;font-weight:800;letter-spacing:-.02em;dominant-baseline:middle}.s{font-size:20px;opacity:.85}.m{font-size:14px;font-weight:600;letter-spacing:.12em;opacity:.6}</style>
<rect width="300" height="450" fill="url(#g)"/><rect width="300" height="450" fill="url(#b)"/>
<rect x="32" y="40" width="36" height="5" rx="2.5" fill="#fff" opacity=".9"/>
${partir(rotulo, 24, 2).map((l, i) => `<text x="32" y="${82 + i * 25}" class="r">${escapar(l)}</text>`).join('')}
${texto}
${partir(sub, 24, 2).map((l, i) => `<text x="32" y="${360 + i * 25}" class="s">${escapar(l)}</text>`).join('')}
<text x="32" y="420" class="m">${escapar(marca)}</text>
</svg>`;
  return new Response(svg, {
    headers: { ...CORS, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

// ——— Stremio: a biblioteca ———

async function biblioteca(authKey) {
  const r = await fetch('https://api.strem.io/api/datastoreGet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey, collection: 'libraryItem', ids: [], all: true }),
  });
  const dados = await r.json().catch(() => ({}));
  if (dados.error) throw new SessaoInvalida(dados.error.message);
  if (!Array.isArray(dados.result)) throw new Error(`Resposta inesperada do Stremio (${r.status})`);
  return dados.result;
}

// ——— O painel ———

function painel(env, origem) {
  return env.ASSETS.fetch(new Request(`${origem}/`));
}

// ——— Cifrar a chave de sessão dentro do link ———

let chaveCache = null;
async function chave(env) {
  if (!env.SEGREDO) throw new Error('Falta o SEGREDO (wrangler secret put SEGREDO)');
  if (!chaveCache) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SEGREDO));
    chaveCache = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  return chaveCache;
}

const paraBase64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deBase64 = (texto) => Uint8Array.from(atob(texto.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function cifrar(env, dados) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(env), new TextEncoder().encode(JSON.stringify(dados))));
  const tudo = new Uint8Array(iv.length + cifrado.length);
  tudo.set(iv);
  tudo.set(cifrado, iv.length);
  return paraBase64(tudo);
}

async function lerCfg(env, texto) {
  const demo = /^demo(?:-([a-z]{2}))?$/.exec(texto);
  if (demo) return { demo: true, f: 'Europe/Lisbon', l: linguaDe(demo[1] || 'pt') };
  if (!/^[A-Za-z0-9_-]{40,}$/.test(texto)) return null;
  try {
    const tudo = deBase64(texto);
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: tudo.slice(0, 12) }, await chave(env), tudo.slice(12));
    return JSON.parse(new TextDecoder().decode(claro));
  } catch {
    return null;
  }
}
