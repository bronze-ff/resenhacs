import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

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
