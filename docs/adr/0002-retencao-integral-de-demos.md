# Retenção integral dos Demos em storage de objetos

> **Substituído em 2026-10-10 por [ADR-0006](0006-retencao-demos-14-dias.md).** O `.dem` bruto fica 14 dias no R2, não indefinidamente. O texto abaixo registra a decisão original.



Demos de matchmaking expiram dos servidores da Valve em ~30 dias e o roadmap prevê análises profundas (nível Leetify/Scope) que exigirão re-parsear partidas antigas. Decidimos que o Coletor arquiva todo .dem (comprimido) em storage de objetos barato (Cloudflare R2) após o parsing, em vez de descartá-lo — descartar seria irreversível e faria as análises futuras valerem só para partidas novas. Custo estimado: ~US$0,15/mês a cada 100 partidas.
