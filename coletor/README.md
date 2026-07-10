# Coletor

Descobre Partidas, parseia demos de CS2 e grava stats + highlights no banco do Resenha.
Python + [demoparser2](https://github.com/LaihoE/demoparser). Ver [ADR-0001](../docs/adr/0001-coletor-python-github-actions.md).

## Dois modos

| Comando | O que faz | Precisa de |
|---|---|---|
| `python -m coletor.main discover` | Anda a corrente de share codes de cada Jogador (Steam Web API) e registra Partidas novas como `pending`. Roda de hora em hora no GitHub Actions. | `DATABASE_URL`, `STEAM_API_KEY` |
| `python -m coletor.main ingest <demo.dem> --share-code CSGO-… --source upload` | Parseia um `.dem` local, arquiva no R2 e grava stats/highlights. Caminho **manual** (você baixa o demo e roda). | `DATABASE_URL` (+ R2 opcional) |

Rodar sempre com `PYTHONPATH=src` (o pacote fica em `src/coletor`).

## Limitação conhecida: download automático de demo de MM

`discover` descobre os share codes automaticamente, mas o **download do `.dem` de
matchmaking** exige o Game Coordinator da Valve, acessível só via uma conta-bot Steam
(bibliotecas ValvePython/steam + csgo) ou o `boiler-writer` com um cliente Steam rodando.
Isso não roda no GitHub Actions e ficou **fora da Fase 2**. Por isso:

- Partidas descobertas ficam `pending` (aparecem no site como "demo pendente").
- O caminho que funciona hoje é o `ingest` manual — inclusive para Faceit/Gamers Club,
  que dão o `.dem` para download direto.

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
```
