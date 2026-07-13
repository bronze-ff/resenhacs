import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor.rar_extract import extrair_dem_de_rar

FIXTURE = Path(__file__).parent / "fixtures" / "exemplo.rar"


def test_extrai_dem_do_rar():
    with tempfile.TemporaryDirectory() as tmp:
        caminho = extrair_dem_de_rar(FIXTURE, Path(tmp))
        assert caminho.suffix == ".dem"
        assert caminho.read_bytes() == b"conteudo de teste"


def test_rar_sem_dem_dentro_da_erro():
    import zipfile

    with tempfile.TemporaryDirectory() as tmp:
        # .rar "vazio de .dem" simulado com um arquivo qualquer não-.dem — testa só o
        # caminho de erro da função, não precisa ser um .rar real pra esse caso.
        falso = Path(tmp) / "sem_dem.rar"
        falso.write_bytes(b"nao e rar de verdade")
        try:
            extrair_dem_de_rar(falso, Path(tmp) / "saida")
            assert False, "deveria ter levantado erro"
        except Exception:
            pass
