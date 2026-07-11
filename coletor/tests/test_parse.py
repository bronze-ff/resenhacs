import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

# demoparser2 só é importado DENTRO de parse_demo()/extract_replay() (nativo, Rust) —
# o módulo em si (e suas funções puras) importa sem precisar do pacote instalado.
from coletor import parse


def test_tipo_de_compra_thresholds_hltv():
    # Esquema HLTV/awpy validado via pesquisa web (2026-07-11): eco<5k, forçado 5k-10k,
    # semi 10k-20k, full>=20k — soma do equipamento dos 5 jogadores do time.
    assert parse._tipo_de_compra(0) == "eco"
    assert parse._tipo_de_compra(4999) == "eco"
    assert parse._tipo_de_compra(5000) == "forcado"
    assert parse._tipo_de_compra(9999) == "forcado"
    assert parse._tipo_de_compra(10000) == "semi"
    assert parse._tipo_de_compra(19999) == "semi"
    assert parse._tipo_de_compra(20000) == "full"
    assert parse._tipo_de_compra(30000) == "full"


def test_arma_limpa_remove_prefixo_weapon():
    assert parse._arma_limpa("weapon_ak47") == "ak47"
    assert parse._arma_limpa("ak47") == "ak47"  # player_death/player_hurt já vêm sem prefixo
    assert parse._arma_limpa(None) is None
    assert parse._arma_limpa("") is None


def test_arma_limpa_aplica_alias_das_duplas_que_player_hurt_nao_distingue():
    # Descoberta empírica (2026-07-11, demo real): m4a1/m4a1_silencer, usp_silencer/
    # hkp2000 e revolver/deagle chegam com o MESMO weapon no player_hurt (rastreado
    # round a round), mesmo o player_death distinguindo certinho — sem esse alias,
    # a arma "perdedora" do par fica com kills>0 mas 0 hit/dano (accuracy quebrada).
    assert parse._arma_limpa("m4a1_silencer") == "m4a1"
    assert parse._arma_limpa("weapon_m4a1_silencer") == "m4a1"
    assert parse._arma_limpa("usp_silencer") == "hkp2000"
    assert parse._arma_limpa("revolver") == "deagle"
    # armas sem alias passam direto
    assert parse._arma_limpa("ak47") == "ak47"
    assert parse._arma_limpa("deagle") == "deagle"


def test_eh_arma_de_fogo_exclui_faca_e_granada():
    assert parse._eh_arma_de_fogo("weapon_ak47") is True
    assert parse._eh_arma_de_fogo("ak47") is True
    assert parse._eh_arma_de_fogo("knife") is False
    assert parse._eh_arma_de_fogo("hegrenade") is False
    assert parse._eh_arma_de_fogo("c4") is False
    assert parse._eh_arma_de_fogo(None) is False
