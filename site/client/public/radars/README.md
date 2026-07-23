# Radares dos mapas

A engine de Replay 2D usa `/radars/{map}.png` (1024×1024, top-down) como fundo.
Já estão incluídos os mapas da fila competitiva: mirage, inferno, dust2, nuke,
overpass, vertigo, ancient, anubis, train, cache.

**Origem:** [2mlml/cs2-radar-images](https://github.com/2mlml/cs2-radar-images) — são os
radares oficiais extraídos do jogo (assets da Valve). Uso interno/privado do grupo. A
calibração (pos_x/pos_y/scale) em `coletor/src/coletor/replay.py` casa com esses PNGs
(conferida contra os `.txt` do mesmo repositório).

**de_cache** é exceção: não estava em 2mlml/cs2-radar-images até jul/2026 (mapa
recém-devolvido ao CS2). `de_cache.png` veio de
[MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons)
(`images/radars/de_cache_radar_psd.png`, 1024×1024, extraído do depot do jogo). A
calibração bate com o `de_cache.txt` do mesmo repo (`pos_x=-2000, pos_y=3250,
scale=5.5` — idênticos aos valores clássicos do CS:GO, sem `rotate`).

Para adicionar/atualizar um mapa: baixe `{map}.png` desse repositório para cá e confira
se a calibração correspondente existe em `MAP_CALIBRATION`.
