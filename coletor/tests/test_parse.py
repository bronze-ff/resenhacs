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


# ---- _construir_rounds (dívida técnica: round decisivo sumia da tabela `rounds`) ----

def test_construir_rounds_caso_normal_sem_round_faltando():
    end_ticks = [100, 200, 300]
    by_tick = {
        100: {"A": 1, "B": 0},
        200: {"A": 1, "B": 1},
        300: {"A": 2, "B": 1},
    }
    score = {"A": 2, "B": 1}  # bate exatamente com o que os round_officially_ended já contam
    rounds = parse._construir_rounds(end_ticks, by_tick, score)
    assert len(rounds) == 3
    assert [r["winner_team"] for r in rounds] == ["A", "B", "A"]
    assert [r["round_number"] for r in rounds] == [1, 2, 3]


def test_construir_rounds_completa_o_round_decisivo_faltando():
    # round_officially_ended só disparou pros 2 primeiros rounds — o 3º (que fecha o
    # mapa, 13x9 por exemplo) nunca chegou. score final diz que o time A tem mais 1
    # round do que o contabilizado pelos ticks -> completa como vitória de A.
    end_ticks = [100, 200]
    by_tick = {100: {"A": 1, "B": 0}, 200: {"A": 1, "B": 1}}
    score = {"A": 2, "B": 1}
    rounds = parse._construir_rounds(end_ticks, by_tick, score)
    assert len(rounds) == 3
    assert rounds[2] == {"round_number": 3, "winner_team": "A", "win_reason": "", "side_a": None}


def test_construir_rounds_round_decisivo_faltando_vitoria_do_time_b():
    end_ticks = [100]
    by_tick = {100: {"A": 1, "B": 0}}
    score = {"A": 1, "B": 1}  # B fechou o placar no round que falta
    rounds = parse._construir_rounds(end_ticks, by_tick, score)
    assert len(rounds) == 2
    assert rounds[1] == {"round_number": 2, "winner_team": "B", "win_reason": "", "side_a": None}


def test_construir_rounds_sem_nenhum_round_officially_ended_mas_com_placar():
    # Caso extremo: nenhum evento de fim de round chegou a disparar (demo muito curta/
    # truncada), mas o placar final existe — ainda completa 1 round sintético.
    rounds = parse._construir_rounds([], {}, {"A": 1, "B": 0})
    assert rounds == [{"round_number": 1, "winner_team": "A", "win_reason": "", "side_a": None}]


def test_construir_rounds_sem_placar_nenhum_nao_adiciona_nada():
    rounds = parse._construir_rounds([], {}, {"A": 0, "B": 0})
    assert rounds == []


# ---- side_a: lado (CT/T) do time fixo A por round (FIL-51) ----

def test_construir_rounds_anexa_side_a_de_lado_por_round():
    end_ticks = [100, 200]
    by_tick = {100: {"A": 1, "B": 0}, 200: {"A": 1, "B": 1}}
    score = {"A": 1, "B": 1}
    lado_por_round = {1: "CT", 2: "T"}
    rounds = parse._construir_rounds(end_ticks, by_tick, score, lado_por_round=lado_por_round)
    assert [r["side_a"] for r in rounds] == ["CT", "T"]


def test_construir_rounds_sem_lado_conhecido_devolve_side_a_none():
    rounds = parse._construir_rounds([100], {100: {"A": 1, "B": 0}}, {"A": 1, "B": 0})
    assert rounds[0]["side_a"] is None


# ---- _detectar_abandono (partida 44a32a9e/de_mirage 4x1, 2026-07-21) ----

def test_detectar_abandono_placar_normal_nao_e_abandono():
    # Um time bateu 13 -> terminou pelo formato normal (MR12), mesmo tendo disconnect
    # registrado (jogador que saiu e voltou, ou saiu só depois do resultado decidido).
    score = {"A": 13, "B": 7}
    end_ticks = [100, 200]
    disconnects = [{"steam_id64": "1", "tick": 50}]
    ended_early, abandoned_by = parse._detectar_abandono(score, end_ticks, disconnects, [])
    assert (ended_early, abandoned_by) == (False, None)


def test_detectar_abandono_placar_abaixo_de_13_dos_dois_lados_e_abandono():
    score = {"A": 1, "B": 4}
    ended_early, _ = parse._detectar_abandono(score, [100], [], [])
    assert ended_early is True


