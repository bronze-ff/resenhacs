# Radares dos mapas (assets da Valve)

A engine de Replay 2D procura a imagem de fundo de cada mapa em `/radars/{map}.png`
(ex.: `de_mirage.png`, `de_inferno.png`), 1024×1024, top-down.

Essas imagens são **assets da Valve** e não são versionadas aqui. Para ativar o fundo
real (em vez da grade neutra), coloque os PNGs de radar aqui. Fontes comuns:

- Extrair de `game/csgo/pak01_dir.vpk` → `resource/overviews/` com um extrator de VPK.
- Repositórios da comunidade (ex.: simple-radar) — respeite a licença de cada um.

Sem os PNGs, a engine funciona igual, só que com uma grade de fundo. A calibração
(pos_x/pos_y/scale) que converte coordenadas do mundo para o radar fica em
`coletor/src/coletor/replay.py` (`MAP_CALIBRATION`) e deve casar com a imagem usada.
