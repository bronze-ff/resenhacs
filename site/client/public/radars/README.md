# Radares dos mapas

A engine de Replay 2D usa `/radars/{map}.png` (1024×1024, top-down) como fundo.
Já estão incluídos os mapas da fila competitiva: mirage, inferno, dust2, nuke,
overpass, vertigo, ancient, anubis, train.

**Origem:** [2mlml/cs2-radar-images](https://github.com/2mlml/cs2-radar-images) — são os
radares oficiais extraídos do jogo (assets da Valve). Uso interno/privado do grupo. A
calibração (pos_x/pos_y/scale) em `coletor/src/coletor/replay.py` casa com esses PNGs
(conferida contra os `.txt` do mesmo repositório).

Para adicionar/atualizar um mapa: baixe `{map}.png` desse repositório para cá e confira
se a calibração correspondente existe em `MAP_CALIBRATION`.