def test_detectar_abandono_atribui_unico_candidato_sem_atividade_depois():
    score = {"A": 1, "B": 4}
    end_ticks = [100, 200, 300, 400]  # último round_officially_ended real
    disconnects = [{"steam_id64": "krn", "tick": 150}]  # antes do último tick real, sem volta
    kills = [{"tick": 120, "attacker": "krn", "victim": "outro"}]  # só ANTES do disconnect
    ended_early, abandoned_by = parse._detectar_abandono(score, end_ticks, disconnects, kills)
    assert ended_early is True
    assert abandoned_by == "krn"


def test_detectar_abandono_nao_atribui_quando_tem_atividade_depois_do_disconnect():
    # Reconectou e voltou a jogar (kill depois do disconnect) -> não é o abandonador.
    score = {"A": 1, "B": 4}
    end_ticks = [100, 200, 300, 400]
    disconnects = [{"steam_id64": "krn", "tick": 150}]
    kills = [{"tick": 250, "attacker": "krn", "victim": "outro"}]
    ended_early, abandoned_by = parse._detectar_abandono(score, end_ticks, disconnects, kills)
    assert (ended_early, abandoned_by) == (True, None)


def test_detectar_abandono_ignora_disconnect_da_debandada_final_pos_ultimo_round_real():
    # Disconnect DEPOIS do último round_officially_ended real é a debandada normal de
    # fim de partida (todo mundo sai do servidor) -- não conta como candidato.
    score = {"A": 1, "B": 4}
    end_ticks = [100, 200, 300, 400]
    disconnects = [{"steam_id64": "jogador", "tick": 450}]
    ended_early, abandoned_by = parse._detectar_abandono(score, end_ticks, disconnects, [])
    assert (ended_early, abandoned_by) == (True, None)


def test_detectar_abandono_dois_candidatos_ambiguo_nao_atribui():
    score = {"A": 1, "B": 4}
    end_ticks = [100, 200, 300, 400]
    disconnects = [{"steam_id64": "a", "tick": 150}, {"steam_id64": "b", "tick": 160}]
    ended_early, abandoned_by = parse._detectar_abandono(score, end_ticks, disconnects, [])
    assert (ended_early, abandoned_by) == (True, None)


def test_detectar_abandono_sem_end_ticks_nao_atribui():
    score = {"A": 1, "B": 4}
    ended_early, abandoned_by = parse._detectar_abandono(score, [], [{"steam_id64": "a", "tick": 10}], [])
    assert (ended_early, abandoned_by) == (True, None)


def test_nomes_de_time_extrai_dos_dois_lados():
    fixed = {"1": "A", "2": "A", "3": "B", "4": "B"}
    registros = [
        {"steamid": 1, "team_clan_name": "FaZe"},
        {"steamid": 2, "team_clan_name": "FaZe"},
        {"steamid": 3, "team_clan_name": "Vitality"},
        {"steamid": 4, "team_clan_name": "Vitality"},
    ]
    nome_a, nome_b = parse._nomes_de_time(registros, fixed)
    assert nome_a == "FaZe"
    assert nome_b == "Vitality"


def test_nomes_de_time_ausente_ou_vazio_vira_none():
    fixed = {"1": "A"}
    assert parse._nomes_de_time([{"steamid": 1, "team_clan_name": ""}], fixed) == (None, None)
    assert parse._nomes_de_time([], fixed) == (None, None)


def test_nomes_de_time_nan_do_pandas_nao_quebra():
    # Bug real (2026-07-24, partida do Jubileu, share_code CSGO-... com erro "'float'
    # object has no attribute 'strip'"): quando a demo não traz clã, o parser às vezes
    # devolve NaN (float) em vez de None/"" pra team_clan_name — NaN é "truthy" em Python
    # (bool(float('nan')) é True), então o antigo `r.get(...) or ""` não pegava esse caso
    # e `.strip()` estourava. Mesmo padrão de NaN que `_sid`/`_num` já tratam, só faltava
    # aqui.
    import pandas as pd

    fixed = {"1": "A", "2": "B"}
    registros = [
        {"steamid": 1, "team_clan_name": float("nan")},
        {"steamid": 2, "team_clan_name": pd.NA},
    ]
    assert parse._nomes_de_time(registros, fixed) == (None, None)


