# Coletor

Descobre Partidas, baixa e parseia Demos de CS2 e grava stats, highlights e Replay 2D no
banco do Resenha. Python + [demoparser2](https://github.com/LaihoE/demoparser). Ver
[ADR-0001](../docs/adr/0001-coletor-python-github-actions.md).

## Como roda

O job `sincroniza` de `.github/workflows/coletor.yml` roda a cada 10 min (`*/10`). Os
passos, em ordem:

| Passo | Comando | O que faz |
|---|---|---|
| Descobrir | `discover` | Anda a corrente de Share Codes de cada Jogador (Steam Web API) e grava as Partidas novas como `pending`. Se todos os Jogadores falharem, o check-in do cron `resenhacs-coletor` fica `error` e o processo sai 0. |
| Baixar e ingerir | `fetch` | Até 15 Partidas pendentes por run. O bot (`bot/src/resolve.js`) pega o link do `.dem` no Game Coordinator; o Coletor baixa, parseia, arquiva no R2 e grava. `played_at` vira o horário real da Partida (vem do GC). Erro de download gasta uma tentativa (3 no total). Bot fora não derruba o job. |
| Limpar | `cleanup --days 14` | Apaga do R2 o `.dem` bruto de Partidas com mais de 14 dias (ADR-0006). Conta a partir do maior entre `played_at` e `created_at`. O Replay 2D fica. |
| Fila pro | `processar-fila-pro` | Partidas profissionais enviadas pelo super admin (`.rar`/`.dem`). Série com mapa falho fica `falhou` com os mapas já gravados e o arquivo no R2 pro retry. |
| Uploads | `processar-uploads-pendentes` | Demos enviadas pelo Jogador em `/enviar-demo`. Detalhe abaixo. |
| Montagens | `juntar-clipes` | Junta os trechos de uma montagem da aba Clipes num vídeo único no R2 (DEMO-SLAP + ffmpeg). Sem `DEMOSLAP_API_KEY`, não faz nada. |
| FACEIT | `sincronizar-faceit` | Descobre e ingere Partidas 5v5 dos Jogadores com FACEIT vinculada, mais o ELO. |

Comandos sob demanda (inputs do `workflow_dispatch` ou terminal): `reprocess
[--since YYYY-MM-DD | --match-id UUID]`, `configurar-cors`, `avatares`,
`limpar-uploads-orfaos [--days N]`, `ingest <demo.dem>`. O workflow manual
`r2-replays.yml` roda `inventario-r2` e `comprimir-replays`.

Local: rode com `PYTHONPATH=src` (o pacote fica em `src/coletor`), por exemplo
`python -m coletor.main discover`. Variáveis em `.env.example`.

## Upload do Jogador (`processar-uploads-pendentes`)

O site gera uma URL assinada (15 min) e o navegador sobe o `.dem` direto pro R2
(`uploads-pendentes/<uuid>.dem`). O Coletor baixa, valida e ingere.

- Sucesso: `concluido`, e o arquivo de staging sai do R2.
- Erro definitivo (Demo não confere com a Partida, arquivo acima de 400 MB): `falhou`, e o staging sai na hora.
- Erro transitório (R2, banco, rede, parser): volta pra `pendente` com `tentativas + 1`. Na 3ª vira `falhou` e o staging sai.
- Arquivo ainda não chegou ao R2: com menos de 20 min do pedido, espera sem gastar tentativa; depois disso, `falhou`.
- Falha ao apagar o staging não muda o status; o erro vai pro Sentry e o arquivo órfão fica pro `limpar-uploads-orfaos`.

## Data da Partida (`played_at`)

O formato `.dem` **não guarda data/hora em lugar nenhum** (nem header, nem cvars, nem
`hltv_versioninfo`). `discover` grava a hora da descoberta e o `fetch` troca pelo
horário real que o GC devolve. No `ingest` manual, sem `--played-at`, vale a mtime do
arquivo, que pode estar errada. Use `--played-at "2026-07-09T20:15:00-03:00"` quando
souber a data certa.

## Avisos no Discord (`avisar-discord`)

Step "Avisar no Discord" do `coletor.yml`, depois do FACEIT, a cada 10 min. Usa
`DISCORD_WEBHOOK_URL` e `APP_URL`. Precisa da migration `0063_discord_avisos.sql`.

- **Clipe pronto:** Clipe real (`clipes_reais` em `pronto`) ou Allstar (`Processed`)
  das últimas 48 h que ainda não foi avisado. Um post por Partida, no máximo 3 posts
  por execução, com até 5 linhas "nick · modo". Nick só de Jogador do grupo
  (`is_tracked`); de fora aparece só "Clipe". O `pronto` de alguns Clipes só é gravado
  quando alguém abre a aba Clipes, então o aviso sai na execução seguinte.
- **Resenha da semana:** segunda-feira a partir das 10:00 de São Paulo, uma vez por
  semana (reserva em `discord_resenha_semanal`). Mostra a semana anterior: Partidas,
  vitórias, derrotas e 3 prêmios (Carregou, Rei do clutch, Granadeiro) com a mesma
  regra de `site/server/src/premios.js`. O grupo é o de quem tem `is_tracked`, não o
  círculo de cada Jogador, então os números podem diferir da tela. Semana sem Partida
  não posta.
- Sem webhook: não abre o banco. Sem a 0063: avisa no log e sai 0. Outro erro: Sentry
  (etapa `avisar-discord`) e sai 0. O step nunca derruba o job.
- Post que falha libera a reserva e tenta na próxima execução. Crash entre a reserva e
  o post perde o aviso (mesmo limite da 0057): sem post duplicado vale mais.

## Segredos (GitHub → Settings → Secrets → Actions)

| Secret | Uso |
|---|---|
| `DATABASE_URL` | Session Pooler do Supabase (IPv4). Todos os passos. |
| `STEAM_API_KEY` | https://steamcommunity.com/dev/apikey. `discover`, avatares, FACEIT. |
| `STEAM_BOT_USER`, `STEAM_BOT_PASS` | Conta-bot do `fetch` (ver `bot/README.md`). |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2: Demo, Replay 2D, staging, montagens. |
| `FACEIT_API_KEY` | `sincronizar-faceit`. |
| `DEMOSLAP_API_KEY` | `juntar-clipes`. Opcional. |
| `DISCORD_WEBHOOK_URL` | Opcional. Embed no canal do grupo quando uma Partida com Jogador do grupo é ingerida (Partida pro não). Sem SteamID. Erro de rede vira aviso no log, nunca derruba o job. Ver `src/coletor/discord.py`. |
| `APP_URL` | Base do link do embed: a origem do client (`https://resenha-phi.vercel.app`). |
| `SENTRY_DSN` | Projeto `resenhacs-coletor`. Vazio = Sentry desligado. |

## Observabilidade

Sem `SENTRY_DSN` nada é enviado. Com DSN, todo erro tratado por item (uma Partida, um
upload, um Jogador) vai pro Sentry com a tag `etapa` (`fetch`, `cleanup`,
`processar-uploads-pendentes`…), passando pelo scrub de `src/coletor/observabilidade.py`.
O log do Actions é público: sai só o tipo do erro, nunca a mensagem, o Share Code ou o
SteamID (estes viram uma referência curta por hash).

## Dependência de sistema: `unar` (extração de `.rar` do HLTV)

`src/coletor/rar_extract.py` usa a biblioteca Python `rarfile` pra extrair o `.dem` de
dentro do `.rar` das Partidas profissionais. `rarfile` chama uma ferramenta externa:
usamos `unar` (licença BSD) em vez do `unrar` proprietário.

- **CI (GitHub Actions, Ubuntu):** `apt-get install -y unar` (passo do workflow).
- **Local (Linux):** `apt-get install unar` ou equivalente da distro.
- **Local (macOS):** `brew install unar`.
- **Local (Windows):** não há build oficial de `unar`; `test_extrai_dem_do_rar` pode
  falhar localmente. Fixtures pequenas sem compressão às vezes passam porque `rarfile`
  lê esse caso em Python puro, mas isso não vale pra `.rar` reais do HLTV.

## Manutenção: limpeza de uploads órfãos no R2

```
python -m coletor.main limpar-uploads-orfaos [--days N]
```

Apaga do R2 o objeto de todo upload `falhou` há mais de `N` dias (default: 30) e marca
o item como `limpo`. Cobre o caso raro em que apagar o staging falhou na hora.
**Não roda automaticamente**: não há passo no workflow.

## Testes

```
pip install -r dev-requirements.txt
python -m pytest -q
```

Ou, da raiz do repositório: `node scripts/verify.mjs coletor`.

As transformações (Share Code, stats, rating, highlights, escrita no banco, upload)
são testadas com dados sintéticos e fakes, sem `.dem` real nem rede. Só `parse.py`
(a extração via demoparser2) depende de uma Demo real.
