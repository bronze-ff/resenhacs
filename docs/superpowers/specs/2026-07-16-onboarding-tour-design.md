# Tour guiado + passo a passo Steam em Minha Conta

## Objetivo

Hoje o card "Importação automática (Steam)" em Minha Conta (`Perfil.jsx`)
só tem um parágrafo com um link pra Steam — não explica o clique-a-clique
de onde achar os dois códigos na página de suporte da Steam. E não existe
nenhum tour explicando as seções do menu pra quem entra no Resenha pela
primeira vez (o `Onboarding.jsx` atual só cobre criar/entrar num grupo).

Este spec cobre duas entregas que compartilham conteúdo:

1. Passo a passo numerado de como pegar os códigos Steam, sempre visível
   em Minha Conta.
2. Tour guiado (4 passos: boas-vindas, vincular Steam, vincular FACEIT,
   navegar pelo menu) que abre sozinho na primeira vez que o jogador entra
   num grupo, e fica acessível depois via um link "Ajuda" na Shell.

Nenhum print real (com nick/códigos do usuário) é reproduzido em código —
os passos são só texto, com os mesmos placeholders genéricos que já
existem no formulário (`XXXX-XXXXX-XXXX`, `CSGO-xxxxx-...`).

## O que já existe (reaproveitado, sem mudança)

- `Perfil.jsx` — formulário de código de autenticação + share code, toggle
  de ranking público, card de vincular FACEIT. O parágrafo de instrução
  atual (linhas 46-60) é o que vira o novo componente.
- `Onboarding.jsx` — fluxo de criar/entrar em grupo, padrão visual de
  `Card` + formulário sequencial que o `Tour.jsx` novo replica.
- `App.jsx` — `RotaProtegida`/`RotaBemVindo` já fazem gate por
  `grupoAtivoId`; o gate do tour segue o mesmo padrão.
- `routes/players.js` — `PUT /me/ranking-publico` é o padrão exato pro
  novo endpoint de toggle.
- `routes/auth.js` (linhas 78-87) — payload do `GET /api/auth/me`, onde
  entra o novo campo `tourConcluido`.

## Mudanças

### 1. Migration — `supabase/migrations/0029_tour_concluido.sql`

```sql
alter table players add column tour_concluido boolean not null default false;
```

### 2. Servidor — `site/server/src/routes/players.js`

Novo endpoint, mesmo padrão de `ranking-publico`:

```js
router.put('/me/tour-concluido', requireAuth, async (req, res) => {
  await db.query('update players set tour_concluido = true where steam_id64 = $1', [req.player.steamId])
  res.json({ ok: true })
})
```

Sempre seta `true` (não recebe corpo) — não existe caso de uso pra
"desmarcar" o tour como concluído pela API.

### 3. Servidor — `site/server/src/routes/auth.js`

No `res.json({...})` da rota `/me` (linha ~78), adicionar
`tourConcluido: p.tour_concluido` junto dos outros campos.

### 4. Cliente — novo componente `site/client/src/components/PassoAPassoSteam.jsx`

Lista numerada (não é formulário — só o texto/instrução; o formulário de
inputs continua sendo o que já existe em `Perfil.jsx`, renderizado depois
deste componente):

1. Clique no link abaixo — ele tenta abrir direto a página de códigos
   (pode pedir login Steam se você não estiver logado no navegador).
2. Se cair na Central de Ajuda em vez de ir direto pra página de códigos:
   clique no produto **Counter-Strike 2** na lista de produtos recentes.
3. Clique em **"Gerenciar meus códigos de autenticação"** (fica no fim da
   lista de opções, abaixo de "remover jogo da conta").
4. A página mostra dois valores — copie **"Código de autenticação"** (o
   de histórico, formato `XXXX-XXXXX-XXXX`) no primeiro campo abaixo, e
   **"Seu token de partida mais recente"** (o share code, formato
   `CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx`) no segundo.