def test_casa_arremesso_mais_proximo_do_mesmo_jogador():
    # Confirmado empírico (demo real, 2026-07-13): weapon_fire NÃO tem entityid — a
    # correlação é por (thrower, weapon_fire mais próximo e anterior ao detonate),
    # nunca por entityid. Delta de tick observado: 15-473 (smoke), 41-143 (molotov/inc),
    # 0-118 (flash), 109-118 (HE) — janela de 200 (sugestão original do plano) já teria
    # perdido 21/109 smokes; usamos 600 de folga.
    fires = [
        {"tick": 1000, "thrower": "A", "weapon": "smokegrenade"},
        {"tick": 1500, "thrower": "B", "weapon": "smokegrenade"},
    ]
    detonates = [
        {"tick": 1130, "thrower": "A"},  # ~130 ticks depois do fire de A (voo da granada)
        {"tick": 1620, "thrower": "B"},
    ]
    casados = parse._casar_arremesso_com_detonacao(fires, detonates)
    assert casados[(1130, "A")] == 1000
    assert casados[(1620, "B")] == 1500


def test_casa_pelo_fire_mais_recente_quando_ha_varios_do_mesmo_jogador():
    # Jogador dá fire duas vezes antes do detonate mais antigo "expirar" da lista — o
    # casamento deve pegar o MAIS RECENTE fire anterior ao detonate, não o primeiro.
    fires = [
        {"tick": 1000, "thrower": "A", "weapon": "hegrenade"},
        {"tick": 1050, "thrower": "A", "weapon": "hegrenade"},
    ]
    detonates = [{"tick": 1160, "thrower": "A"}]
    casados = parse._casar_arremesso_com_detonacao(fires, detonates)
    assert casados[(1160, "A")] == 1050


def test_fire_fora_da_janela_fica_de_fora():
    fires = [{"tick": 1000, "thrower": "A", "weapon": "smokegrenade"}]
    detonates = [{"tick": 1000 + 601, "thrower": "A"}]  # além da janela padrão (600)
    assert parse._casar_arremesso_com_detonacao(fires, detonates) == {}


def test_sem_fire_correspondente_fica_de_fora():
    detonates = [{"tick": 1130, "thrower": "A"}]
    assert parse._casar_arremesso_com_detonacao([], detonates) == {}


def test_casar_fim_de_granada_usa_evento_de_expiracao_quando_casavel():
    # Caso normal: início e fim do MESMO entityid, duração dentro do teto oficial
    # (18s = 1152 ticks pra smoke) -> usa o tick real do evento de expiração.
    inicios = [{"tick": 1000, "entityid": 42}]
    fins = [{"tick": 1000 + 1100, "entityid": 42}]  # ~17.2s, plausível pra smoke
    cap_ticks = round(18 * 64)
    folga_ticks = round(2 * 64)
    assert parse._casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks) == [1000 + 1100]


def test_casar_fim_de_granada_sem_evento_de_fim_usa_teto_oficial():
    # Sem expired/expire casável pro entityid -> cap na duração oficial do CS2, nunca
    # no fim do round.
    inicios = [{"tick": 5000, "entityid": 7}]
    fins = []
    cap_ticks = round(18 * 64)
    folga_ticks = round(2 * 64)
    assert parse._casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks) == [5000 + cap_ticks]


def test_casar_fim_de_granada_duracao_absurda_cai_no_teto():
    # Bug real (achado pelo usuário via print, 2026-07-14): entityid reciclado ao longo
    # da demo casava com o evento de expiração de OUTRA granada (de outro round,
    # muito mais tarde), gerando um tickEnd absurdo (67.9s vistos no Replay 2D pra uma
    # smoke que dura ~18s). Duração > cap + folga -> descarta o casado e usa o teto.
    inicios = [{"tick": 1000, "entityid": 42}]
    fins = [{"tick": 1000 + 4346, "entityid": 42}]  # ~67.9s — entityid reciclado de outro round
    cap_ticks = round(18 * 64)
    folga_ticks = round(2 * 64)
    assert parse._casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks) == [1000 + cap_ticks]


def test_casar_fim_de_granada_ignora_fim_anterior_ao_inicio_e_pega_o_proximo():
    # entityid reciclado: existe um fim ANTES do início (de uma granada anterior que já
    # usou esse mesmo id) e o fim de verdade depois — deve pegar o de depois, nunca o
    # de antes (senão duração negativa).
    inicios = [{"tick": 2000, "entityid": 9}]
    fins = [
        {"tick": 1500, "entityid": 9},  # fim de uma granada anterior (mesmo id reciclado)
        {"tick": 2000 + 1000, "entityid": 9},  # fim de verdade desta granada
    ]
    cap_ticks = round(18 * 64)
    folga_ticks = round(2 * 64)
    assert parse._casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks) == [2000 + 1000]


