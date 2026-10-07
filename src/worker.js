// A extensão para o Stremio (e o servidor do painel).
//
// O Stremio não diz às extensões quem é o utilizador, por isso o link de
// instalação leva consigo a chave de sessão do Stremio, cifrada com o SEGREDO
// deste Worker: quem visse o link não ficava com acesso à conta, só às
// estatísticas.
//
//   /manifest.json                       extensão por configurar
//   /<cfg>/manifest.json                 extensão de uma pessoa
//   /<cfg>/catalog/movie/<id>[/<extra>].json
//   /<cfg>/meta/movie/mvest:<cartão>.json
//   /<cfg>/biblioteca.json               filmes da biblioteca, para o painel
//   /<cfg>/configure                     o painel (botão "Configurar" do Stremio)
//   /api/ligar                           cria o <cfg> a partir da chave de sessão
//   /cartao.svg                          capa dos cartões de estatísticas
//
// <cfg> = "demo" usa a biblioteca de exemplo em src/demo.json.

import DEMO from './demo.json';
import {
  lerBiblioteca, resumoBase, maisAntigo, partes as partesData, DIAS, aoDia, MESES_CURTOS, mesAno, feitio, numero, horasDe, vezes,
  filmes, fundoDe,
} from '../public/estatisticas.js';

const VERSAO = '1.0.0';
const PREFIXO = 'mvest:';
const ORDENS = ['Mais recentes', 'Mais antigos', 'Mais revistos', 'De A a Z'];

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

async function encaminhar(pedido, env, url, partes) {
  const origem = url.origin;
  if (partes[0] === 'manifest.json') return json(manifesto(origem, null));
  if (partes[0] === 'cartao.svg') return cartaoSvg(url.searchParams);
  if (partes[0] === 'configure') return painel(env, origem);
  if (partes[0] === 'api' && partes[1] === 'ligar' && pedido.method === 'POST') {
    const { authKey, fuso } = await pedido.json().catch(() => ({}));
    if (typeof authKey !== 'string' || !authKey) return json({ erro: 'pedido' }, { estado: 400 });
    await biblioteca(authKey); // confirma que a sessão é válida antes de dar um link
    return json({ cfg: await cifrar(env, { k: authKey, f: fuso }) });
  }

  if (partes.length < 2) return new Response('Não encontrado', { status: 404, headers: CORS });
  const [cfgTexto, recurso] = partes;
  const cfg = await lerCfg(env, cfgTexto);
  if (!cfg) return json({ erro: 'link' }, { estado: 404 });
  const base = `${origem}/${encodeURIComponent(cfgTexto)}`;

  if (recurso === 'manifest.json') return json(manifesto(origem, cfgTexto), { cache: 3600 });
  if (recurso === 'configure') return painel(env, origem);

  let itens;
  try {
    itens = cfg.demo ? DEMO : await biblioteca(cfg.k);
  } catch (erro) {
    if (!(erro instanceof SessaoInvalida)) throw erro;
    if (recurso === 'catalog') return json({ metas: [cartaoSessao(origem, base)], cacheMaxAge: 60 });
    if (recurso === 'meta') return json({ meta: cartaoSessao(origem, base) });
    throw erro;
  }

  if (recurso === 'biblioteca.json') {
    return json({ itens: itens.filter((i) => i && i.type === 'movie'), demo: !!cfg.demo });
  }

  const { vistos } = lerBiblioteca(itens);
  const fuso = cfg.f || 'Europe/Lisbon';

  if (recurso === 'catalog') {
    const [, , tipo, id, extraTexto] = partes;
    if (tipo !== 'movie') return json({ metas: [] });
    const extra = Object.fromEntries(new URLSearchParams((extraTexto || '').replace(/\.json$/, '')));
    const catId = id.replace(/\.json$/, '');
    if (catId === 'mv-estatisticas') {
      return json({ metas: cartoes(vistos, fuso, origem, base).map(previa), cacheMaxAge: 300 });
    }
    if (catId === 'mv-vistos') {
      const lista = ordenar(vistos, extra.genre);
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
    const cartao = cartoes(vistos, fuso, origem, base).find((c) => c.id === id);
    return cartao ? json({ meta: cartao, cacheMaxAge: 300 }) : json({ meta: null }, { estado: 404 });
  }

  return new Response('Não encontrado', { status: 404, headers: CORS });
}

// ——— Stremio ———

function manifesto(origem, cfg) {
  const m = {
    id: 'community.estatisticas.filmes',
    version: VERSAO,
    name: 'Estatísticas dos meus filmes',
    description: 'Quantos filmes já viste no Stremio, quantas horas, os géneros, realizadores, dias e horas '
      + 'favoritos, e a lista de todos eles. Abre "Configurar" para ver o painel completo.',
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
      { type: 'movie', id: 'mv-estatisticas', name: 'As minhas estatísticas' },
      {
        type: 'movie', id: 'mv-vistos', name: 'Filmes que já vi',
        extra: [{ name: 'genre', options: ORDENS, isRequired: false }, { name: 'skip', isRequired: false }],
        extraSupported: ['genre', 'skip'],
      },
    ];
    if (cfg === 'demo') m.name += ' (exemplo)';
  }
  return m;
}

