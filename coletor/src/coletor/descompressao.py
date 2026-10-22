"""Descompressão limitada para arquivos de upload manual."""

import gzip
import io
import zlib

from .storage_r2 import ArquivoGrandeDemaisError


_BLOCO = 1 << 20


class GzipInvalidoError(ValueError):
    """Arquivo .dem.gz incompleto ou inválido, sem expor bytes nem detalhes internos."""

    def __init__(self):
        super().__init__("arquivo .dem.gz inválido")


def descomprimir_gzip(dados, destino, max_bytes):
    """Descomprime todos os membros gzip para o destino, limitado pelo total gravado."""
    if not dados.startswith(b"\x1f\x8b"):
        raise GzipInvalidoError()
    escrito = 0
    with io.BytesIO(dados) as entrada, gzip.GzipFile(fileobj=entrada, mode="rb") as origem, open(destino, "wb") as saida:
        while True:
            restante = max_bytes - escrito
            try:
                parte = origem.read(min(_BLOCO, restante + 1))
            except (OSError, EOFError, zlib.error) as exc:
                raise GzipInvalidoError() from exc
            if not parte:
                break
            if len(parte) > restante:
                raise ArquivoGrandeDemaisError(
                    f"demo descomprimida excedeu o teto de {max_bytes} bytes"
                )
            saida.write(parte)
            escrito += len(parte)