def test_casar_fim_de_granada_entityid_diferente_nao_casa():
    inicios = [{"tick": 1000, "entityid": 1}]
    fins = [{"tick": 1500, "entityid": 2}]  # outro entityid -> não casa
    cap_ticks = round(7 * 64)
    folga_ticks = round(2 * 64)
    assert parse._casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks) == [1000 + cap_ticks]


def test_casar_fim_de_granada_preserva_ordem_e_multiplas_granadas():
    inicios = [
        {"tick": 1000, "entityid": 1},
        {"tick": 1200, "entityid": 2},
    ]
    fins = [
        {"tick": 1200 + 400, "entityid": 2},
        {"tick": 1000 + 1150, "entityid": 1},
    ]
    cap_ticks = round(18 * 64)
    folga_ticks = round(2 * 64)
    saida = parse._casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks)
    assert saida == [1000 + 1150, 1200 + 400]


def test_lado_de_team_num_converte_2_e_3_e_devolve_none_pro_resto():
    # Convenção CS2 (valve_demo_2): team_num 2=T, 3=CT — usada no snapshot batched de
    # weapon_fire (snap_fire) pra gravar o lado real do arremessador em `lineups.lado`.
    assert parse._lado_de_team_num(2) == "T"
    assert parse._lado_de_team_num(3) == "CT"
    assert parse._lado_de_team_num(1) is None  # espectador
    assert parse._lado_de_team_num(None) is None  # sem correlação/desconectado


def test_txt_converte_nan_e_none_em_none_e_o_resto_em_str():
    # Bug real achado pelo usuário: active_weapon_name do pandas vem NaN (float, não
    # None) quando o jogador não tinha arma equipada naquele tick exato — sem essa
    # conversão, o NaN vazava pra victim_weapon gravado no banco (coluna text) e
    # aparecia literalmente como "segurando: NaN" no modal de detalhe por round.
    assert parse._txt(float("nan")) is None
    assert parse._txt(None) is None
    assert parse._txt("ak47") == "ak47"


def test_premier_ratings_escolhe_previsao_certa_pelo_placar_e_ignora_quem_nao_tem_rank():
    # time A venceu (13x5): quem é do time A usa rank_if_win, quem é do time B usa
    # rank_if_loss. "3" não tem campo "rank" (None) — Partida Pro/Wingman/Competitivo
    # por mapa não têm Premier, então some do resultado em vez de aparecer com lixo.
    rows = [
        {"steamid": "1", "rank": 5200, "rank_if_win": 5242, "rank_if_loss": 5150, "rank_if_tie": 5200},
        {"steamid": "2", "rank": 8100, "rank_if_win": 8151, "rank_if_loss": 8040, "rank_if_tie": 8100},
        {"steamid": "3", "rank": float("nan"), "rank_if_win": float("nan"), "rank_if_loss": float("nan"), "rank_if_tie": float("nan")},
    ]
    fixed = {"1": "A", "2": "B", "3": "A"}
    score = {"A": 13, "B": 5}
    resultado = parse._premier_ratings(rows, fixed, score)
    assert resultado == {
        "1": {"before": 5200, "after": 5242},  # time A, venceu -> rank_if_win
        "2": {"before": 8100, "after": 8040},  # time B, perdeu -> rank_if_loss
    }
    assert "3" not in resultado


def test_premier_ratings_empate_usa_rank_if_tie():
    rows = [{"steamid": "1", "rank": 12000, "rank_if_win": 12050, "rank_if_loss": 11940, "rank_if_tie": 12000}]
    fixed = {"1": "A"}
    score = {"A": 12, "B": 12}
    resultado = parse._premier_ratings(rows, fixed, score)
    assert resultado == {"1": {"before": 12000, "after": 12000}}


# ---- fundir_partes_mesmo_mapa (reinício técnico: 1 mapa vira 2+ .dem) ----


def _jogador(sid, team, **over):
    base = {
        "steam_id64": sid, "nick": f"p{sid}", "team": team,
        "kills": 0, "deaths": 0, "assists": 0, "headshot_kills": 0, "damage": 0,
        "utility_damage": 0, "shots_fired": 0, "shots_hit": 0,
        "he_damage": 0, "molotov_damage": 0, "he_team_damage": 0, "molotov_team_damage": 0,
        "flash_assists": 0, "enemy_flash_landed_count": 0, "enemy_flash_landed_duration_sum": 0.0,
        "smokes_thrown": 0, "flashes_thrown": 0, "he_thrown": 0, "molotovs_thrown": 0,
        "enemies_flashed": 0, "teammates_flashed": 0,
        "enemy_flash_duration": 0.0, "teammate_flash_duration": 0.0,
        "weapons": {},
    }
    base.update(over)
    return base


