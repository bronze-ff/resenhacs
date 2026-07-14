# Multi-tenancy (Grupos) — Design

Data: 2026-07-14. Segundo de 4 sub-projetos rumo a abrir o sistema pra outros grupos
(ordem: housekeeping [feito] → **multi-tenancy** → times → ranking público). Transforma
o Resenha de "uma whitelist fixa" pra "N grupos isolados, cada jogador pode estar em
vários".

## Decisões (confirmadas com o usuário)

1. Um jogador pode pertencer a **vários grupos** ao mesmo tempo.
2. **Qualquer jogador logado pode criar um grupo** (vira admin dele) e gerar um **link de
   convite** pra outros entrarem — sem aprovação central.
3. A **whitelist global de login cai**. Qualquer conta Steam consegue logar no site;
   privacidade passa a vir 100% do isolamento por grupo.
4. Uma partida importada pertence ao **"grupo ativo"** de quem importou (seletor no
   client, tipo trocar de workspace) — sem grupo ativo compatível, a mesma partida pode
   existir em mais de um grupo (duplicada, isolada, sem vazar dado entre grupos).
5. Granadas/Táticas curadas continuam **compartilhadas entre todos os grupos** (base de
   conhecimento única) — mas essas páginas (+ Admin site-wide +Partidas Pro) ficam
   restritas ao **super-admin** (você), não a "qualquer admin de grupo", porque ainda
   estão em desenvolvimento.
6. Mantém um papel de **super-admin** (você) acima dos admins de grupo, pra moderação
   site-wide.

## Modelo de dados

```sql
create table groups (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id) on delete cascade,
  steam_id64 text not null references players(steam_id64),
  role text not null default 'membro' check (role in ('admin', 'membro')),
  entrou_em timestamptz not null default now(),
  primary key (group_id, steam_id64)
);

create table group_invites (
  token uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now(),
  revogado_em timestamptz
);

alter table matches add column group_id uuid references groups(id);
-- backfill (ver "Migration/backfill" abaixo), depois:
alter table matches alter column group_id set not null;

alter table players rename column is_admin to is_super_admin;
```

- `players` continua uma tabela global — identidade Steam (nick/avatar/códigos de
  auto-import) é a mesma pessoa em qualquer grupo que ela esteja.
- `lineups_curados` e `taticas` **não ganham `group_id`** — continuam globais (decisão 5).
- Toda tabela hoje ligada a `matches` (match_players, highlights, clips, granadas
  jogadas/`lineups`, `taticas_curadas`... o que já referencia `match_id`) herda o escopo
  de grupo via join com `matches.group_id` — não precisa duplicar a coluna nelas.

## Login sem whitelist

`site/server/src/routes/auth.js`, `GET /steam/return`: hoje faz `select ... where
steam_id64 = $1` e redireciona pra `/acesso-negado` se não achar (linhas 24–28). Vira
`insert into players (steam_id64, nick, avatar_url) values (...) on conflict
(steam_id64) do update set nick = excluded.nick, avatar_url = excluded.avatar_url`
— login sempre sucede, cria o jogador na primeira vez. `is_super_admin` default `false`.
A página `AcessoNegado`/rota `/acesso-negado` fica sem uso nesse fluxo (não removida
neste plano — pode servir pra um caso futuro de conta banida).

## Grupo ativo

- Client guarda `grupo_ativo_id` em `localStorage` (chave `resenha_grupo_ativo`).
- Todo request a rota escopada por grupo manda esse id (header `X-Group-Id`).
- Servidor **sempre valida** que `req.player.steamId` é membro de fato daquele
  `group_id` (`exists (select 1 from group_members where group_id = $1 and steam_id64 =
  $2)`) antes de responder — nunca confia só no header. Middleware novo
  `requireGroupMember` em `site/server/src/auth/middleware.js`, aplicado nas rotas
  escopadas (matches, ranking, players-list-do-grupo, comparar).
- Se o jogador não tem grupo ativo válido (nunca escolheu, ou saiu do grupo que estava
  ativo), client mostra a tela de onboarding em vez da Feed.
- Trocar de grupo: dropdown no header do `Shell` lista os grupos do jogador
  (`GET /api/groups/meus`), escolher atualiza o `localStorage` e refaz os fetches.

