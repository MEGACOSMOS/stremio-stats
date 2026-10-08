// O desenho dos cartões de estatísticas que aparecem no Stremio (300×450).
// Sai em SVG; o Worker converte-o em PNG, porque as aplicações do Stremio
// para telemóvel e TV não mostram imagens SVG.

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

// q: os parâmetros do endereço (r = rótulo, v = valor, s = subtítulo, c = cor, m = marca).
export function svgCartao(q) {
  const rotulo = (q.get('r') || '').slice(0, 40);
  const valor = (q.get('v') || '').slice(0, 60);
  const sub = (q.get('s') || '').slice(0, 40);
  const marca = (q.get('m') || 'ESTATÍSTICAS').slice(0, 20);
  const [cor, escuro] = CORES[(parseInt(q.get('c'), 10) || 0) % CORES.length];
  // Números e palavras curtas numa linha, tão grandes quanto cabem nos ~236 px
  // úteis (≈0,62 em por letra em negrito); nomes de filmes em várias linhas.
  const umaLinha = Math.min(120, Math.floor(236 / (Math.max(1, valor.length) * 0.62)));
  const curto = umaLinha >= 42;
  const tamanho = curto ? umaLinha : valor.length <= 14 ? 44 : 36;
  const linhasValor = curto ? [valor] : partir(valor, tamanho > 40 ? 11 : 13, 4);
  const altura = tamanho * 1.08;
  const topo = 248 - ((linhasValor.length - 1) * altura) / 2;
  const texto = linhasValor.map((l, i) => `<text x="32" y="${topo + i * altura}" class="v">${escapar(l)}</text>`).join('');
  // Só cores lisas e fill-opacity: com degradês e opacity (que obriga a desenhar
  // cada texto à parte) a conversão em PNG levava ~40 ms; assim leva ~6 ms.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">
<style>text{font-family:Inter,'Segoe UI',system-ui,-apple-system,Roboto,sans-serif;fill:#fff}.r{font-size:20px;font-weight:600;fill-opacity:.88}.v{font-size:${tamanho}px;font-weight:800;dominant-baseline:middle}.s{font-size:20px;fill-opacity:.88}.m{font-size:13px;font-weight:600;fill-opacity:.7}</style>
<rect width="300" height="450" fill="${cor}"/>
<circle cx="318" cy="-36" r="190" fill="#fff" fill-opacity=".1"/>
<rect y="396" width="300" height="54" fill="${escuro}" fill-opacity=".55"/>
<rect x="32" y="40" width="36" height="5" rx="2.5" fill="#fff" fill-opacity=".9"/>
${partir(rotulo, 24, 2).map((l, i) => `<text x="32" y="${82 + i * 25}" class="r">${escapar(l)}</text>`).join('')}
${texto}
${partir(sub, 24, 2).map((l, i) => `<text x="32" y="${360 + i * 25}" class="s">${escapar(l)}</text>`).join('')}
<text x="32" y="428" class="m">${escapar(marca)}</text>
</svg>`;
}