def _parte_base(**over):
    base = {
        "map": "de_anubis", "score_a": 0, "score_b": 0,
        "team_a_name": None, "team_b_name": None, "played_at": "2026-07-13T00:00:00+00:00",
        "rounds": [], "players": [], "kills": [], "round_econ": [], "kill_positions": [],
    }
    base.update(over)
    return base


def test_fundir_partes_mesmo_mapa_grupo_de_1_devolve_a_propria_parte_sem_tocar():
    parte = _parte_base(rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}])
    fundido, rdata = parse.fundir_partes_mesmo_mapa([parte], [{"ticks": []}])
    assert fundido is parte
    assert rdata == {"ticks": []}


def test_fundir_partes_mesmo_mapa_concatena_rounds_com_offset_recalcula_placar_e_soma_stats():
    parte1 = _parte_base(
        team_a_name="FaZe", team_b_name="Vitality",
        rounds=[
            {"round_number": 1, "winner_team": "A", "win_reason": ""},
            {"round_number": 2, "winner_team": "B", "win_reason": ""},
        ],
        players=[
            _jogador("1", "A", kills=5, deaths=3, damage=300,
                     weapons={"ak47": {"kills": 3, "hs_kills": 1, "shots_fired": 10, "shots_hit": 5, "damage": 150}}),
            _jogador("2", "B", kills=2, deaths=4, damage=200),
        ],
        kills=[{"round_number": 1, "tick": 100, "attacker": "1", "victim": "2",
                "headshot": False, "team_kill": False, "weapon": "ak47"}],
        round_econ=[{"round_number": 1, "team": "A", "equip_value": 4000, "buy_type": "eco"}],
        kill_positions=[{"round_number": 1, "tick": 100, "killer": "1", "victim": "2", "weapon": "ak47",
                          "headshot": False, "killer_x": 1.0, "killer_y": 1.0, "victim_x": 2.0, "victim_y": 2.0}],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[
            _jogador("1", "A", kills=2, deaths=1, damage=100,
                     weapons={"ak47": {"kills": 1, "hs_kills": 0, "shots_fired": 5, "shots_hit": 2, "damage": 50}}),
            _jogador("2", "B", kills=1, deaths=2, damage=80),
        ],
        kills=[{"round_number": 1, "tick": 50, "attacker": "1", "victim": "2",
                "headshot": True, "team_kill": False, "weapon": "ak47"}],
        round_econ=[{"round_number": 1, "team": "B", "equip_value": 9000, "buy_type": "forcado"}],
        kill_positions=[{"round_number": 1, "tick": 50, "killer": "1", "victim": "2", "weapon": "ak47",
                          "headshot": True, "killer_x": 3.0, "killer_y": 3.0, "victim_x": 4.0, "victim_y": 4.0}],
    )

    fundido, rdata = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    assert rdata is None
    assert [r["round_number"] for r in fundido["rounds"]] == [1, 2, 3]
    assert [r["winner_team"] for r in fundido["rounds"]] == ["A", "B", "A"]
    # placar recalculado a partir do rounds JÁ FUNDIDO (não herdado de score_a/b crus)
    assert fundido["score_a"] == 2 and fundido["score_b"] == 1

    kill_da_parte2 = next(k for k in fundido["kills"] if k["tick"] == 50)
    assert kill_da_parte2["round_number"] == 3  # offset de 2 rounds (parte1 teve 2)
    econ_da_parte2 = next(e for e in fundido["round_econ"] if e["equip_value"] == 9000)
    assert econ_da_parte2["round_number"] == 3
    pos_da_parte2 = next(p for p in fundido["kill_positions"] if p["tick"] == 50)
    assert pos_da_parte2["round_number"] == 3

    jogador1 = next(p for p in fundido["players"] if p["steam_id64"] == "1")
    assert jogador1["kills"] == 7 and jogador1["deaths"] == 4 and jogador1["damage"] == 400
    assert jogador1["weapons"]["ak47"] == {"kills": 4, "hs_kills": 1, "shots_fired": 15, "shots_hit": 7, "damage": 200}

    assert fundido["team_a_name"] == "FaZe" and fundido["team_b_name"] == "Vitality"