## Onboarding (zero grupos)

Tela nova, cai aqui se `GET /api/groups/meus` voltar vazio após login:
- **"Criar um grupo"**: nome → `POST /api/groups` → vira admin, grupo ativo = o novo.
- **"Tenho um convite"**: campo pra colar o link/token → mesmo fluxo de
  `GET /convite/:token` abaixo.

## Convite

- `POST /api/groups/:id/convites` (admin do grupo) — gera um `group_invites` novo,
  devolve a URL `${appUrl}/convite/:token`.
- `GET /convite/:token` (rota client, pública): se não logado, manda pro Steam login
  primeiro e volta pra essa mesma URL depois (`redirect` guardado, mesmo padrão que
  `buildSteamRedirectUrl` já deve suportar ou precisa de um `state`/query param). Se
  logado, mostra nome do grupo + botão "Entrar" → `POST /api/convites/:token/aceitar`
  → insere em `group_members` (role `membro`), seta como grupo ativo, redireciona pra
  Feed.
- Convite não expira sozinho; admin pode revogar (`revogado_em`) — convite revogado
  volta 410/erro claro na tela de aceite.

## Escopo por rota (o que muda em cada arquivo de rota do servidor)

- `matches.js`: toda query de listagem/detalhe ganha `where m.group_id = $groupId`
  (via `requireGroupMember`); `POST /upload` e o fluxo de auto-import gravam
  `group_id` = grupo ativo de quem disparou.
- `ranking.js`, `players.js` (lista "Jogadores"), `profile.js` (comparar): mesma coisa
  — os agregados hoje rodam sobre `match_players`/`matches` sem filtro de grupo; ganham
  o filtro por `matches.group_id`.
- `granadas.js`, `taticas.js`: **sem mudança de escopo** (continuam globais) — só a
  gate de acesso muda de `requireAdmin` (is_admin de hoje) pra checar
  `req.player.isSuperAdmin` (ver seção Admin abaixo).
- `admin.js`, `partidasPro.js`: idem — viram gate de super-admin.
- Novo `groups.js`: `POST /`, `GET /meus`, `POST /:id/convites`,
  `POST /convites/:token/aceitar`, `GET /convites/:token` (preview antes de aceitar).

## Super-admin

- JWT payload troca `isAdmin` → `isSuperAdmin` (renomeado junto com a coluna).
- `requireAdmin` em `middleware.js` é renomeado pra `requireSuperAdmin`, checando
  `req.player.isSuperAdmin`.
- Client: `jogador.isAdmin` → `jogador.isSuperAdmin` em todo lugar que hoje gate
  Granadas/Táticas/Admin/Partidas Pro (Shell.jsx, App.jsx `RotaAdmin`, PaginaMapa*,
  Partida.jsx `podePromover`). `podePromover` (promover jogador não-tracked a tracked
  dentro de uma partida) — a rever se isso devia ser super-admin ou admin do grupo da
  partida; tratado como super-admin por ora (mesma flag que já usava).

## Migration/backfill (aplicado uma vez, na primeira migration deste sub-projeto)

1. Criar `groups`, `group_members`, `group_invites`; renomear `players.is_admin` →
   `is_super_admin`; adicionar `matches.group_id` nullable.
2. Inserir 1 `groups` (nome "Grupo do Filippe" ou similar, `criado_por` = seu
   `steam_id64`).
3. Inserir em `group_members` todo `steam_id64` hoje existente em `players`, role
   `admin` pra quem tinha `is_super_admin = true`, `membro` pros demais.
4. `update matches set group_id = '<id do grupo criado>'` pra toda linha existente.
5. `alter table matches alter column group_id set not null`.

## Fora de escopo (fica pros próximos sub-projetos)

- Times (dentro de um grupo) e comparativo Time A x Time B.
- Ranking público cross-grupo.
- Granadas/Táticas por grupo (decisão 5: continuam globais por ora — pode virar pedido
  futuro se um grupo quiser sua própria biblioteca).
- Excluir/sair de um grupo, transferir dono, múltiplos admins por grupo além do
  criador promovendo outros — MVP cobre criar + convidar + role admin/membro; gestão
  fina de membros fica pra iteração seguinte se for pedida.
