# FACEIT Fase B — Ingestão automática de partidas + ELO — Design

Data: 2026-07-16. Continuação da Fase A (vínculo OAuth, no ar e validado: `players.faceit_id`/
`faceit_nick` populados no clique em "Vincular FACEIT"). Decisões do usuário nesta sessão:

- **Escopo**: toda partida **5v5 de CS2** de membro vinculado (matchmaking, hubs e campeonatos
  da FACEIT — o filtro é "tem membro vinculado nela e é 5v5").
- **ELO por partida**: método **snapshot** (só API oficial) — ver seção ELO.
- **Backfill**: **histórico inteiro** de cada membro vinculado.

## Arquitetura: fila de pendências (mesmo padrão da fila Pro e dos uploads)

Duas etapas por rodada do cron de 30 min do Coletor, ambas num step novo do `coletor.yml`:

### 1. Descoberta (barata, toda rodada)

Para cada `players` com `faceit_id` preenchido:
`GET https://open.faceit.com/data/v4/players/{faceit_id}/matches?game=cs2&offset=N&limit=100`
paginando. Para cada match ainda não vista (nem em `matches.faceit_match_id`, nem na fila),
insere em `faceit_pendentes` (tabela nova). Paginação para quando uma página inteira já é
conhecida — exceto na primeira sincronização de um membro (fila vazia pra ele), quando anda até
o fim do histórico (decisão: histórico inteiro). Só entra na fila partida 5v5 (roster de 5 por
facção); modos menores (2v2 etc.) são pulados.

```sql
create table faceit_pendentes (
  faceit_match_id text primary key,
  steam_id64 text not null,          -- membro vinculado que originou a descoberta
  group_id uuid not null,            -- grupo do membro (multi-tenancy preservada)
  status text not null default 'pending',  -- pending | failed | done
  tentativas integer not null default 0,
  erro text,
  created_at timestamptz not null default now()
);
```

### 2. Processamento (limitado por rodada)

Processa até **10 itens** `pending` por rodada (mais antigo primeiro — histórico entra em ordem).
O backfill inteiro se dilui sozinho ao longo das rodadas (ex.: 300 partidas ≈ 30 rodadas ≈ 15h),
sem estourar o timeout do Actions e retomável de graça. Por item:

1. `GET /matches/{faceit_match_id}` → mapa, facções (faction1→time A, faction2→time B), placar,
   `finished_at` (vira `played_at`), `demo_url`.
2. `GET /matches/{faceit_match_id}/stats` → stats por jogador da API (fallback e conferência).
3. **Demo**: troca a `demo_url` por URL assinada via Downloads API
   (`POST https://open.faceit.com/download/v2/demos/download` com `{"resource_url": ...}`),
   baixa, descomprime (`.dem.gz` → gzip do Python) e roda o MESMO pipeline de sempre
   (`parse_demo`/`extract_replay`/`enrich`/`store_parsed`) com `source='faceit'` e o `group_id`
   do membro — replay 2D, KAST, granadas, economia, tudo igual às partidas da Valve.
4. **Fallback stats-only**: se a demo não estiver mais disponível (comum em partida antiga) ou o
   download/parse falhar, a partida entra mesmo assim com o que a API dá: placar, mapa, data,
   K/D/A/HS%/MVPs por jogador (roster traz `game_player_id` = steam_id64). Campos que só o
   parser produz (KAST, rating, economia, replay) ficam nulos — a UI já esconde o que é nulo.
   Marca `demo_url`/`replay_url` nulos (sem replay 2D). Nunca "some" partida por demo perdida.
5. Grava `matches.faceit_match_id` (coluna nova + unique index) — dedupe absoluto entre rodadas
   e entre membros (2 vinculados na mesma partida → 1 registro só).
6. Falha marca `status='failed'`, incrementa `tentativas`, guarda `erro`; até 3 tentativas
   (re-enfileira como pending nas 2 primeiras), depois fica `failed` pra inspeção manual —
   mesmo padrão da fila de uploads.

## ELO FACEIT

### Colunas novas

- `players.faceit_elo integer` + `players.faceit_skill_level integer` — ELO/level ATUAIS,
  atualizados a cada rodada pra cada vinculado via `GET /data/v4/players/{faceit_id}`
  (`games.cs2.faceit_elo` / `skill_level`).