function ordenar(vistos, ordem) {
  const lista = [...vistos];
  if (ordem === 'Mais antigos') return lista.sort(maisAntigo);
  if (ordem === 'Mais revistos') return lista.sort((a, b) => b.vezes - a.vezes || (b.quando || 0) - (a.quando || 0));
  if (ordem === 'De A a Z') return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  return lista; // já vêm do mais recente para o mais antigo
}

const previa = ({ id, type, name, poster, posterShape, description }) => ({ id, type, name, poster, posterShape, description });

const dataCurta = (ms, fuso) => new Date(ms).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: fuso });
const linhas = (itens) => itens.map((t) => `• ${t}`).join('\n');
const barra = (n, max) => '█'.repeat(Math.max(n ? 1 : 0, Math.round((n / (max || 1)) * 12)));

// Os "filmes" falsos que aparecem na fila "As minhas estatísticas".
function cartoes(vistos, fuso, origem, base) {
  const r = resumoBase(vistos, { fuso });
  const painelUrl = `${base}/configure`;
  const fundo = r.ultimos[0]?.id?.startsWith('tt') ? fundoDe(r.ultimos[0].id) : `${origem}/fundo.svg`;
  const lista = [];
  const cartao = (chave, rotulo, valor, sub, nome, descricao) => {
    const capa = new URL(`${origem}/cartao.svg`);
    capa.search = new URLSearchParams({ r: rotulo, v: valor, s: sub, c: String(lista.length) }).toString();
    lista.push({
      id: PREFIXO + chave, type: 'movie', name: nome, poster: capa.toString(), posterShape: 'poster',
      background: fundo, description: descricao, releaseInfo: rotulo,
      links: [{ name: 'Abrir o painel completo', category: 'Estatísticas', url: painelUrl }],
      behaviorHints: { defaultVideoId: null },
    });
  };

  if (!r.total) {
    cartao('vazio', 'Ainda nada', '0', 'filmes vistos', 'Ainda não viste filmes',
      'Assim que acabares de ver um filme no Stremio (ou o marcares como visto), ele aparece aqui.');
    return lista;
  }

  const desde = r.desde ? dataCurta(r.desde, fuso) : null;
  const inicio = r.desde ? partesData(r.desde, fuso) : null;
  cartao('total', 'Filmes vistos', numero(r.total), inicio ? `desde ${MESES_CURTOS[inicio.mes - 1]} ${inicio.ano}` : 'no Stremio',
    `${filmes(r.total)} vistos`,
    `Já viste ${filmes(r.total)} no Stremio${desde ? ` desde ${desde}` : ''}.`
    + (r.revistos ? ` ${r.revistos === 1 ? 'Um deles viste' : `${r.revistos} deles viste`} mais do que uma vez — ao todo foram ${numero(r.vezesTotal)} sessões de cinema.` : '')
    + '\n\nNo painel completo há géneros, décadas, realizadores, atores, países e notas do IMDb.');

  const horas = horasDe(r.tempoReal);
  if (horas > 0) {
    const dias = r.tempoReal / 864e5;
    cartao('horas', 'Horas a ver filmes', `${numero(horas)} h`, dias >= 1 ? `${numero(dias)} ${Math.round(dias) === 1 ? 'dia' : 'dias'} seguidos` : 'de cinema',
      `${numero(horas)} horas de filmes`,
      `Passaste ${numero(horas)} horas a ver filmes no Stremio — ${dias >= 1 ? `o mesmo que ${numero(dias)} dias seguidos, sem dormir.` : 'e a contar.'}`
      + '\n\nConta o tempo que o filme esteve mesmo a dar. Filmes marcados como vistos à mão não entram nesta conta.');
  }

  cartao('ano', `Em ${r.anoAtual}`, numero(r.esteAno), r.esteAno === 1 ? 'filme este ano' : 'filmes este ano',
    `${filmes(r.esteAno)} em ${r.anoAtual}`,
    r.esteAno
      ? `Este ano já viste ${filmes(r.esteAno)}:\n${linhas(r.vistosEsteAno.slice(0, 25).map((f) => f.nome))}${r.esteAno > 25 ? `\n…e mais ${r.esteAno - 25}.` : ''}`
      : `Ainda não viste nenhum filme em ${r.anoAtual}.`);

  const semData = r.semData ? `\n\n${filmes(r.semData)} não ${r.semData === 1 ? 'entra' : 'entram'} nesta conta: ${r.semData === 1 ? 'foi marcado' : 'foram marcados'} como ${r.semData === 1 ? 'visto' : 'vistos'} de uma vez, por isso o Stremio não sabe quando os viste.` : '';
  const ultimo = r.ultimos[0];
  if (ultimo) cartao('ultimo', 'O último que viste', ultimo.nome, ultimo.quando ? dataCurta(ultimo.quando, fuso) : '',
    `Último: ${ultimo.nome}`,
    `Os últimos filmes que viste:\n${linhas(r.ultimos.map((f) => `${f.nome}${f.quando ? ` — ${dataCurta(f.quando, fuso)}` : ''}`))}`);

  if (r.maisRevistos.length) {
    const top = r.maisRevistos[0];
    cartao('revisto', 'O que mais revisto', top.nome, `visto ${vezes(top.vezes)}`,
      `Mais revisto: ${top.nome}`,
      `Os filmes a que mais voltaste:\n${linhas(r.maisRevistos.map((f) => `${f.nome} — ${vezes(f.vezes)}`))}`);
  }

  const maxDia = Math.max(...r.porSemana);
  const dia = DIAS[r.diaFavorito][0].toUpperCase() + DIAS[r.diaFavorito].slice(1);
  cartao('dia', 'Dia favorito', dia, filmes(maxDia),
    `Dia favorito: ${dia}`,
    `É ${aoDia(r.diaFavorito)} que vês mais filmes.\n${linhas(DIAS.map((d, i) => `${d}: ${barra(r.porSemana[i], maxDia)} ${r.porSemana[i]}`))}`
    + '\n\n(Conta o último dia em que viste cada filme.)' + semData);

  const h = r.horaFavorita;
  const periodos = [['de manhã', 5, 12], ['à tarde', 12, 19], ['à noite', 19, 24], ['de madrugada', 0, 5]]
    .map(([nome, de, ate]) => [nome, r.porHora.slice(de, ate).reduce((a, b) => a + b, 0)]);
  const maxPeriodo = Math.max(...periodos.map((p) => p[1]));
  cartao('hora', 'Hora favorita', `${h}h`, `costumas ver ${feitio(h)}`,
    `Hora favorita: ${h}h`,
    `A hora a que mais acabas filmes é às ${h}h.\n${linhas(periodos.map(([nome, n]) => `${nome}: ${barra(n, maxPeriodo)} ${n}`))}${semData}`);

  if (r.melhorMes) {
    const meses = [...r.porMes].sort((a, b) => b[1] - a[1]).slice(0, 5);
    cartao('mes', 'O teu melhor mês', mesAno(r.melhorMes[0], true), filmes(r.melhorMes[1]),
      `Melhor mês: ${mesAno(r.melhorMes[0])}`,
      `Os meses em que viste mais filmes:\n${linhas(meses.map(([m, n]) => `${mesAno(m)} — ${filmes(n)}`))}${semData}`);
  }

  cartao('painel', 'Quero ver mais', 'Painel completo', 'géneros, realizadores…',
    'Abrir o painel completo',
    'Géneros, décadas, realizadores, atores, países, notas do IMDb, os mais longos e os mais curtos, e a lista de todos os filmes que viste.\n\nCarrega em "Abrir o painel completo" (ou no botão "Configurar" da extensão).');
  return lista;
}

