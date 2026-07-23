# Integração FACEIT — Design

Data: 2026-07-14. Decisão do usuário: integração COMPLETA (stats + demos no pipeline), com
vínculo de conta via OAuth ("Entrar com FACEIT") — cada membro clica um botão e loga na
FACEIT; só o admin configura chaves. Faseado.

## Arquitetura (separação chave app-level × OAuth por usuário)

- **OAuth (por usuário, sem chave)**: FACEIT tem OpenID Connect / "Login with FACEIT". O membro
  clica "Vincular FACEIT" → redirect pro login FACEIT → consente → callback → guardamos o
  `faceit_player_id` (e nickname) ligado ao `steam_id64` dele em `players`. Nenhum usuário cria chave.
- **Data/Downloads (app-level, 1 chave do admin)**: o servidor usa UMA chave de API server-side
  pra buscar histórico/stats/demos de cada membro vinculado, pelo `faceit_player_id`. Vai como
  secret (Vercel + GitHub Actions), nunca exposta ao client, nunca em chat.

## O que o ADMIN (Filippe) precisa criar em developers.faceit.com (checklist)

1. **OAuth app** (Login with FACEIT / OpenID Connect):
   - Redirect URI: `https://resenhacs.vercel.app/api/faceit/callback` (a API) — confirmar host exato.
   - Guarda: `FACEIT_CLIENT_ID` (público, pode me passar) + `FACEIT_CLIENT_SECRET` (secret → Vercel env).
2. **Data API key** com **Downloads access** habilitado (pra baixar demo): `FACEIT_API_KEY` (secret →
   Vercel env + GitHub Actions secret pro coletor).
3. Me passa o `FACEIT_CLIENT_ID` e confirma que setou `FACEIT_CLIENT_SECRET`/`FACEIT_API_KEY` nos
   secrets. (Nunca colar secret no chat — só nos painéis.)

## Fase A — Vínculo (OAuth) + identificação Premier/FACEIT

- Migration: `players.faceit_id text`, `players.faceit_nick text`. E `matches` ganha distinção de
  plataforma: hoje `source` tem valve_mm/upload/pro; a exibição vira badge **PREMIER** (valve_mm) /
  **FACEIT** (source='faceit') / **PRO** (pro). (Talvez um campo `plataforma` explícito, decidir no plano.)
- Server: rotas `GET /api/faceit/login` (redirect pro authorize da FACEIT com state/PKCE) e
  `GET /api/faceit/callback` (troca code por token, busca o player via OpenID/userinfo, grava
  faceit_id no player logado). Middleware de auth já existe (JWT). CSRF: state param.
- Client: botão "Vincular FACEIT" no perfil/onboarding; mostra "vinculado como <nick>" quando já linkado.
- Badge PREMIER/FACEIT no feed e no histórico do perfil (fácil, é só o source).

## Fase B — Ingestão de partidas FACEIT (stats) + demos no pipeline

- Coletor: cliente FACEIT Data API. Pra cada membro com `faceit_id`, andar o histórico
  (`/players/{id}/history?game=cs2`) desde o último importado; pra cada match nova:
  - **Stats**: `/matches/{id}` + `/matches/{id}/stats` → mapa, placar, por-jogador (rating/kd/hs/adr).
    Grava como `matches` source='faceit' + `match_players` (mesmo schema). Já aparece no feed/perfil.
  - **Demo (completo)**: `demo_url` da match é privado → trocar por URL assinada via Downloads API →
    baixar → rodar no MESMO pipeline (parse_demo/extract_replay/store_parsed), ganhando Replay 2D +
    granadas + scoreboard completo, source='faceit'. (Demo FACEIT é .dem.gz — ajustar descompressão.)
  - Idempotência por fingerprint (já temos) + guardar `faceit_match_id` pra dedupe.
  - Rodar no job agendado do coletor (mesmo cron), com STEAM/FACEIT keys no env.
- Webhook "Match Demo Ready" (opcional, fase B.2): em vez de polling, a FACEIT avisa quando o demo
  subiu — evita baixar antes de estar pronto.

## Riscos / decisões pro plano

- Rate limit da Data API (free ~10k/h) — ok pra grupo pequeno; paginar histórico com cuidado.
- Demo FACEIT gated/expira: a URL assinada é curta — baixar na hora do processamento.
- "Premier" de verdade vs comp casual do Valve MM: hoje ingerimos share codes do MM do membro; o
  modo (Premier/Competitive) pode vir no header do demo — se der, refinar o badge; senão "Premier/MM".
- Privacidade: importar partida FACEIT de um membro traz stats dos ADVERSÁRIOS também (como já
  acontece com demos) — consistente com o resto do sistema (grupo fechado).

## Fora de escopo (por ora)

- Ranking/ELO FACEIT como métrica separada (só se o usuário pedir depois).
- Vincular via nickname manual (o OAuth cobre; resolver por steam_id fica de fallback).