- `match_players.faceit_elo_before integer` + `faceit_elo_after integer` — espelho do padrão
  `premier_rating_before/after` (nullable; delta calculado na leitura).

### Método snapshot (limitação aceita)

A API oficial NÃO dá delta de ELO por partida. A cada rodada, o Coletor grava o ELO atual de
cada vinculado; quando uma partida FACEIT nova (jogada desde a rodada anterior) é ingerida:
`faceit_elo_after` = ELO atual, `faceit_elo_before` = ELO do snapshot anterior. Se o membro
jogou 2+ partidas na mesma janela de 30 min, só a mais recente ganha before/after (o delta das
outras sai agregado nela; as demais ficam nulas) — caso raro e aceito. **Partidas do backfill
(histórico) ficam sem ELO before/after** — snapshot só funciona daqui pra frente. ELO de
jogadores fora do grupo: fora de escopo.

### UI

- **Perfil** (`JogadorPerfil.jsx`): badge de ELO FACEIT ao lado do `PremierBadge`, com as cores
  dos níveis oficiais da FACEIT (1: cinza; 2–3: verde; 4–7: amarelo; 8–9: laranja; 10:
  vermelho — thresholds: 1 até 500, 2 até 750, 3 até 900, 4 até 1050, 5 até 1200, 6 até 1350,
  7 até 1530, 8 até 1750, 9 até 2000, 10 = 2001+). Não vinculado/nunca sincronizado → badge não
  aparece (mesma regra do Premier).
- **Partida** (`Scoreboard`): a coluna de pontos existente é por partida — partida `valve_mm`
  mostra Premier (como hoje), partida `faceit` mostra ELO before + delta (mesma Regra do Sinal
  Duplo: seta + cor). Uma coluna só, o dado certo pro tipo da partida.
- **Feed/histórico**: badge `[logo FACEIT] FACEIT` já pronto (`PlataformaBadge`, no ar).

## Pré-requisitos operacionais (usuário faz no deploy)

1. `FACEIT_API_KEY` como **secret do GitHub Actions** (hoje só está na Vercel; o Coletor roda no
   Actions). Mesma chave server-side já criada.
2. Confirmar no painel da FACEIT (App Studio → API Keys) que a chave tem **Downloads access**
   (necessário pra trocar `demo_url` por URL assinada). Sem isso, tudo funciona menos o download
   de demo — as partidas entrariam todas em modo stats-only.

## Riscos e decisões

- **Rate limit** (free ~10k/h): grupo pequeno, descoberta paginada a 100/página e processamento
  a 10/rodada ficam ordens de magnitude abaixo.
- **Demo antiga indisponível**: coberto pelo fallback stats-only (partida nunca some).
- **Custo de storage**: demos FACEIT entram no MESMO ciclo de vida das demais (R2, cleanup
  apaga o `.dem` bruto após 90 dias, `replay.json` fica pra sempre).
- **Fingerprint**: o dedupe primário é `faceit_match_id`; o fingerprint por conteúdo continua
  como segunda linha de defesa no `store_parsed` (sem conflito com share codes — partida FACEIT
  não tem share code).
- **Times**: `faction1`→A / `faction2`→B fixo; `is_tracked` e MVP funcionam igual (por
  steam_id64, indiferente à plataforma).

## Testes

- Descoberta: paginação para na página toda-conhecida; primeira sincronização vai até o fim;
  filtro 5v5; dedupe contra fila e contra `matches.faceit_match_id`.
- ELO: escolha do before/after com 0, 1 e 2+ partidas na janela; backfill fica nulo.
- Stats-only: mapeamento roster/stats da API → `players` dict mínimo válido pro `store_parsed`.
- Download: descompressão `.dem.gz`; falha de download cai no fallback sem derrubar o lote.
- Fila: retry até 3, depois `failed`; itens `done` não reprocessam.
- Suites existentes intactas (o pipeline compartilhado não muda de assinatura).

## Fora de escopo (explicitamente adiado)

- Webhooks "Match Demo Ready" (substituir polling) — otimização futura (B.2).
- ELO de jogadores fora do grupo.
- Gráfico de evolução de ELO ao longo do tempo (mesma decisão do Premier).
- Modos não-5v5 da FACEIT (wingman/2v2).
