-- Vídeo único da montagem. O render-fragmovie da DEMO-SLAP recusa trechos do
-- render-custom, então o Coletor (`juntar-clipes`) baixa os trechos, junta com ffmpeg
-- e grava o .mp4 no R2 em `clipes/<id>.mp4`. Enquanto a coluna está vazia, a aba
-- Clipes toca os trechos em sequência.
alter table clipes_reais add column video_r2_key text;
