# Coletor de demos em Python via GitHub Actions, separado do site Node

O site é React + Vite + Express (stack que o autor domina), mas não existe parser maduro de demos CS2 em Node — os parsers de referência são demoparser2 (Python/Rust), demoinfocs-golang (Go) e demofile-net (.NET). Decidimos que o Coletor é um projeto Python independente usando demoparser2, executado de hora em hora via GitHub Actions (cron), gravando os resultados direto no Postgres (Supabase). GitHub Actions foi escolhido como compute por ser gratuito, aguentar downloads de demos (~100MB) sem problema e dispensar servidor dedicado — a alternativa de rodar no PC pessoal foi rejeitada porque demos de matchmaking expiram (~30 dias) e um PC desligado significaria partidas perdidas para sempre.

## Consequences

- O repositório tem dois runtimes (Node para o site, Python para o Coletor); o contrato entre eles é o schema do banco, não código compartilhado.
- A frequência do cron limita a "frescura" dos dados (partida aparece no site até ~1h depois de terminar).
- Se o grupo migrar o volume principal para Faceit/GC, o Coletor ganha novas fontes mas a arquitetura não muda.