Mantém o link existente
(`https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128`)
e a explicação de "a busca anda pra frente a partir do código informado".

Recebe nenhuma prop obrigatória — é conteúdo estático, reaproveitado tanto
em `Perfil.jsx` quanto no passo 2 do `Tour.jsx`.

### 5. Cliente — `Perfil.jsx`

Troca o `<p>` de instrução (linhas 46-60) por `<PassoAPassoSteam />`,
mantendo o formulário dos dois inputs como está.

### 6. Cliente — novo `site/client/src/pages/Tour.jsx`

Página com estado interno de passo (`useState`, igual ao padrão de
formulário sequencial do `Onboarding.jsx`), 4 passos com botões
Próximo/Pular/Voltar:

1. **Bem-vindo** — uma frase sobre o que é o Resenha.
2. **Vincular Steam** — `<PassoAPassoSteam />` + os mesmos dois inputs e
   `PUT /api/players/me` que já existem em `Perfil.jsx` (campos
   controlados localmente no Tour, sem duplicar lógica de fetch — extrair
   um pequeno hook ou copiar o handler, decisão de implementação no plano).
3. **Vincular FACEIT (opcional)** — mesmo card de vincular que existe em
   `Perfil.jsx`, com nota "opcional, pode fazer depois em Minha Conta".
4. **Navegar pelo Resenha** — texto explicando os grupos do menu:
   - Partidas / Ranking / Ranking público — acompanhar desempenho seu e
     do grupo.
   - Enviar demo — subir uma partida que não veio do matchmaking
     automático (ex.: scrim, campeonato).
   - Jogadores / Comparar / Times — perfis individuais e comparações
     entre jogadores ou times.
   - Granadas / Táticas — biblioteca de lineups e jogadas do grupo.
   - Minha conta — onde reconfigurar tudo isso (Steam, FACEIT, ranking
     público) depois.

Botão final "Concluir" (e "Pular" em qualquer passo) chama
`PUT /api/players/me/tour-concluido` e redireciona pra `/`.

### 7. Roteamento — `App.jsx`

- Nova rota `<Route path="/tour" element={<RotaTour><Tour /></RotaTour>} />`.
  `RotaTour` segue o padrão de `RotaBemVindo`: exige `jogador` e
  `grupoAtivoId`, mas não exige `tourConcluido` (é a própria página que
  zera a flag).
- `RotaProtegida` ganha uma checagem a mais, depois da de `grupoAtivoId`:
  `if (!jogador.tourConcluido) return <Navigate to="/tour" replace />`.
  Isso faz o tour abrir sozinho a primeira vez que o jogador tem grupo
  ativo mas ainda não concluiu/pulou o tour.

### 8. Cliente — `Shell.jsx`

Link "Ajuda" fixo perto do botão "Sair" no header (mesmo estilo do botão
Sair, ícone `?` ou reaproveitar um ícone existente), `<a href="/tour">`,
sempre visível independente da flag — é como o usuário revisita o tour
depois de já ter concluído.

## Testes

- `players.test.js` — `PUT /me/tour-concluido` seta `tour_concluido = true`
  (mesmo padrão do teste existente de `ranking-publico`).
- Teste de integração/unit do gate em `App.jsx`: jogador com
  `grupoAtivoId` e `tourConcluido: false` é redirecionado pra `/tour`;
  com `tourConcluido: true` não é.

## Fora de escopo

- Overlay/spotlight destacando elementos reais da UI (sidebar, header) —
  descartado na fase de design por ser mais frágil no mobile; o tour é
  uma página dedicada, não um coachmark.
- Anexar as imagens/screenshots reais enviadas pelo usuário como assets —
  o conteúdo vira texto puro, sem nunca persistir nick/códigos reais no
  repo.
- Reabrir o tour automaticamente depois de já concluído (ex.: quando uma
  seção nova do menu for lançada) — fora de escopo agora; o link "Ajuda"
  cobre o caso de o usuário querer rever.
