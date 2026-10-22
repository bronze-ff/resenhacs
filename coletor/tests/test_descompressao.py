import gzip

import pytest

from coletor import descompressao, storage_r2


def _extrair(dados, destino, max_bytes=400):
    descompressao.descomprimir_gzip(dados, destino, max_bytes=max_bytes)
    return destino.read_bytes()


def _gzip_crc_invalido():
    dados = gzip.compress(b"demo com crc alterado")
    return dados[:-8] + bytes([dados[-8] ^ 1]) + dados[-7:]


def test_descomprimir_gzip_escreve_todos_os_membros_concatenados(tmp_path):
    destino = tmp_path / "demo.dem"
    dados = gzip.compress(b"demo-") + gzip.compress(b"inteira")

    assert _extrair(dados, destino, max_bytes=12) == b"demo-inteira"


def test_descomprimir_gzip_aceita_saida_no_teto_e_recusa_um_byte_a_mais(tmp_path):
    destino = tmp_path / "demo.dem"

    assert _extrair(gzip.compress(b"1234"), destino, max_bytes=4) == b"1234"

    with pytest.raises(storage_r2.ArquivoGrandeDemaisError):
        _extrair(gzip.compress(b"12345"), destino, max_bytes=4)
    assert len(destino.read_bytes()) <= 4


@pytest.mark.parametrize(
    "dados",
    [
        b"",
        b"nao e gzip",
        gzip.compress(b"demo truncada")[:-4],
        _gzip_crc_invalido(),
        gzip.compress(b"demo") + b"lixo no fim",
    ],
    ids=["vazio", "cabecalho-invalido", "truncado", "crc-invalido", "cauda-invalida"],
)
def test_gzip_invalido_gera_erro_neutro(dados, tmp_path):
    with pytest.raises(descompressao.GzipInvalidoError) as erro:
        _extrair(dados, tmp_path / "demo.dem")

    assert str(erro.value) == "arquivo .dem.gz inválido"
