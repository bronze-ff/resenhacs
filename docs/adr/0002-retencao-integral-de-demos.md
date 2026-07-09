# Retenção integral dos Demos em storage de objetos

Demos de matchmaking expiram dos servidores da Valve em ~30 dias e o roadmap prevê análises profundas (nível Leetify/Scope) que exigirão re-parsear partidas antigas. Decidimos que o Coletor arquiva todo .dem (comprimido) em storage de objetos barato (Cloudflare R2) após o parsing, em vez de descartá-lo — descartar seria irreversível e faria as análises futuras valerem só para partidas novas. Custo estimado: ~US$0,15/mês a cada 100 partidas.
