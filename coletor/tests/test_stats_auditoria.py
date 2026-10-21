"""Bugs de cálculo de stats achados na auditoria das fórmulas (parse/transform/replay).

O teste de parse_demo usa um demoparser2 falso (o real é nativo e não roda no CI de
testes): só os eventos e snapshots que parse_demo lê, montados à mão.
"""

import sys
import types
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import parse, replay, transform  # noqa: E402


# ---- demoparser2 falso -------------------------------------------------------------

_COLUNAS_VAZIAS = {
    "weapon_fire": ["tick", "total_rounds_played", "user_steamid", "weapon"],
}


class _ParserFalso:
    cenario = None

    def __init__(self, path):
        self.c = _ParserFalso.cenario

    def parse_header(self):
        return {"map_name": "de_teste"}

    def parse_event(self, nome, other=None):
        linhas = self.c["eventos"].get(nome, [])
        if not linhas:
            return pd.DataFrame(columns=_COLUNAS_VAZIAS.get(nome, ["tick"]))
        return pd.DataFrame(linhas)

    def parse_ticks(self, props, ticks):
        linhas = []
        for t in ticks:
            for sid, estado in self.c["estado"](t).items():
                linhas.append({"tick": t, "steamid": sid, **{p: estado.get(p) for p in props}})
        return pd.DataFrame(linhas)


def _estado(tick):
    """A1/A2 começam TR (time A), B1/B2 CT (time B). S é espectador (team_num 1).
    L entra no round 2 (não estava no 1º freeze_end), do lado CT."""
    base = {"is_alive": True, "X": 0.0, "Y": 0.0, "team_rounds_total": 1}
    estado = {
        "A1": {**base, "team_num": 2, "current_equip_value": 3700},
        "A2": {**base, "team_num": 2, "current_equip_value": 800},
        "B1": {**base, "team_num": 3, "current_equip_value": 1000},
        "B2": {**base, "team_num": 3, "current_equip_value": 1000},
        "S": {"team_num": 1},
    }
    if tick >= 1000:
        estado["L"] = {**base, "team_num": 3, "current_equip_value": 1000}
    return estado


def _morte(tick, trp, atk, vic, arma):
    return {
        "tick": tick, "total_rounds_played": trp, "is_warmup_period": False,
        "attacker_steamid": atk, "user_steamid": vic, "assister_steamid": None,
        "headshot": False, "weapon": arma, "attacker_name": atk, "user_name": vic,
    }


def _hit(tick, trp, atk, vic, arma, dmg):
    return {
        "tick": tick, "total_rounds_played": trp, "weapon": arma,
        "attacker_steamid": atk, "user_steamid": vic, "dmg_health": dmg,
    }


_CENARIO = {
    "estado": _estado,
    "eventos": {
        # Round 1 começa no tick 100, round 2 no 1000. O round 1 é decidido antes do
        # tick 850 (total_rounds_played já é 1), mas só termina oficialmente no 900.
        "round_freeze_end": [
            {"tick": 100, "total_rounds_played": 0},
            {"tick": 1000, "total_rounds_played": 1},
        ],
        "round_officially_ended": [{"tick": 900, "total_rounds_played": 1}],
        "cs_win_panel_match": [{"tick": 2000}],
        "player_death": [
            _morte(310, 0, "A1", "B2", "ak47"),  # B2 estava cego pela flash do próprio A1
            _morte(850, 1, "A1", "B1", "awp"),  # exit frag do round 1
            _morte(1200, 1, "L", "A2", "m4a1"),
        ],
        "player_hurt": [
            _hit(200, 0, "A1", "B1", "ak47", 30),
            _hit(310, 0, "A1", "B2", "ak47", 120),  # B2 tinha 100 de HP
            _hit(850, 1, "A1", "B1", "awp", 448),  # B1 tinha 70 de HP
            _hit(1100, 1, "A1", "L", "ak47", 20),
            _hit(1150, 1, "A1", "BOT", "ak47", 10),  # vítima sem time conhecido
            _hit(1200, 1, "L", "A2", "m4a1", 100),
        ],
        "player_blind": [
            {"tick": 300, "attacker_steamid": "A1", "user_steamid": "B2", "blind_duration": 2.0},
        ],
    },
}


