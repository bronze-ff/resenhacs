# Coletor

Descobre Partidas, parseia demos de CS2 e grava stats + highlights no banco do Resenha.
Python + [demoparser2](https://github.com/LaihoE/demoparser). Ver [ADR-0001](../docs/adr/0001-coletor-python-github-actions.md).

## Dois modos

| Comando | O que faz | Precisa de |
|---|---|---|
| `python -m coletor.main discover` | Anda a corrente de share codes de cada Jogador (Steam Web API) e registra Partidas novas como `pending`, com `played_at` = hora da descoberta. Roda de hora em hora no GitHub Actions. | `DATABASE_URL`, `STEAM_API_KEY` |
| `python -m coletor.main ingest <demo.dem> --share-code CSGO-… --source upload [--played-at ISO8601]` | Parseia um `.dem` local, arquiva no R2 e grava stats/highlights. Caminho **manual**. Sem `--played-at`, cai pra mtime do arquivo (pode estar errada — ver abaixo). | `DATABASE_URL` (+ R2 opcional) |

Rodar sempre com `PYTHONPATH=src` (o pacote fica em `src/coletor`). Também dá pra usar
`ingest` pela tela do site (`/enviar-demo`) em vez do terminal — ver `site/server/src/routes/upload.js`
(só funciona local/self-hosted, roda o Python via `child_process`).

## Data da Partida (`played_at`)

O formato `.dem` **não guarda data/hora em lugar nenhum** (confirmado: nem header, nem
cvars, nem `hltv_versioninfo`). `discover` grava a hora da descoberta (precisa, já que
roda de hora em hora); `ingest` manual sem `--played-at` cai pra mtime do arquivo, que
só reflete quando o `.dem` foi baixado/copiado — pode estar bem errada se isso aconteceu
dias depois de jogado. Use `--played-at "2026-07-09T20:15:00-03:00"` quando souber a
data certa (ou preencha o campo equivalente na tela de upload).

## Limitação conhecida: download automático de demo de MM

`discover` descobre os share codes automaticamente (via `GetNextMatchSharingCode`, só
Web API — sem bot), mas o **download do `.dem` de matchmaking** exige uma conexão
autenticada ao Game Coordinator da Valve, confirmado em múltiplas fontes (documentação
da Valve, [node-globaloffensive](https://github.com/DoctorMcKay/node-globaloffensive),
[cs-demo-downloader](https://github.com/claabs/cs-demo-downloader)): a Web API consegue
iterar share codes, mas a URL do replay em si só sai do GC. Não existe atalho documentado
pra pular essa etapa — nem o `match_auth_code` que já coletamos no onboarding resolve
sozinho, ele só alimenta a descoberta.

Isso não roda no GitHub Actions sem uma conta Steam dedicada (bot) conectada via
`steam-user`/`globaloffensive` (Node) — decisão pendente do dono do projeto (guardar
credenciais de login como secret tem implicações de segurança que só ele pode pesar).
Enquanto isso:

- Partidas descobertas ficam `pending` (aparecem no site como "demo pendente").
- O caminho que funciona hoje é o `ingest` manual (CLI ou `/enviar-demo`) — inclusive
  para Faceit/Gamers Club, que dão o `.dem` para download direto.

Resolver o GC (conta-bot) é a **Fase 2b** — o `ingest_demo()` já isola o ponto onde a
URL do demo entraria.

## Segredos (GitHub → Settings → Secrets → Actions)

- `DATABASE_URL` — Session Pooler do Supabase (IPv4).
- `STEAM_API_KEY` — https://steamcommunity.com/dev/apikey.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — Cloudflare R2 (para `ingest`).

## Testes

```
pip install -r dev-requirements.txt
python -m pytest -q
```

As transformações (share code, stats, rating, highlights, escrita no banco, upload)
são testadas com dados sintéticos e fakes — sem precisar de `.dem` real nem de rede.
O único ponto validável apenas contra um demo real é `parse.py` (a extração via
demoparser2); dano/assist e placar round-a-round são finalizados lá quando houver um
demo de teste.
