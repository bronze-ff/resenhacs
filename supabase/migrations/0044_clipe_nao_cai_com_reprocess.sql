-- Bug real encontrado (2026-07-22): allstar_clips.highlight_id tinha `on delete cascade`
-- desde a criação da tabela (0036). cmd_reprocess (coletor) faz DELETE + reinsert de
-- TODOS os highlights de uma Partida a cada reprocessamento (_write_highlights, sempre
-- fez isso, nada mudou nela) — com o cascade, isso apagava silenciosamente a linha de
-- allstar_clips inteira sempre que a Partida dona daquele clipe fosse reprocessada,
-- mesmo já tendo match_id/steam_id64/round_number preenchidos direto (migração 0042).
--
-- Confirmado na prática: o "Dust 2 Wallbang AK-47 1V1 Ace Clutch" do bronze sumiu da
-- aba Clipes depois do reprocess completo desta sessão — e no allstar.gg dá pra ver
-- os DOIS clipes gerados (21 e 22/07), o de 21/07 é o que a cascade apagou daqui.
--
-- Fix: troca pra `on delete set null` — reprocessar uma Partida não deve apagar o
-- registro do clipe, só desvincular do highlight antigo (que de qualquer forma não é
-- mais usado pra nada depois da 0042; match_id/steam_id64/round_number já bastam).
alter table allstar_clips drop constraint allstar_clips_highlight_id_fkey;
alter table allstar_clips add constraint allstar_clips_highlight_id_fkey
  foreign key (highlight_id) references highlights(id) on delete set null;