function cartaoSessao(origem, base) {
  const capa = `${origem}/cartao.svg?${new URLSearchParams({ r: 'É preciso voltar a ligar', v: 'Sessão terminada', s: 'abre o painel', c: '0' })}`;
  return {
    id: `${PREFIXO}sessao`, type: 'movie', name: 'Volta a ligar a tua conta', poster: capa, posterShape: 'poster',
    description: 'A ligação ao teu Stremio deixou de funcionar (por exemplo, porque saíste da conta em todos os aparelhos). Abre o painel, entra outra vez e reinstala a extensão.',
    links: [{ name: 'Abrir o painel', category: 'Estatísticas', url: `${origem}/` }],
  };
}

// ——— Capas dos cartões ———

const CORES = [['#5b3fd1', '#1b1035'], ['#c2410c', '#2a1208'], ['#0f766e', '#071f1d'], ['#a21caf', '#26082a'],
  ['#1d4ed8', '#0a1633'], ['#b45309', '#271605'], ['#be123c', '#2a0711'], ['#4d7c0f', '#121d05'], ['#6d28d9', '#170b2e']];

const escapar = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
<text x="32" y="420" class="m">ESTATÍSTICAS</text>
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
  if (texto === 'demo') return { demo: true, f: 'Europe/Lisbon' };
  if (!/^[A-Za-z0-9_-]{40,}$/.test(texto)) return null;
  try {
    const tudo = deBase64(texto);
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: tudo.slice(0, 12) }, await chave(env), tudo.slice(12));
    return JSON.parse(new TextDecoder().decode(claro));
  } catch {
    return null;
  }
}
