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


def test_arma_limpa_nao_aplica_mais_alias_so_remove_prefixo():
    # Bug real (achado pelo usuário, 2026-07-13): _arma_limpa costumava achatar
    # m4a1_silencer/usp_silencer/revolver pro nome genérico do par (m4a1/hkp2000/
    # deagle) — só que isso rodava também em cima de KILLS e shots_fired, que já vêm
    # certos (player_death/weapon_fire distinguem a dupla). Resultado: todo kill de
    # USP-S virava P2000 nas stats. Agora essa função só tira o prefixo "weapon_";
    # a correção da ambiguidade é _mapa_variante_ambigua/_resolver_arma_hurt, e só
    # se aplica ao hit/dano (player_hurt).
    assert parse._arma_limpa("m4a1_silencer") == "m4a1_silencer"
    assert parse._arma_limpa("weapon_m4a1_silencer") == "m4a1_silencer"
    assert parse._arma_limpa("usp_silencer") == "usp_silencer"
    assert parse._arma_limpa("revolver") == "revolver"
    assert parse._arma_limpa("ak47") == "ak47"
    assert parse._arma_limpa("deagle") == "deagle"


def test_mapa_variante_ambigua_so_grava_quando_a_precisa_foi_disparada():
    disparos = [
        {"user_steamid": "1", "weapon": "usp_silencer", "round": 1},
        {"user_steamid": "1", "weapon": "hkp2000", "round": 2},  # P2000 de verdade no round 2
        {"user_steamid": "2", "weapon": "weapon_m4a1_silencer", "round": 1},
        {"user_steamid": "3", "weapon": "ak47", "round": 1},  # arma sem ambiguidade — ignorada
    ]
    mapa = parse._mapa_variante_ambigua(disparos)
    assert mapa == {
        ("1", 1, "hkp2000"): "usp_silencer",
        ("2", 1, "m4a1"): "m4a1_silencer",
    }


def test_resolver_arma_hurt_corrige_generica_pra_precisa_quando_sabe_e_mantem_senao():
    mapa = {("1", 3, "hkp2000"): "usp_silencer"}
    # sabe que foi USP-S naquele round -> corrige
    assert parse._resolver_arma_hurt(mapa, "1", 3, "hkp2000") == "usp_silencer"
    # sem info nesse round -> mantém a genérica (era P2000 mesmo)
    assert parse._resolver_arma_hurt(mapa, "1", 4, "hkp2000") == "hkp2000"
    # arma que não é uma das genéricas ambíguas -> passa direto, nunca troca
    assert parse._resolver_arma_hurt(mapa, "1", 3, "ak47") == "ak47"


def test_eh_arma_de_fogo_exclui_faca_e_granada():
    assert parse._eh_arma_de_fogo("weapon_ak47") is True
    assert parse._eh_arma_de_fogo("ak47") is True
    assert parse._eh_arma_de_fogo("knife") is False
    assert parse._eh_arma_de_fogo("hegrenade") is False
    assert parse._eh_arma_de_fogo("c4") is False
    assert parse._eh_arma_de_fogo(None) is False
