"""Extração de .dem de dentro do .rar que o HLTV distribui (demo de partida
profissional) — usa `unar` (licença livre, BSD) como backend, não o `unrar`
proprietário, pra rodar sem problema no runner do GitHub Actions."""

from pathlib import Path

import rarfile

rarfile.UNAR_TOOL = "unar"

# rarfile.UNAR_TOOL só define o nome/caminho do executável usado SE o backend
# `unar` for escolhido — não impede o backend `unrar` (proprietário) de ser
# escolhido primeiro quando presente no sistema. `rarfile.tool_setup()` monta
# uma lista de prioridade [unrar, unar, sevenzip, sevenzip2, bsdtar] e usa o
# PRIMEIRO cujo check_cmd funcionar; `unrar` é testado incondicionalmente
# antes de `unar`. Chamar `tool_setup(unrar=False, ...)` uma vez de cara
# resolveria isso, mas `tool_setup()` só é invocado sob demanda (lazy, na
# primeira extração que precisa de ferramenta externa — arquivos .rar
# "store"/sem compressão nem chegam a chamar essa função) e chamá-lo aqui
# eagerly quebraria em máquinas sem NENHUMA ferramenta instalada (ex.: esta
# própria máquina de dev, que só extrai o fixture de teste via caminho
# pure-Python). Por isso, em vez de forçar a resolução agora, embrulhamos
# `rarfile.tool_setup` numa versão que sempre exclui o backend `unrar`,
# não importa quando (nem com quais argumentos) ele acabe sendo chamado —
# lazy ou não, direto pela lib ou por código nosso.
_tool_setup_original = rarfile.tool_setup


def _tool_setup_sem_unrar(unrar=True, unar=True, bsdtar=True, sevenzip=True, sevenzip2=True, force=False):
    return _tool_setup_original(
        unrar=False, unar=unar, bsdtar=bsdtar, sevenzip=sevenzip, sevenzip2=sevenzip2, force=force
    )


rarfile.tool_setup = _tool_setup_sem_unrar


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