def _parse_demo_falso(monkeypatch, tmp_path):
    modulo = types.ModuleType("demoparser2")
    modulo.DemoParser = _ParserFalso
    monkeypatch.setitem(sys.modules, "demoparser2", modulo)
    monkeypatch.setattr(_ParserFalso, "cenario", _CENARIO)
    dem = tmp_path / "partida.dem"
    dem.write_bytes(b"")
    return parse.parse_demo(dem)


def _jogador(out, sid):
    return next(p for p in out["players"] if p["steam_id64"] == sid)


# ---- 1. Jogador fora do 1º freeze_end / dano em quem não tem time -------------------

def test_parse_demo_inclui_quem_entra_depois_e_ignora_espectador(monkeypatch, tmp_path):
    out = _parse_demo_falso(monkeypatch, tmp_path)
    times = {p["steam_id64"]: p["team"] for p in out["players"]}
    assert times == {"A1": "A", "A2": "A", "B1": "B", "B2": "B", "L": "B"}
    assert _jogador(out, "L")["damage"] == 100


def test_times_fixos_quem_entra_depois_da_troca_herda_pelo_lado():
    registros = [
        {"tick": 100, "steamid": "a", "team_num": 2},
        {"tick": 100, "steamid": "b", "team_num": 3},
        {"tick": 100, "steamid": "s", "team_num": 1},
        {"tick": 100, "steamid": "n", "team_num": 0},
        # Depois do intervalo: A virou CT. "c" entra TR, então é do time B.
        {"tick": 9000, "steamid": "a", "team_num": 3},
        {"tick": 9000, "steamid": "b", "team_num": 2},
        {"tick": 9000, "steamid": "c", "team_num": 2},
    ]
    assert parse._times_fixos(registros) == {"a": "A", "b": "B", "c": "B"}


def test_parse_demo_dano_em_jogador_sem_time_nao_conta_como_inimigo(monkeypatch, tmp_path):
    out = _parse_demo_falso(monkeypatch, tmp_path)
    # 30 + 100 + 70 + 20; os 10 no BOT (sem time) ficam de fora do ADR.
    assert _jogador(out, "A1")["damage"] == 220


# ---- 2. Dano limitado pelo HP --------------------------------------------------------

def test_parse_demo_dano_limitado_pelo_hp_restante(monkeypatch, tmp_path):
    out = _parse_demo_falso(monkeypatch, tmp_path)
    pares = {}
    for d in out["player_damage"]:  # um item por arma; soma o par
        pares[(d["attacker"], d["victim"])] = pares.get((d["attacker"], d["victim"]), 0) + d["damage"]
    assert pares[("A1", "B2")] == 100
    assert pares[("A1", "B1")] == 30 + 70
    assert _jogador(out, "A1")["weapons"]["awp"]["damage"] == 70


# ---- 3. buy_type individual ----------------------------------------------------------

def test_tipo_de_compra_jogador_usa_limiar_individual():
    assert parse._tipo_de_compra_jogador(800) == "eco"
    assert parse._tipo_de_compra_jogador(1650) == "forcado"
    assert parse._tipo_de_compra_jogador(2800) == "semi"
    assert parse._tipo_de_compra_jogador(3350) == "full"


def test_parse_demo_buy_type_do_jogador_nao_usa_limiar_do_time(monkeypatch, tmp_path):
    out = _parse_demo_falso(monkeypatch, tmp_path)
    econ = {(e["round_number"], e["steam_id64"]): e["buy_type"] for e in out["player_round_econ"]}
    assert econ[(1, "A1")] == "full"  # fuzil + capacete ($3.700)
    assert econ[(1, "A2")] == "eco"


# ---- 4. 12x12 não é abandono ---------------------------------------------------------

def test_detectar_abandono_12x12_e_empate_normal():
    assert parse._detectar_abandono({"A": 12, "B": 12}, [100, 200], [], []) == (False, None)


def test_detectar_abandono_12x11_continua_abandono():
    ended_early, _ = parse._detectar_abandono({"A": 12, "B": 11}, [100, 200], [], [])
    assert ended_early is True


# ---- 6. Round pela janela do freeze_end ---------------------------------------------

