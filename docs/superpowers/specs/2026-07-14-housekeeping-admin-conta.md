# Housekeeping: páginas admin-only, Enviar Demo e renomear Perfil — Design

Data: 2026-07-14. Primeiro de 4 sub-projetos rumo a abrir o sistema pra outros grupos
(ordem acordada: housekeeping → multi-tenancy → times → ranking público). Este cobre
só o housekeeping: restringir páginas ainda em teste ao admin, redesenhar Enviar Demo,
renomear a aba "Perfil".

## 1. Restringir Granadas / Táticas / Partidas Pro / Admin ao admin

Infra de admin já existe: coluna `players.is_admin`, JWT carrega `isAdmin`, middleware
`requireAdmin` em `site/server/src/auth/middleware.js`, client expõe `jogador.isAdmin`
via `useAuth()`.

- **Partidas Pro / Admin**: já 100% admin-only (rotas server com `requireAdmin`, nav
  já escondido pra não-admin). Nada a fazer.
- **Granadas / Táticas**: hoje só a escrita é admin-only; a listagem (`GET /`) está
  aberta a qualquer autenticado. Mudança:
  - `site/server/src/routes/granadas.js`: adicionar `requireAdmin` em `GET /` e
    `GET /contagem` (as demais rotas de granadas já têm).
  - `site/server/src/routes/taticas.js`: adicionar `requireAdmin` em `GET /`.
  - `site/client/src/components/Shell.jsx`: mover os itens "Granadas" e "Táticas" do
    array `ITENS` (menu principal, sempre visível) e do `NAV_INFERIOR` (barra mobile)
    para dentro do bloco `{jogador?.isAdmin && (...)}` que já existe pra Admin/Partidas
    Pro — mesmo tratamento visual, mesmos ícones.
  - `site/client/src/App.jsx`: criar um wrapper `RotaAdmin` (mesmo padrão de
    `RotaProtegida`, mas também checa `jogador.isAdmin`) e aplicar nas rotas
    `/granadas`, `/taticas`, `/partidas-pro`, `/admin` — quem digitar a URL direto sem
    ser admin cai em `/acesso-negado` (página que já existe, usada hoje pro login).

## 2. Enviar Demo — redesign

Continua aberta a todos os membros logados (não é admin-only — é o fluxo de qualquer
um subir a própria partida). Mudanças em `site/client/src/pages/EnviarDemo.jsx`:
- Migrar pros primitivos `Card`/`SectionHeader` (hoje é HTML cru sem os primitivos,
  destoa do resto do site já redesenhado).
- Trocar o `<input type="file">` cru por uma área de **drag-and-drop** (dropzone) com
  clique alternativo pra abrir o seletor de arquivo, mostrando nome + tamanho do
  arquivo escolhido antes de enviar.
- Mantém a lógica de envio (`POST /api/upload`), campos de shareCode/playedAt opcionais
  e o feedback de resultado/erro como estão — só a casca visual muda.

## 3. Renomear "Perfil" → "Minha conta"

`site/client/src/pages/Perfil.jsx` hoje é a tela de configurar códigos de
autenticação Steam pra importar partidas automaticamente — não é o perfil de um
jogador (isso é `JogadorPerfil.jsx`, em `/jogador/:steamId`). O nome confundia.

- Label no menu ([Shell.jsx](site/client/src/components/Shell.jsx)): "Meu perfil" →
  **"Minha conta"**.
- Rota: `/perfil` → **`/conta`** (sem link externo apontando pra `/perfil` hoje, seguro
  trocar). Atualizar `App.jsx` e toda referência interna.
- Redesign leve do conteúdo com `Card`/`SectionHeader` pra consistência visual.
- Deixar uma seção reservada (visualmente, sem funcionalidade ainda) para "Contas
  vinculadas" — é onde o botão "Vincular FACEIT" vai entrar quando a Fase A do spec
  de FACEIT (já commitado) for implementada. Não implementar o vínculo agora, só
  preparar o layout pra não precisar redesenhar de novo depois.

## Fora de escopo (fica pros próximos sub-projetos)

- Qualquer coisa de multi-tenancy, Times ou Ranking público.
- Implementação de fato do vínculo FACEIT (Fase A do spec `2026-07-14-integracao-faceit.md`).
