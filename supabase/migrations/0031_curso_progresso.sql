-- Progresso do Curso de Mira por jogador × vídeo. Sem group_id: o acesso ao curso já é
-- controlado por requireGroupMember na rota; progresso é preferência pessoal do jogador.
create table curso_progresso (
  steam_id64 text not null references players(steam_id64),
  video_slug text not null,
  concluido boolean not null default false,
  posicao_segundos integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (steam_id64, video_slug)
);
