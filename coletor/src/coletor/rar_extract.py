"""Extração de .dem de dentro do .rar que o HLTV distribui (demo de partida
profissional) — usa `unar` (licença livre, BSD) como backend, não o `unrar`
proprietário, pra rodar sem problema no runner do GitHub Actions."""

import os
from pathlib import Path

import rarfile

# Auditoria finding #6: teto do total DESCOMPRIMIDO de um .rar — sem isso, um .rar
# malicioso ("zip bomb": poucos KB comprimidos que explodem em gigabytes ao extrair)
# esgotaria o disco do runner. 2GB cobre com folga uma série Bo5 inteira de demos.
_MAX_DESCOMPRIMIDO_BYTES = 2_000_000_000

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


def _caminho_seguro(destino_dir, nome):
    """Resolve onde `nome` (membro do .rar, string bruta) seria escrito dentro de
    `destino_dir` e garante que o resultado fica DE VERDADE dentro desse diretório.

    Achado #6 da auditoria: rf.extract(nome, ...) usava o nome do membro sem validar —
    um `.rar` malicioso com uma entrada tipo `../../../etc/cron.d/x` ou um caminho
    absoluto escreveria fora do diretório de extração esperado (path traversal/zip
    slip). `os.path.realpath` resolve os `..` E os separadores de path DE VERDADE
    (não só compara texto), então cobre tanto travessia relativa quanto um nome de
    membro que já vem absoluto (nesse caso `os.path.join` descarta o `destino_dir` e
    usa só o absoluto — o realpath fora da base pega esse caso também)."""
    candidato = os.path.realpath(os.path.join(str(destino_dir), nome))
    base = os.path.realpath(str(destino_dir))
    if candidato != base and not candidato.startswith(base + os.sep):
        raise RuntimeError(f"nome de arquivo suspeito dentro do .rar (fora do destino): {nome!r}")
    return candidato


def extrair_dems_de_rar(caminho_rar, destino_dir):
    """Extrai TODOS os .dem de dentro do .rar em `caminho_rar` pra `destino_dir`.

    Uma demo profissional do HLTV normalmente vem num único .rar com vários .dem —
    um por mapa de uma série Bo3/Bo5. Devolve a lista de Path extraídos, na mesma
    ordem em que aparecem dentro do .rar. Levanta RuntimeError se não achar nenhum
    .dem, se algum nome de membro for suspeito (ver _caminho_seguro) ou se o total
    DESCOMPRIMIDO declarado passar do teto (ver _MAX_DESCOMPRIMIDO_BYTES) — ambas as
    checagens rodam ANTES de extrair qualquer arquivo, não durante."""
    destino_dir = Path(destino_dir)
    destino_dir.mkdir(parents=True, exist_ok=True)

    with rarfile.RarFile(str(caminho_rar)) as rf:
        dem_nomes = [n for n in rf.namelist() if n.lower().endswith(".dem")]
        if not dem_nomes:
            raise RuntimeError(f"nenhum .dem encontrado dentro de {caminho_rar}")

        total_descomprimido = 0
        for nome in dem_nomes:
            _caminho_seguro(destino_dir, nome)
            total_descomprimido += rf.getinfo(nome).file_size
        if total_descomprimido > _MAX_DESCOMPRIMIDO_BYTES:
            raise RuntimeError(
                f"{caminho_rar}: {total_descomprimido} bytes descomprimidos, "
                f"acima do teto de {_MAX_DESCOMPRIMIDO_BYTES} bytes"
            )

        caminhos = []
        for nome in dem_nomes:
            rf.extract(nome, path=str(destino_dir))
            caminhos.append(destino_dir / nome)
        return caminhos
