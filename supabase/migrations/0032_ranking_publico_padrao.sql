-- Ranking público vira opt-OUT (era opt-in, default false desde 0021_times.sql).
-- Decisão do dono do projeto, ciente de que o login do Resenha é aberto (auth.js: qualquer
-- conta Steam entra) e que, portanto, ranking_publico = true expõe nick/avatar/stats
-- agregadas pra qualquer pessoa logada, não só pro grupo. Quem não quiser desativa em
-- Minha Conta (o toggle já existe, PUT /api/players/me/ranking-publico).
alter table players alter column ranking_publico set default true;

-- Retroativo: os jogadores que já existem nunca escolheram (nasceram no default false).
update players set ranking_publico = true;