def test_fundir_partes_mesmo_mapa_soma_offset_em_econ_por_jogador_e_compras():
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
        player_round_econ=[{"round_number": 1, "steam_id64": "1", "team": "A", "equip_value": 4000, "buy_type": "eco"}],
        purchases=[{"round_number": 1, "steam_id64": "1", "item": "glock", "tick": 100}],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
        player_round_econ=[{"round_number": 1, "steam_id64": "1", "team": "A", "equip_value": 9000, "buy_type": "forcado"}],
        purchases=[{"round_number": 1, "steam_id64": "1", "item": "deagle", "tick": 50}],
    )

    fundido, _ = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    econ_da_parte2 = next(e for e in fundido["player_round_econ"] if e["equip_value"] == 9000)
    assert econ_da_parte2["round_number"] == 2  # offset de 1 round (parte1 teve 1)
    compra_da_parte2 = next(c for c in fundido["purchases"] if c["item"] == "deagle")
    assert compra_da_parte2["round_number"] == 2


def test_fundir_partes_mesmo_mapa_descarta_compras_da_parte_antiga_quando_restart_recompra_no_mesmo_round():
    # Reinicio tecnico no meio da fase de compra: parte1 so tem 1 round COMPLETO na
    # lista "rounds" (o round 2 nunca resolveu, entao nao entra ali, mas o jogador ja
    # tinha comprado antes do corte) e parte2 recomeca o mesmo round do zero, com o
    # jogador recomprando tudo. Apos o offset (parte2 desloca +1, ja que parte1 teve
    # 1 round completo), as duas listas de compra caem no MESMO round_number+steam_id64
    # - so a mais recente (parte2) deve sobreviver, igual ja acontece pra
    # player_round_econ (commit 92a3a25).
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
        purchases=[
            {"round_number": 2, "steam_id64": "1", "item": "ak47", "cost": 2700, "tick": 500},
            {"round_number": 2, "steam_id64": "1", "item": "flashbang", "cost": 200, "tick": 505},
        ],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "B", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
        purchases=[
            {"round_number": 1, "steam_id64": "1", "item": "m4a1_silencer", "cost": 3100, "tick": 50},
            {"round_number": 1, "steam_id64": "1", "item": "flashbang", "cost": 200, "tick": 55},
        ],
    )

    fundido, _ = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    compras_round2_jogador1 = [c for c in fundido["purchases"] if c["round_number"] == 2 and c["steam_id64"] == "1"]
    assert sorted(c["item"] for c in compras_round2_jogador1) == ["flashbang", "m4a1_silencer"]


def test_filtrar_ecos_de_compra_limita_flashbang_a_2_e_resto_a_1_por_item():
    # demoparser2 sintetiza item_purchase a partir da CRIACAO da entidade de arma - pra
    # granadas/consumiveis, a entidade e recriada quando o jogador reequipa da reserva,
    # gerando uma 2a/3a "compra" fantasma do MESMO item/round/jogador num tick bem mais
    # tarde (github.com/LaihoE/demoparser/issues/214). O CS2 limita quantas unidades de
    # cada item da pra comprar por round (2 flashbang, 1 do resto) - mantem so as N
    # ocorrencias de tick mais cedo, o resto e eco de reequipar.
    purchases = [
        {"round_number": 1, "steam_id64": "1", "item": "Flashbang", "cost": 200, "tick": 100},
        {"round_number": 1, "steam_id64": "1", "item": "Flashbang", "cost": 200, "tick": 105},
        {"round_number": 1, "steam_id64": "1", "item": "Flashbang", "cost": 200, "tick": 4000},
        {"round_number": 1, "steam_id64": "1", "item": "Flashbang", "cost": 200, "tick": 8000},
        {"round_number": 1, "steam_id64": "1", "item": "High Explosive Grenade", "cost": 300, "tick": 110},
        {"round_number": 1, "steam_id64": "1", "item": "High Explosive Grenade", "cost": 300, "tick": 5000},
    ]

    limpas = parse._filtrar_ecos_de_compra(purchases)

    flashbangs = sorted(c["tick"] for c in limpas if c["item"] == "Flashbang")
    hes = [c["tick"] for c in limpas if c["item"] == "High Explosive Grenade"]
    assert flashbangs == [100, 105]
    assert hes == [110]