def test_parse_demo_exit_frag_fica_no_round_em_que_aconteceu(monkeypatch, tmp_path):
    out = _parse_demo_falso(monkeypatch, tmp_path)
    exit_frag = next(k for k in out["kills"] if k["tick"] == 850)
    assert exit_frag["round_number"] == 1
    por_round = {(d["round_number"], d["steam_id64"]): d["damage"] for d in out["player_round_damage"]}
    assert por_round[(1, "A1")] == 200
    assert por_round[(2, "A1")] == 20


def test_round_pelas_janelas_usa_ultimo_freeze_end_e_fallback_antes_do_primeiro():
    round_do_tick = parse._round_pelas_janelas({100: 1, 1000: 2})
    assert round_do_tick(50, 99) == 99
    assert round_do_tick(100, 99) == 1
    assert round_do_tick(999, 99) == 1
    assert round_do_tick(1000, 99) == 2


# ---- Flash assist ----------------------------------------------------------------------

def test_parse_demo_flash_assist_nao_credita_kill_do_proprio_lancador(monkeypatch, tmp_path):
    out = _parse_demo_falso(monkeypatch, tmp_path)
    assert _jogador(out, "A1")["flash_assists"] == 0
    assert _jogador(out, "A1")["enemies_flashed"] == 1


# ---- Clutch: vítima de TK e desconectado --------------------------------------------

def test_clutch_outcomes_vitima_de_team_kill_nao_fica_viva():
    teams = {"a1": "A", "a2": "A", "b1": "B", "b2": "B", "b3": "B"}
    kills = [
        {"round_number": 1, "tick": 10, "attacker": "a1", "victim": "a2", "team_kill": True},
        {"round_number": 1, "tick": 20, "attacker": "b1", "victim": "a1", "team_kill": False},
    ]
    out = transform.clutch_outcomes(kills, teams, {1: "B"})
    assert out == [{"steam_id64": "a1", "round_number": 1, "vs": 3, "venceu": False, "salvou": False}]


def test_enrich_clutch_ignora_quem_estava_desconectado_no_inicio_do_round():
    # a2 já tinha caído antes do round 1: a1 fica 1v1 depois da 1ª kill.
    parsed = {
        "map": "de_mirage", "score_a": 1, "score_b": 0,
        "rounds": [{"round_number": 1, "winner_team": "A", "win_reason": "elim"}],
        "players": [
            {"steam_id64": sid, "nick": sid, "team": time, "kills": 0, "deaths": 0, "assists": 0,
             "headshot_kills": 0, "damage": 0}
            for sid, time in (("a1", "A"), ("a2", "A"), ("b1", "B"), ("b2", "B"))
        ],
        "kills": [
            {"round_number": 1, "tick": 10, "attacker": "a1", "victim": "b1", "headshot": False, "team_kill": False},
            {"round_number": 1, "tick": 20, "attacker": "a1", "victim": "b2", "headshot": False, "team_kill": False},
        ],
        "round_alive": [{"round_number": 1, "steam_id64": sid} for sid in ("a1", "b1", "b2")],
    }
    out = transform.enrich(parsed)
    a1 = _jogador(out, "a1")
    assert a1["clutch_wins"] == 1 and a1["clutch_attempts"] == 1


def test_build_replay_clutch_ignora_quem_nao_estava_no_inicio_do_round():
    def frame(rnd, tick, ids):
        return {"round": rnd, "tick": tick,
                "players": [{"id": i, "x": 0, "y": 0, "team": i[0].upper(), "alive": True} for i in ids]}

    # a2 só aparece no round 2 (desconectado no round 1).
    ticks = [frame(1, 100, ["a1", "b1", "b2"]), frame(2, 1000, ["a1", "a2", "b1", "b2"])]
    kills = [
        {"round": 1, "tick": 110, "killer": "a1", "victim": "b1"},
        {"round": 1, "tick": 120, "killer": "a1", "victim": "b2"},
    ]
    r = replay.build_replay("de_mapa_desconhecido", ticks, kills=kills, winner_by_round={1: "A"})
    assert r["rounds"][0]["clutch"] is not None
    assert r["rounds"][0]["clutch"]["steamid"] == "a1"
    assert r["rounds"][0]["clutch"]["vs"] == 1
