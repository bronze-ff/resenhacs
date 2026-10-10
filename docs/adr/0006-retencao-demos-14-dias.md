# Retenção do .dem bruto cai de 90 para 14 dias

Substitui [ADR-0002](0002-retencao-integral-de-demos.md). Decisão do Filippe em 2026-10-10.

O bucket `resenha-demos` estava em ~159 GB. O free tier do Cloudflare R2 é 10 GB. O ADR-0002 mandava arquivar todo `.dem`, e o `cmd_cleanup` do Coletor só apagava o bruto com `played_at` há mais de 90 dias. Essa janela não cabe no free tier.

O `.dem` bruto (`demos/{match_id}.dem.bz2`) passa a sair do R2 14 dias depois de `played_at`. A janela é o argumento `--days` de `python -m coletor.main cleanup` (default `RETENCAO_DEMO_DIAS = 14`). O workflow do Coletor chama `cleanup --days 14` a cada execução. `replay.json` em `replays/` continua indefinido. Uploads pendentes e `curso-mira/` não entram nessa limpeza.

## Consequences

- Clipe Allstar novo, download do `.dem` e `reprocess` só funcionam enquanto `matches.demo_url` existe — na prática, Partidas dos últimos 14 dias. O cleanup zera `demo_url`. `GET /api/matches/:id/demo` e o pedido de clipe já respondem 404 nesse caso. A aba Clipes esconde "gerar melhor clipe" e "tentar de novo" quando não há demo; clipe já gerado continua assistível.
- Corrigir um bug de parser reprocessando Partida mais velha que 14 dias deixa de ser possível: a demo original já foi apagada.
- Reverter: `RETENCAO_DEMO_DIAS` e o `--days` do workflow voltam para 90. Demos que o job já apagou não voltam; o objeto no R2 não é recriado por essa reversão.
