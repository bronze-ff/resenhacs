"""Extração de .dem de dentro do .rar que o HLTV distribui (demo de partida
profissional) — usa `unar` (licença livre, BSD) como backend, não o `unrar`
proprietário, pra rodar sem problema no runner do GitHub Actions."""

from pathlib import Path

import rarfile

rarfile.UNAR_TOOL = "unar"


def extrair_dem_de_rar(caminho_rar, destino_dir):
    """Extrai o primeiro .dem de dentro do .rar em `caminho_rar` pra `destino_dir`.
    Devolve o Path do .dem extraído. Levanta RuntimeError se não achar nenhum .dem."""
    destino_dir = Path(destino_dir)
    destino_dir.mkdir(parents=True, exist_ok=True)

    with rarfile.RarFile(str(caminho_rar)) as rf:
        dem_nomes = [n for n in rf.namelist() if n.lower().endswith(".dem")]
        if not dem_nomes:
            raise RuntimeError(f"nenhum .dem encontrado dentro de {caminho_rar}")
        rf.extract(dem_nomes[0], path=str(destino_dir))
        return destino_dir / dem_nomes[0]
