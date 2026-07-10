-- Team kill não deve inflar kills/rating (bug real encontrado pelo dono do grupo:
-- 25 kills exibidos, mas 1 era TK). team_kills fica separado, só informativo.
alter table match_players add column team_kills integer not null default 0;
