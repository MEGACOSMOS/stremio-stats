# Stremio Stats (extensão para o Stremio)

Mostra estatísticas de todos os filmes que já viste no Stremio.

**No navegador (painel completo):** quantos filmes, horas de cinema, filmes por
mês e por ano, géneros, décadas, dias da semana e horas do dia, realizadores,
atores, países, notas do IMDb, destaques (melhor e pior nota, o mais longo, o
mais curto, o mais antigo, o mais revisto), filmes que ficaram a meio e a lista
de todos os filmes, com pesquisa e filtros.

**Dentro do Stremio (depois de instalar):** duas filas na página inicial —
"As minhas estatísticas" (cartões com os números principais; cada um abre uma
página com mais pormenor) e "Filmes que já vi" (ordenável em Descobrir por mais
recentes, mais antigos, mais revistos ou de A a Z). O botão "Configurar" da
extensão abre o painel completo.

## Como funciona

- Para entrar, o painel usa o mesmo sistema de código que o Stremio usa nas
  televisões (link.stremio.com), ou o email e palavra-passe, que vão diretamente
  para o Stremio.
- O histórico vem da biblioteca da conta do Stremio; os géneros, realizadores,
  atores, países, notas e durações vêm do Cinemeta (o catálogo oficial do
  Stremio).
- O Stremio só guarda a **última** vez que viste cada filme, por isso as contas
  por mês, dia e hora usam essa data.
- O link de instalação leva a chave de sessão cifrada com o `SEGREDO` do Worker.

## Para quem mexe no código

- `public/` — o painel (`index.html`, `painel.js`, `estilo.css`) e as contas
  (`estatisticas.js`, partilhado com o Worker).
- `src/worker.js` — a extensão do Stremio e o servidor do painel.
- `src/demo.json` — biblioteca de exemplo (filmes reais, datas inventadas);
  refaz-se com `bun run demo`. Abre-se em `/?exemplo` ou em `/demo/manifest.json`.
- Testar: `bun run dev` (porta 8010). O segredo local está em `.dev.vars`.
- Publicado em https://stremiostats.stream (domínio próprio, registado na Cloudflare) e em https://stremio-estatisticas.malhaviva.workers.dev (para as instalações antigas).
- Publicar de novo: `bun run deploy` (o SEGREDO já está guardado na Cloudflare; mudá-lo invalida os links instalados).