def test_filtrar_ecos_de_compra_nao_mexe_em_itens_de_jogadores_ou_rounds_diferentes():
    purchases = [
        {"round_number": 1, "steam_id64": "1", "item": "AK-47", "cost": 2700, "tick": 100},
        {"round_number": 1, "steam_id64": "2", "item": "AK-47", "cost": 2700, "tick": 100},
        {"round_number": 2, "steam_id64": "1", "item": "AK-47", "cost": 2700, "tick": 5000},
    ]

    limpas = parse._filtrar_ecos_de_compra(purchases)

    assert len(limpas) == 3


def test_fundir_partes_mesmo_mapa_soma_dano_e_flashes_por_par_entre_partes():
    # player_damage/player_flashes não têm round_number nem letra de time — quando o
    # MESMO par (atacante, vítima, arma) aparece nas duas partes (o duelo se repetiu),
    # soma os totais em vez de duplicar a linha.
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
        player_damage=[{"attacker": "1", "victim": "2", "weapon": "ak47", "damage": 100, "hits": 1}],
        player_flashes=[{"attacker": "1", "victim": "2", "count": 1, "duration_sum": 1.5}],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
        player_damage=[{"attacker": "1", "victim": "2", "weapon": "ak47", "damage": 50, "hits": 1}],
        player_flashes=[{"attacker": "1", "victim": "2", "count": 1, "duration_sum": 2.0}],
    )

    fundido, _ = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    assert fundido["player_damage"] == [{"attacker": "1", "victim": "2", "weapon": "ak47", "damage": 150, "hits": 2}]
    assert fundido["player_flashes"] == [{"attacker": "1", "victim": "2", "count": 2, "duration_sum": 3.5}]


def test_fundir_partes_mesmo_mapa_inverte_letra_em_econ_por_jogador():
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "B", "win_reason": ""}],
        players=[_jogador("1", "B", kills=3), _jogador("2", "A", kills=1)],
        player_round_econ=[{"round_number": 1, "steam_id64": "1", "team": "B", "equip_value": 9000, "buy_type": "forcado"}],
    )

    fundido, _ = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    econ_jogador1 = next(e for e in fundido["player_round_econ"] if e["steam_id64"] == "1")
    assert econ_jogador1["team"] == "A"  # jogador "1" é canonicamente A; letra crua "B" da parte2 corrigida


def test_fundir_partes_mesmo_mapa_detecta_e_corrige_letra_ab_invertida_na_parte_2():
    # Parte 1: jogador "1" é A, "2" é B. Parte 2: parse_demo (arquivo diferente)
    # atribuiu a letra oposta pros MESMOS dois jogadores — bug mais fácil de escorregar
    # se não corrigido: fundiria o placar/stats do jogador errado com o time errado.
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A", kills=1), _jogador("2", "B", kills=0)],
    )
    parte2 = _parte_base(
        team_a_name="Vitality", team_b_name="FaZe",  # também invertido nessa parte
        rounds=[{"round_number": 1, "winner_team": "B", "win_reason": ""}],  # "B" na letra CRUA da parte2 == time do jogador "1"
        players=[_jogador("1", "B", kills=3), _jogador("2", "A", kills=1)],
    )

    fundido, _ = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    jogador1 = next(p for p in fundido["players"] if p["steam_id64"] == "1")
    jogador2 = next(p for p in fundido["players"] if p["steam_id64"] == "2")
    assert jogador1["team"] == "A" and jogador1["kills"] == 4  # 1 + 3, letra corrigida antes de somar
    assert jogador2["team"] == "B" and jogador2["kills"] == 1

    # round 2 (da parte2) tinha winner_team="B" na letra crua da parte2, que corresponde
    # ao jogador "1" (canonicamente "A") — após a correção deve virar "A".
    assert fundido["rounds"][1]["winner_team"] == "A"
    # nomes de time da parte2 também precisam ser corrigidos junto com a letra invertida.
    assert fundido["team_a_name"] == "FaZe" and fundido["team_b_name"] == "Vitality"


