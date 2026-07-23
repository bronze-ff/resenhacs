# Times + Ranking Público — Design

Data: 2026-07-14. Terceiro e quarto sub-projetos (feitos juntos, pois o Ranking Público é o
que viabiliza Comparar Time x Time sem link direto) — ordem: housekeeping [feito] →
multi-tenancy [feito] → **times + ranking público**.

## Decisões (confirmadas com o usuário)

1. Um **Time** é um subconjunto de jogadores do grupo, escolhido à mão (não é "todo mundo
   do grupo automaticamente"). Um grupo pode ter mais de um Time.
2. Só o **admin do grupo** cria/edita Times (mesmo padrão de quem já controla convites).
3. Comparar **Time A x Time B** funciona entre grupos diferentes, sem link direto — desde
   que os dois Times estejam marcados como públicos.
4. Ranking público tem **2 abas**: Jogadores e Times.
5. Jogador decide sozinho (toggle em "Minha conta") se aparece no ranking público de
   jogadores — opt-in pessoal, não pode ser forçado pelo admin do grupo.
6. Time é tornado público por quem administra o Time (toggle na tela do Time) — opt-in de
   conjunto, separado do opt-in individual de cada membro.
7. O ranking público **exige login** (qualquer conta Steam, sem precisar de grupo em
   comum) — não é uma página pública sem autenticação.

## Modelo de dados

```sql
create table teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  nome text not null,
  publico boolean not null default false,
  criado_por text not null references players(steam_id64),
  criado_em timestamptz not null default now()
);

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  steam_id64 text not null references players(steam_id64),
  primary key (team_id, steam_id64)
);

alter table players add column ranking_publico boolean not null default false;
```

## Stats de um Time

Agregação sobre as partidas do **grupo do Time** em que os membros do Time jogaram
**juntos, no mesmo lado** (`match_players.team`) — mesma partida, mesmo `team` pra todos os
membros presentes nela. Partidas onde só parte do Time jogou junto (ex: 3 de 5) contam
como "jogaram juntos" desde que estejam no mesmo lado — não exige os 5 presentes.
Métricas: rating médio do Time, winrate (dessas partidas jogando juntos), K/D médio,
partidas jogadas juntos. Reaproveita a mesma lógica de "confronto direto" já implementada
em `profile.js` pra Comparar (jogador x jogador), generalizada de 2 steamIds fixos pra um
`team_id` (lista de membros).

## Rotas

- `POST /api/teams` (admin do grupo, `requireGroupMember`) — cria Time com nome + lista de
  `steamId`s (precisam ser membros do grupo).
- `GET /api/teams` (`requireGroupMember`) — lista Times do grupo ativo.
- `PATCH /api/teams/:id` (admin do grupo, dono do Time) — edita nome/membros/toggle público.
- `DELETE /api/teams/:id` (admin do grupo).
- `GET /api/teams/compare?a=<teamId>&b=<teamId>` (`requireAuth`, sem `requireGroupMember`
  fixo) — stats lado a lado + confronto direto (se os dois times já se enfrentaram, cruzando
  `match_players.team` dos membros dos dois times na mesma partida). Autorização por time:
  cada `teamId` só é acessível se (a) pertence a um grupo do qual o requisitante é membro,
  OU (b) está marcado `publico = true`. Se nenhuma das duas, 403 nesse time específico.
- `PUT /api/players/me/ranking-publico` (`requireAuth`) — toggle pessoal
  `{ publico: boolean }`, grava em `players.ranking_publico`.
- `GET /api/ranking-publico/jogadores` (`requireAuth`, sem `requireGroupMember` — é
  cross-grupo por definição) — agrega stats de TODOS os jogadores com
  `ranking_publico = true`, em TODAS as partidas deles (cross-grupo, já que é uma vitrine
  pessoal). Mesmas métricas do ranking interno (rating, winrate, kd, hsPct).
- `GET /api/ranking-publico/times` (`requireAuth`) — lista Times com `publico = true`,
  com as mesmas métricas agregadas de time.

## Client

- **Nova página "Times"** (rota `/times`, no menu principal — não é admin-only, qualquer
  membro do grupo pode VER os times do grupo; só criar/editar é admin-only, igual ao
  padrão de "Granadas" antes de virar admin-only: aqui o Time já nasce pra todo mundo ver).
- Dentro de "Times": lista de Times do grupo ativo, cada card com toggle público (só visível
  pro admin), stats resumidas, e um seletor "Comparar com..." que aceita um Time próprio ou
  busca por nome entre os Times públicos de outros grupos.
- **Comparar Time x Time**: tela nova (`/times/comparar?a=&b=`), clone estrutural do
  `Comparar.jsx` (jogador x jogador) já existente — reaproveita `CabecalhoJogador`-like
  pattern (agora `CabecalhoTime`: nome do time + grupo de origem), linhas de métricas com
  barra comparativa, e confronto direto se os times já jogaram entre si.
- **Ranking público**: nova página `/ranking-publico` (no menu, fora do bloco admin), com
  abas "Jogadores"/"Times" — reaproveita `DataTable`/`RatingBadge` já existentes no Ranking
  interno.
- **Minha conta**: novo toggle "Aparecer no ranking público" na seção de conta (mesma
  página que já tem os códigos de auto-import e o placeholder "Contas vinculadas" do
  FACEIT).

## Riscos / decisões pro plano

- Confronto direto entre Times pressupõe que ambos os times têm partidas na mesma
  competição/servidor pra se cruzarem de fato (times de grupos totalmente diferentes que
  nunca jogaram entre si só mostram stats lado a lado, sem "confronto direto" — igual já
  acontece hoje no Comparar jogador x jogador quando os dois nunca jogaram juntos).
- Um jogador pode estar em mais de um Time dentro do mesmo grupo (ex: reserva de um time,
  titular de outro) — sem restrição de exclusividade no MVP.
- Se um jogador sai do grupo (fora de escopo ainda — não existe "sair de grupo" hoje),
  o Time dele fica com um membro "órfão" — fora de escopo tratar agora, mesma decisão já
  tomada no spec de multi-tenancy.

## Fora de escopo

- Exclusividade de Time (um jogador só pode estar em 1 Time por grupo).
- Histórico de mudanças de roster do Time.
- Notificação quando alguém compara seu Time público.
