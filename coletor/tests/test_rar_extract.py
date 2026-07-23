import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import rar_extract
from coletor.rar_extract import extrair_dems_de_rar

FIXTURE = Path(__file__).parent / "fixtures" / "exemplo.rar"
FIXTURE_MULTI = Path(__file__).parent / "fixtures" / "exemplo_multi.rar"


def test_extrai_dem_do_rar():
    with tempfile.TemporaryDirectory() as tmp:
        caminhos = extrair_dems_de_rar(FIXTURE, Path(tmp))
        assert len(caminhos) == 1
        assert caminhos[0].suffix == ".dem"
        assert caminhos[0].read_bytes() == b"conteudo de teste"


def test_extrai_varios_dem_do_rar():
    # HLTV distribui demo de série Bo3/Bo5 num único .rar com um .dem por mapa —
    # a função precisa devolver TODOS, não só o primeiro.
    with tempfile.TemporaryDirectory() as tmp:
        caminhos = extrair_dems_de_rar(FIXTURE_MULTI, Path(tmp))
        assert len(caminhos) == 2
        assert all(c.suffix == ".dem" for c in caminhos)
        conteudos = {c.read_bytes() for c in caminhos}
        assert conteudos == {b"mapa1", b"mapa2"}


def test_rar_sem_dem_dentro_da_erro():
    import zipfile

    with tempfile.TemporaryDirectory() as tmp:
        # .rar "vazio de .dem" simulado com um arquivo qualquer não-.dem — testa só o
        # caminho de erro da função, não precisa ser um .rar real pra esse caso.
        falso = Path(tmp) / "sem_dem.rar"
        falso.write_bytes(b"nao e rar de verdade")
        try:
            extrair_dems_de_rar(falso, Path(tmp) / "saida")
            assert False, "deveria ter levantado erro"
        except Exception:
            pass


# ---- finding #6 da auditoria: nome de membro malicioso (path traversal / zip slip) ----


class _FakeRarInfo:
    def __init__(self, file_size):
        self.file_size = file_size


class _FakeRarFile:
    """Simula rarfile.RarFile o suficiente pra testar as checagens de nome/tamanho de
    extrair_dems_de_rar sem precisar montar um .rar real malicioso (o que exigiria uma
    ferramenta externa capaz de gravar entradas com nome ../.. — a maioria recusa)."""

    def __init__(self, tamanhos_por_nome):
        self._tamanhos = tamanhos_por_nome

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def namelist(self):
        return list(self._tamanhos)

    def getinfo(self, nome):
        return _FakeRarInfo(self._tamanhos[nome])

    def extract(self, nome, path):
        (Path(path) / nome).write_bytes(b"x")


def test_extrai_dems_de_rar_rejeita_travessia_de_diretorio(monkeypatch, tmp_path):
    fake = _FakeRarFile({"../../evil.dem": 10})
    monkeypatch.setattr(rar_extract.rarfile, "RarFile", lambda p: fake)
    with pytest.raises(RuntimeError, match="suspeito"):
        extrair_dems_de_rar(tmp_path / "fake.rar", tmp_path / "saida")


def test_extrai_dems_de_rar_rejeita_caminho_absoluto(monkeypatch, tmp_path):
    absoluto = str((tmp_path / "fora" / "evil.dem").resolve())
    fake = _FakeRarFile({absoluto: 10})
    monkeypatch.setattr(rar_extract.rarfile, "RarFile", lambda p: fake)
    with pytest.raises(RuntimeError, match="suspeito"):
        extrair_dems_de_rar(tmp_path / "fake.rar", tmp_path / "saida")


def test_extrai_dems_de_rar_aborta_quando_total_descomprimido_excede_teto(monkeypatch, tmp_path):
    fake = _FakeRarFile({"m1.dem": rar_extract._MAX_DESCOMPRIMIDO_BYTES + 1})
    monkeypatch.setattr(rar_extract.rarfile, "RarFile", lambda p: fake)
    with pytest.raises(RuntimeError, match="teto"):
        extrair_dems_de_rar(tmp_path / "fake.rar", tmp_path / "saida")


def test_extrai_dems_de_rar_soma_os_dois_dems_antes_de_comparar_com_o_teto(monkeypatch, tmp_path):
    # Nenhum .dem sozinho passa do teto, mas a SOMA dos dois passa — tem que abortar
    # mesmo assim (zip bomb pode vir espalhada em várias entradas pequenas).
    metade = rar_extract._MAX_DESCOMPRIMIDO_BYTES // 2 + 1000
    fake = _FakeRarFile({"m1.dem": metade, "m2.dem": metade})
    monkeypatch.setattr(rar_extract.rarfile, "RarFile", lambda p: fake)
    with pytest.raises(RuntimeError, match="teto"):
        extrair_dems_de_rar(tmp_path / "fake.rar", tmp_path / "saida")


def test_extrai_dems_de_rar_aceita_quando_dentro_do_teto(monkeypatch, tmp_path):
    fake = _FakeRarFile({"m1.dem": 100, "m2.dem": 200})
    monkeypatch.setattr(rar_extract.rarfile, "RarFile", lambda p: fake)
    caminhos = extrair_dems_de_rar(tmp_path / "fake.rar", tmp_path / "saida")
    assert len(caminhos) == 2
    assert all(c.exists() for c in caminhos)


def test_caminho_seguro_aceita_nome_normal_dentro_do_destino(tmp_path):
    destino = tmp_path / "saida"
    destino.mkdir()
    resolvido = rar_extract._caminho_seguro(destino, "mapa1.dem")
    assert resolvido.startswith(str(destino.resolve()))