def test_fundir_partes_mesmo_mapa_tres_partes_acumula_offset_na_terceira():
    partes = [
        _parte_base(rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
                    players=[_jogador("1", "A"), _jogador("2", "B")],
                    kills=[{"round_number": 1, "tick": 10, "attacker": "1", "victim": "2",
                            "headshot": False, "team_kill": False, "weapon": "ak47"}]),
        _parte_base(rounds=[{"round_number": 1, "winner_team": "B", "win_reason": ""}],
                    players=[_jogador("1", "A"), _jogador("2", "B")],
                    kills=[{"round_number": 1, "tick": 20, "attacker": "2", "victim": "1",
                            "headshot": False, "team_kill": False, "weapon": "ak47"}]),
        _parte_base(rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
                    players=[_jogador("1", "A"), _jogador("2", "B")],
                    kills=[{"round_number": 1, "tick": 30, "attacker": "1", "victim": "2",
                            "headshot": False, "team_kill": False, "weapon": "ak47"}]),
    ]

    fundido, _ = parse.fundir_partes_mesmo_mapa(partes)

    assert [r["round_number"] for r in fundido["rounds"]] == [1, 2, 3]
    assert [k["round_number"] for k in sorted(fundido["kills"], key=lambda k: k["tick"])] == [1, 2, 3]
    assert fundido["score_a"] == 2 and fundido["score_b"] == 1


def test_fundir_partes_mesmo_mapa_premier_rating_before_e_after_nao_somam():
    # premier_rating_before/after são leituras pontuais (snapshot), não contadores —
    # restart técnico funde partes do MESMO Premier real: "before" tem que ficar o
    # mais antigo (estado antes de tudo começar, da parte1) e "after" o mais recente
    # (resultado real final, da parte2). Nunca soma (5200 + 5150 = 10350 não faz sentido).
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[
            _jogador("1", "A", premier_rating_before=5200, premier_rating_after=5250),
            _jogador("2", "B", premier_rating_before=4800, premier_rating_after=None),
        ],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[
            _jogador("1", "A", premier_rating_before=5250, premier_rating_after=5150),
            _jogador("2", "B", premier_rating_before=None, premier_rating_after=4900),
        ],
    )

    fundido, _ = parse.fundir_partes_mesmo_mapa([parte1, parte2])

    jogador1 = next(p for p in fundido["players"] if p["steam_id64"] == "1")
    jogador2 = next(p for p in fundido["players"] if p["steam_id64"] == "2")
    # jogador1: ambas as partes têm valor -> before fica o da parte1, after o da parte2
    assert jogador1["premier_rating_before"] == 5200
    assert jogador1["premier_rating_after"] == 5150
    # jogador2: só uma parte tem valor de cada campo -> preservado, não somado nem perdido
    assert jogador2["premier_rating_before"] == 4800
    assert jogador2["premier_rating_after"] == 4900


def test_fundir_partes_mesmo_mapa_funde_rdata_com_mesmo_offset_e_letra():
    parte1 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "A", "win_reason": ""}],
        players=[_jogador("1", "A"), _jogador("2", "B")],
    )
    parte2 = _parte_base(
        rounds=[{"round_number": 1, "winner_team": "B", "win_reason": ""}],
        players=[_jogador("1", "B"), _jogador("2", "A")],  # letra invertida na parte2
    )
    rdata1 = {
        "ticks": [{"round": 1, "tick": 100, "players": [{"id": "1", "team": "A"}, {"id": "2", "team": "B"}]}],
        "kills": [{"round": 1, "tick": 100, "killer": "1", "victim": "2", "weapon": "ak47", "headshot": False}],
        "hits": [], "smokes": [], "fires": [], "flashes": [], "hes": [], "blinds": [],
        "bombPickups": [], "bombDrops": [], "bombPlants": [],
    }
    rdata2 = {
        "ticks": [{"round": 1, "tick": 50, "players": [{"id": "1", "team": "B"}, {"id": "2", "team": "A"}]}],
        "kills": [{"round": 1, "tick": 50, "killer": "2", "victim": "1", "weapon": "ak47", "headshot": False}],
        "hits": [], "smokes": [], "fires": [], "flashes": [], "hes": [], "blinds": [],
        "bombPickups": [], "bombDrops": [], "bombPlants": [],
    }

    _, rdata_fundido = parse.fundir_partes_mesmo_mapa([parte1, parte2], [rdata1, rdata2])

    assert [t["round"] for t in rdata_fundido["ticks"]] == [1, 2]
    tick_da_parte2 = next(t for t in rdata_fundido["ticks"] if t["round"] == 2)
    assert tick_da_parte2["tick"] == 50  # tick CRU não é tocado, só o campo "round"
    jogador1_parte2 = next(p for p in tick_da_parte2["players"] if p["id"] == "1")
    assert jogador1_parte2["team"] == "A"  # letra corrigida (era "B" cru na parte2)

    assert [k["round"] for k in rdata_fundido["kills"]] == [1, 2]
