import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pytest
from coletor import sharecode


def test_round_trip():
    for ids in [
        (3230500992562884609, 3230500992562884609, 20658),
        (1, 2, 3),
        (0, 0, 0),
        (18446744073709551615, 18446744073709551615, 65535),  # máximos
    ]:
        code = sharecode.encode(*ids)
        assert sharecode.decode(code) == {
            "match_id": ids[0],
            "reservation_id": ids[1],
            "tv_port": ids[2],
        }


def test_format_do_codigo():
    code = sharecode.encode(123, 456, 789)
    assert code.startswith("CSGO-")
    grupos = code[len("CSGO-") :].split("-")
    assert len(grupos) == 5
    assert all(len(g) == 5 for g in grupos)


def test_decode_rejeita_invalido():
    with pytest.raises(ValueError):
        sharecode.decode("CSGO-curto")
    with pytest.raises(ValueError):
        sharecode.decode("não é um code")


def test_is_valid():
    assert sharecode.is_valid(sharecode.encode(1, 2, 3))
    assert not sharecode.is_valid("CSGO-inval")


def test_vetor_real_do_game_coordinator():
    """Vetor de calibração REAL: share code de uma partida cujo matchid/reservationid
    o Game Coordinator devolveu (10/07/2026). Round-trip sintético não pega dicionário
    errado (encode/decode ficam simétricos no erro) — só um vetor externo pega."""
    d = sharecode.decode("CSGO-jjd5D-2JkUG-q9A8u-vABu5-PeS8N")
    assert d["match_id"] == 3823672835881042126
    assert d["reservation_id"] == 3823678666299146520


def test_dicionario_oficial_57_chars():
    assert len(sharecode.DICTIONARY) == 57  # base 57; um char a mais estoura os 18 bytes
    for proibido in "Ilg01":
        assert proibido not in sharecode.DICTIONARY


def test_is_valid_nao_vaza_overflow():
    # 25 'z' (índice máximo) estourava com OverflowError em vez de devolver False.
    assert sharecode.is_valid("CSGO-zzzzz-zzzzz-zzzzz-zzzzz-zzzzz") is False
