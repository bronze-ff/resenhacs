# Biblioteca de Lineup + Táticas — design

## Contexto e objetivo

O grupo quer aprender lineup de granada (tipo cs2nades.com/tactician.it) e táticas/execuções
usadas por times profissionais, dentro do próprio Resenha — sem nenhum app externo, overlay
ou integração ao vivo com o jogo (decisão explícita do usuário: risco de ban não vale a pena
pra esse caso de uso).

Escopo explicitamente **fora** desta spec (descartado durante o brainstorm):
- App de overlay de desktop (scouting FACEIT pré-partida, lineup ao vivo via GSI) — abandonado
  por preocupação de risco de conta, mesmo sendo tecnicamente seguro.
- Detecção automática de tática a partir de padrão de movimento na demo — adiada; v1 usa
  curadoria manual (alguém marca "esse round foi uma tática", escreve nome/descrição).

## Modelo de dados

### `lineups` (nova tabela)

Cada arremesso de granada individual, indexado e filtrável (alimenta a Biblioteca de Granadas).

- `id`, `match_id` (FK matches), `round_number`
- `map`, `tipo` (smoke | flash | he | molotov)
- `thrower_steam_id`, `thrower_nick` (nick no momento — pro não tem conta rastreada)
- `thrower_x`, `thrower_y`, `thrower_yaw`, `thrower_pitch` (posição/ângulo no momento do arremesso)
- `target_x`, `target_y` (posição de aterrissagem/efeito — já extraído hoje pro mapa de calor)
- `tick`
- `origem` (grupo | pro)

Populada durante `store_parsed`, junto com as outras tabelas por partida.

### `taticas` (nova tabela)

Execução curada — aponta pra um round real (do grupo ou de pro), não duplica posição/movimento.

- `id`, `nome`, `descricao` (texto livre)
- `map`, `match_id` (FK matches), `round_number`
- `status` (sugerida | aprovada | rejeitada)
- `criado_por` (steam_id), `criado_em`
- Visualização reaproveita o **Replay 2D existente** (`ReplayViewer`), carregando aquele round —
  granada de cada jogador, movimento, tudo já renderizado, sem duplicar dado.

### `partidas_pro_fila` (nova tabela)

Fila de curadoria de partidas profissionais — só controla o processo de ingestão, não guarda
os dados da partida em si (isso vai pras tabelas normais: `matches`, `match_players`, etc.).

- `id`, `hltv_url`, `status` (pendente | baixando | processando | concluida | falhou)
- `match_id` (FK matches, preenchido quando concluída)
- `erro` (texto, preenchido se falhar)
- `adicionado_por` (steam_id), `adicionado_em`

### Extensão em `matches`

- `team_a_name`, `team_b_name` (nullable) — nome do clã/time extraído da demo, usado em
  partidas de pro pra mostrar "FaZe vs Vitality" em vez de "Time A vs Time B" genérico.

## Extensão do Coletor

1. **Parser (`parse.py`)**: capturar posição + ângulo (yaw/pitch) de quem arremessa cada
   granada, no tick do arremesso — hoje só a posição de aterrissagem é capturada. Mesmo padrão
   de extensão usado nesta sessão pro campo `side`.
2. **Nome de time/clã**: capturar `team_clan_name` (campo já exposto pelo demoparser2) durante
   o parse, gravar em `team_a_name`/`team_b_name` quando disponível.
3. **`source='pro'` no `ingest_demo()`**: mesmo pipeline de sempre, só com uma origem nova.
   Nenhum dos 10 jogadores é `is_tracked` — precisa validar que highlights/resultado não
   quebram nesse caso (ponto de atenção pra implementação, não bloqueia o design).
4. **Extração de `.rar`**: demo do HLTV vem compactado em `.rar`, não `.bz2` como hoje. Usar
   ferramenta de licença livre (`unar`, não `unrar` proprietário) pra evitar problema rodando
   no runner do GitHub Actions.

## Pipeline de processamento de partida pro

**Restrição de arquitetura real**: o servidor do Resenha roda na Vercel (serverless, limite de
tempo de execução por request) — baixar 300-400MB + extrair + parsear não cabe numa requisição
HTTP síncrona. Processamento tem que ser assíncrono, no mesmo lugar que já processa partida do
grupo hoje.

1. Admin cola o link do demo do HLTV → cria linha em `partidas_pro_fila` com `status=pendente`.
2. O job agendado existente (`.github/workflows/coletor.yml`, já roda a cada 30 min) ganha um
   passo novo: busca entradas pendentes na fila, baixa o `.rar`, extrai, roda `ingest_demo()`
   com `source='pro'`, atualiza status (`concluida` + `match_id`, ou `falhou` + `erro`).
3. Cada granada da partida processada vira uma linha em `lineups` (`origem='pro'`), atribuída
   ao jogador pro que jogou — é a base de dado real que alimenta tanto a Biblioteca quanto a
   criação de Táticas a partir de partida profissional.

## Backend (API)

- `GET /api/lineups?map=&tipo=&origem=` — lista filtrável (Biblioteca de Granadas)
- `GET /api/taticas?map=&status=aprovada` — lista de táticas aprovadas por mapa
- `POST /api/taticas` — sugerir tática (qualquer jogador do grupo; cria com `status=sugerida`)
- `PATCH /api/taticas/:id` — aprovar/rejeitar (admin only)
- `GET /api/partidas-pro-fila` — status da fila (admin)
- `POST /api/partidas-pro-fila` — adicionar link do HLTV (admin)

## Frontend

Três abas novas no Resenha, reaproveitando o design system existente (`panel-cut`,
`font-display`, paleta HUD tático já estabelecida):

1. **Granadas** (`/granadas`) — filtro de mapa/lado/tipo, grid de cards (mini-radar, título,
   origem grupo/pro), clique abre detalhe com radar maior.
2. **Táticas** (`/taticas`) — lista de táticas aprovadas por mapa, cada uma abrindo o Replay 2D
   completo do round + descrição escrita por quem sugeriu. Fluxo de sugestão: a partir da
   página de uma Partida já processada (do grupo ou pro), cada round da "Linha do tempo dos
   rounds" ganha um botão "sugerir como tática" — abre um formulário curto (nome + descrição)
   e cria a sugestão com `status=sugerida`. Fica pendente até um admin aprovar/rejeitar (nova
   seção na página Admin).
3. **Partidas pro** (`/partidas-pro`, admin) — formulário pra colar link do HLTV, lista da fila
   com status ao vivo e botão de retry em caso de falha.

## Testes

- Coletor: teste unitário da extração de posição/ângulo de arremesso (fixture sintética, mesmo
  padrão dos testes existentes de `extract_replay`/`build_replay`).
- Coletor: teste de extração de `.rar` (fixture pequena).
- Server: teste das rotas novas (`lineups`, `taticas`, `partidas-pro-fila`) seguindo o padrão
  de mock de `db.query` já usado em `test/matches.test.js` etc.
- Validação manual: processar 1 partida de pro real ponta a ponta antes de considerar pronto.
