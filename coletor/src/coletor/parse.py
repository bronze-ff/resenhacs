"""Extração do .dem (demoparser2) → ParsedDemo (a IR que transform.py consome).

Validado contra um demo real de matchmaking (de_anubis). demoparser2 é nativo (Rust),
importado só aqui para os testes das transformações rodarem sem ele.

Descobertas da API (CS2 / valve_demo_2):
- round vem de `total_rounds_played` (0-based) passado em `other=`; não há evento round_end.
- dano = soma de `player_hurt.dmg_health` por atacante.
- assist = `player_death.assister_steamid`.
- placar = `team_rounds_total` (prop por jogador) lido no fim da partida.
- time fixo A/B: `team_num` no 1º `round_freeze_end` (2=TR→A, 3=CT→B); estável apesar
  da troca de lados no intervalo.
- warmup: filtra deaths por `is_warmup_period==False` e hurt por tick >= 1º freeze_end.
- played_at: o formato .dem NÃO guarda data/hora real em lugar nenhum (header, cvars,
  hltv_versioninfo — nada). Usamos a mtime do arquivo como proxy (é quando foi baixado,
  tipicamente minutos/horas após jogado — melhor disponível, mas aproximado).
"""

import datetime
import os


def _team_letter(team_number):
    return "A" if team_number == 2 else "B"


def _sid(v):
    import pandas as pd

    if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
        return None
    return str(int(v)) if isinstance(v, (int, float)) else str(v)


def _num(v):
    """int(v), ou None pra NaN/None — snapshots de tick podem trazer NaN pra jogadores
    desconectados naquele instante (visto em demo real; int(NaN) estoura ValueError)."""
    import pandas as pd

    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return int(v)


def _flt(v):
    """float(v), ou None pra NaN/None (mesmo caso do _num, pra posições/yaw/duração —
    NaN não pode vazar pro JSON do replay: JSON.parse no browser rejeita NaN)."""
    import pandas as pd

    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return float(v)


# Descoberta empírica (mesmo demo real): armas em weapon_fire vêm prefixadas "weapon_"
# (ex.: "weapon_ak47"); em player_hurt vêm sem prefixo (ex.: "ak47"). O dano de molotov/
# incendiary aparece com weapon="inferno" no player_hurt, não "molotov" — só se descobre
# isso rodando contra um .dem de verdade.
_NAO_ARMA_DE_FOGO = {
    "knife", "knife_css", "knife_t", "knife_kukri", "knife_ct",
    "hegrenade", "incgrenade", "molotov", "inferno", "flashbang", "smokegrenade", "decoy",
    "c4", "planted_c4", "taser",
}
_ARMAS_UTILITARIAS = {"hegrenade", "molotov", "inferno", "incgrenade"}

# Classificação de economia por time (soma dos 5 no fim do freezetime) — esquema
# HLTV/awpy ("Taken from hltv economy tab"), validado via pesquisa web (2026-07-11):
# eco < $5.000 | forçado $5.000-9.999 | semi-compra $10.000-19.999 | full >= $20.000.
def _tipo_de_compra(equip_value_time):
    if equip_value_time < 5000:
        return "eco"
    if equip_value_time < 10000:
        return "forcado"
    if equip_value_time < 20000:
        return "semi"
    return "full"


def _eh_arma_de_fogo(weapon):
    if not weapon:
        return False
    w = str(weapon).replace("weapon_", "")
    return w not in _NAO_ARMA_DE_FOGO and not w.startswith("knife")


# Descoberta empírica (mesmo demo real, 2026-07-11): player_hurt NÃO distingue essas
# 3 duplas de arma — os hits/dano de QUALQUER uma das duas vêm com o nome do lado
# direito, mesmo quando o kill (player_death, que distingue certinho) foi com a da
# esquerda. Sem esse alias, a arma "perdedora" do par ficava com kills>0 mas
# shots_hit=0/damage=0 (accuracy quebrada) e a outra ficava com hits sobrando sem
# kill nenhum. Rastreado round a round contra um duelo real pra confirmar (não é
# achismo): kill m4a1_silencer <- hurt correspondente chega como "m4a1"; kill
# usp_silencer <- hurt chega como "hkp2000"; kill revolver <- hurt chega como "deagle".
_ALIAS_ARMA_POR_HURT = {
    "m4a1_silencer": "m4a1",
    "usp_silencer": "hkp2000",
    "revolver": "deagle",
}


def _arma_limpa(weapon):
    """Nome canônico da arma (sem o prefixo 'weapon_' que só o weapon_fire traz, e com
    o alias de _ALIAS_ARMA_POR_HURT aplicado — ver o comentário acima). player_death/
    player_hurt já vêm sem prefixo; None quando não há arma."""
    if not weapon:
        return None
    limpo = str(weapon).replace("weapon_", "")
    return _ALIAS_ARMA_POR_HURT.get(limpo, limpo) or None


def parse_demo(path):
    import pandas as pd
    from demoparser2 import DemoParser

    parser = DemoParser(str(path))
    mapa = parser.parse_header().get("map_name")

    deaths = parser.parse_event("player_death", other=["total_rounds_played", "is_warmup_period"])
    deaths = deaths[deaths["is_warmup_period"] == False]  # noqa: E712

    freeze = parser.parse_event("round_freeze_end", other=["total_rounds_played"])
    first_freeze = int(freeze["tick"].min())

    hurt = parser.parse_event("player_hurt", other=["total_rounds_played", "weapon"])
    hurt = hurt[hurt["tick"] >= first_freeze]

    fogo = parser.parse_event("weapon_fire")
    fogo = fogo[fogo["tick"] >= first_freeze]

    win_panel = parser.parse_event("cs_win_panel_match")
    end_tick = (
        int(win_panel["tick"].iloc[0]) - 100 if len(win_panel) else int(deaths["tick"].max())
    )

    # Times fixos A/B pelo primeiro freeze_end.
    snap0 = parser.parse_ticks(["team_num"], ticks=[first_freeze])
    fixed = {}
    for r in snap0.to_dict("records"):
        team_num = _num(r.get("team_num"))
        sid = _sid(r.get("steamid"))
        if sid and team_num is not None:
            fixed[sid] = _team_letter(team_num)

    # Economia por round×time: soma do equipamento dos 5 jogadores no fim do freezetime
    # (current_equip_value), classificada no esquema HLTV (_tipo_de_compra). Best-effort:
    # se o nome de campo não bater numa versão do demoparser2, cai pra lista vazia em
    # vez de derrubar o ingest inteiro (mesmo padrão de player_blind acima).
    round_econ = []
    try:
        tick_to_round = {int(t): int(rn) + 1 for t, rn in zip(freeze["tick"], freeze["total_rounds_played"])}
        econ_df = parser.parse_ticks(["current_equip_value"], ticks=sorted(tick_to_round.keys()))
        soma = {}  # (round_number, team) -> equip_value somado
        for r in econ_df.to_dict("records"):
            sid = _sid(r.get("steamid"))
            time = fixed.get(sid)
            equip = _num(r.get("current_equip_value"))
            rn = tick_to_round.get(int(r["tick"]))
            if not time or equip is None or rn is None:
                continue
            soma[(rn, time)] = soma.get((rn, time), 0) + equip
        round_econ = [
            {"round_number": rn, "team": time, "equip_value": equip, "buy_type": _tipo_de_compra(equip)}
            for (rn, time), equip in soma.items()
        ]
    except Exception:  # noqa: BLE001
        pass

    # Placar final: team_rounds_total de cada time no fim.
    snapf = parser.parse_ticks(["team_num", "team_rounds_total"], ticks=[end_tick])
    score = {"A": 0, "B": 0}
    for r in snapf.to_dict("records"):
        ft = fixed.get(_sid(r.get("steamid")))
        total = _num(r.get("team_rounds_total"))
        if ft and total is not None:
            score[ft] = total

    # Stats por arma (kills/hs/shots/dano), por jogador — agregação multi-partida no
    # servidor é sempre SUM por weapon, nunca média de %. weapon_slot() cria a entrada
    # sob demanda; os 3 loops abaixo (kills, hurt, fogo) só incrementam os campos que
    # cada evento sabe informar.
    weapons = {}

    def weapon_slot(sid, arma):
        por_jogador = weapons.setdefault(sid, {})
        return por_jogador.setdefault(arma, {"kills": 0, "hs_kills": 0, "shots_fired": 0, "shots_hit": 0, "damage": 0})

    # Kills (para K/D via transform e highlights) + nomes + assists.
    # team_kill: mesmo time do atacante e da vítima — não deve contar como kill
    # de verdade (nem pra rating, nem pra highlight de multikill), só como morte.
    kills, names, assists = [], {}, {}
    for r in deaths.to_dict("records"):
        atk, vic, ast = _sid(r.get("attacker_steamid")), _sid(r.get("user_steamid")), _sid(r.get("assister_steamid"))
        headshot = bool(r["headshot"])
        team_kill = bool(atk and vic and atk != vic and fixed.get(atk) == fixed.get(vic))
        kills.append(
            {
                "round_number": int(r["total_rounds_played"]) + 1,
                "tick": int(r["tick"]),
                "attacker": atk,
                "victim": vic,
                "headshot": headshot,
                "team_kill": team_kill,
                "weapon": _arma_limpa(r.get("weapon")) or "",
            }
        )
        if atk:
            names[atk] = r.get("attacker_name") or ""
        if vic:
            names[vic] = r.get("user_name") or ""
        if ast:
            assists[ast] = assists.get(ast, 0) + 1
        arma_kill = _arma_limpa(r.get("weapon"))
        if atk and atk != vic and not team_kill and arma_kill:
            slot = weapon_slot(atk, arma_kill)
            slot["kills"] += 1
            if headshot:
                slot["hs_kills"] += 1

    # Posições de kill: o evento player_death NÃO carrega X/Y direto (demoparser2 ignora
    # nomes de prop desconhecidos em vez de dar erro — descoberto empiricamente). A
    # posição vem de um snapshot de tick nos mesmos ticks das mortes (mesmo método já
    # usado e validado em extract_replay), casando por (steamid, tick).
    kill_positions = []
    try:
        death_ticks = sorted({int(k["tick"]) for k in kills})
        if death_ticks:
            pos_df = parser.parse_ticks(["X", "Y"], ticks=death_ticks)
            pos_by_sid_tick = {}
            for r in pos_df.to_dict("records"):
                sid = _sid(r.get("steamid"))
                x, y = _flt(r.get("X")), _flt(r.get("Y"))
                if sid and x is not None and y is not None:
                    pos_by_sid_tick[(sid, int(r["tick"]))] = (x, y)
            for k in kills:
                if k["team_kill"]:
                    continue
                vic_pos = pos_by_sid_tick.get((k["victim"], k["tick"]))
                if not vic_pos:
                    continue  # sem posição da vítima (fora do range de ticks amostrados) — descarta
                atk_pos = pos_by_sid_tick.get((k["attacker"], k["tick"])) if k["attacker"] else None
                kill_positions.append(
                    {
                        "round_number": k["round_number"],
                        "tick": k["tick"],
                        "killer": k["attacker"],
                        "victim": k["victim"],
                        "weapon": k["weapon"],
                        "headshot": k["headshot"],
                        "killer_x": atk_pos[0] if atk_pos else None,
                        "killer_y": atk_pos[1] if atk_pos else None,
                        "victim_x": vic_pos[0],
                        "victim_y": vic_pos[1],
                    }
                )
    except Exception:  # noqa: BLE001
        pass

    # Dano por atacante, separando bala de utilitária (granada/molotov — "inferno" no
    # weapon é o dano de queimadura do molotov/incendiary, descoberto empiricamente).
    # he_damage/molotov_damage: SÓ dano em INIMIGO (comparação com o Leetify, 2026-07-11,
    # mostrou que eles separam "Avg HE damage" de "Avg HE team damage" — dano em time
    # (fogo amigo) vai pros campos _team_damage à parte; sem essa separação um jogador
    # que só acerta granada no próprio time parecia "bom com HE" igual quem acerta
    # inimigo). utility_damage continua sendo a soma de TUDO (inimigo + time), pro
    # stat tile antigo "Dano utilitária" não mudar de significado.
    damage, utility_damage, shots_hit = {}, {}, {}
    he_damage, molotov_damage = {}, {}
    he_team_damage, molotov_team_damage = {}, {}
    for r in hurt.to_dict("records"):
        atk = _sid(r.get("attacker_steamid"))
        if not atk:
            continue
        dmg = int(r["dmg_health"])
        damage[atk] = damage.get(atk, 0) + dmg
        arma = r.get("weapon")
        if arma in _ARMAS_UTILITARIAS:
            utility_damage[atk] = utility_damage.get(atk, 0) + dmg
            vic = _sid(r.get("user_steamid"))
            time_kill = bool(vic and fixed.get(atk) == fixed.get(vic))
            if arma == "hegrenade":
                if time_kill:
                    he_team_damage[atk] = he_team_damage.get(atk, 0) + dmg
                else:
                    he_damage[atk] = he_damage.get(atk, 0) + dmg
            elif arma == "inferno":
                if time_kill:
                    molotov_team_damage[atk] = molotov_team_damage.get(atk, 0) + dmg
                else:
                    molotov_damage[atk] = molotov_damage.get(atk, 0) + dmg
        elif _eh_arma_de_fogo(arma):
            shots_hit[atk] = shots_hit.get(atk, 0) + 1
            slot = weapon_slot(atk, _arma_limpa(arma))
            slot["shots_hit"] += 1
            slot["damage"] += dmg

    # Tiros disparados (só armas de fogo — exclui faca e granadas) → precisão.
    # Granadas lançadas por tipo: mesmo evento (weapon_fire), filtrando o outro lado
    # (armas de utilitária) — é a fonte mais confiável de "quem jogou o quê" (o evento
    # de detonar nem sempre carrega o lançador; o de disparar sempre carrega).
    shots_fired = {}
    smokes_thrown, flashes_thrown, he_thrown, molotovs_thrown = {}, {}, {}, {}
    _CONTADOR_POR_ARMA = {
        "smokegrenade": smokes_thrown,
        "flashbang": flashes_thrown,
        "hegrenade": he_thrown,
        "molotov": molotovs_thrown,
        "incgrenade": molotovs_thrown,
    }
    for r in fogo.to_dict("records"):
        sid = _sid(r.get("user_steamid"))
        if not sid:
            continue
        arma = str(r.get("weapon") or "").replace("weapon_", "")
        if _eh_arma_de_fogo(r.get("weapon")):
            shots_fired[sid] = shots_fired.get(sid, 0) + 1
            # _arma_limpa (não só o strip de "weapon_" já feito acima) porque o
            # weapon_fire DISTINGUE m4a1/m4a1_silencer (etc.) mas o player_hurt não —
            # sem o alias aqui, sobraria um bucket de "shots_fired" órfão sem hit/kill.
            weapon_slot(sid, _arma_limpa(arma))["shots_fired"] += 1
            continue
        contador = _CONTADOR_POR_ARMA.get(arma)
        if contador is not None:
            contador[sid] = contador.get(sid, 0) + 1

    # Cegueira — metodologia igual ao Leetify (glossário oficial, pesquisado 2026-07-11,
    # pra bater os números com o que o usuário via lá): "meio-cego" (duração <= 1.1s)
    # NÃO conta nem pra inimigo nem pra aliado — é o que fazia nosso total vir bem
    # mais alto que o deles pro mesmo jogador/partida. flash_assist conta no MÁXIMO
    # 1 vez por FLASHBANG (não por vítima): se a mesma flash cega 2 inimigos e os
    # dois morrem em seguida, ainda é 1 assist, não 2.
    #
    # Agrupamos os eventos por (quem jogou, tick) — cada flashbang detona uma vez só;
    # todo mundo que ela pega recebe um player_blind NO MESMO TICK (confirmado num
    # demo real), então essa chave identifica "uma flashbang" sem precisar de um id
    # de entidade que o parser não expõe pra esse evento.
    LIMIAR_CEGUEIRA_S = 1.1
    TICK_RATE = 64
    try:
        blind = parser.parse_event("player_blind")
        blind = blind[blind["tick"] >= first_freeze]
        blind_records = blind.to_dict("records")
    except Exception:  # noqa: BLE001
        blind_records = []

    # Auto-flash CONTA como "cegou aliado" (é a própria definição de fogo amigo mais
    # clássica — o Leetify confirma isso: comparado round a round contra um demo real,
    # só bate com o "friends flashed" deles se auto-flash entrar nessa conta).
    flashbangs = {}  # (lançador, tick) -> [{"vitima", "duracao", "aliado"}, ...]
    for r in blind_records:
        atk, vic = _sid(r.get("attacker_steamid")), _sid(r.get("user_steamid"))
        if not atk or not vic:
            continue
        flashbangs.setdefault((atk, int(r["tick"])), []).append(
            {
                "vitima": vic,
                "duracao": _flt(r.get("blind_duration")) or 0.0,
                "aliado": atk == vic or fixed.get(atk) == fixed.get(vic),
            }
        )

    enemies_flashed, teammates_flashed = {}, {}
    enemy_flash_duration, teammate_flash_duration = {}, {}
    flash_assists = {}
    # "Tempo médio de cegueira" do Leetify NÃO é a média de todo blind evento — é a
    # duração do inimigo que ficou MAIS TEMPO cego POR FLASHBANG (ignora os outros
    # atingidos pela mesma flash), média só sobre as flashbangs que cegaram alguém.
    # Sem isso nosso "tempo médio" saía sistematicamente mais alto (contava todo mundo
    # que a flash pegou, não só o pior caso de cada uma).
    enemy_flash_landed_count, enemy_flash_landed_duration_sum = {}, {}
    for (thrower, tick0), vitimas in flashbangs.items():
        creditou_assist = False
        maior_duracao_inimigo = 0.0
        for v in vitimas:
            if not v["aliado"]:
                maior_duracao_inimigo = max(maior_duracao_inimigo, v["duracao"])
            if v["duracao"] <= LIMIAR_CEGUEIRA_S:
                continue  # meio-cego não conta em nada (nem contagem, nem assist)
            if v["aliado"]:
                teammates_flashed[thrower] = teammates_flashed.get(thrower, 0) + 1
                teammate_flash_duration[thrower] = teammate_flash_duration.get(thrower, 0.0) + v["duracao"]
                continue
            enemies_flashed[thrower] = enemies_flashed.get(thrower, 0) + 1
            enemy_flash_duration[thrower] = enemy_flash_duration.get(thrower, 0.0) + v["duracao"]
            if creditou_assist:
                continue
            janela_fim = tick0 + v["duracao"] * TICK_RATE
            for k in kills:
                if k["team_kill"] or k["victim"] != v["vitima"] or not (tick0 <= k["tick"] <= janela_fim):
                    continue
                if fixed.get(k["attacker"]) == fixed.get(thrower):
                    flash_assists[thrower] = flash_assists.get(thrower, 0) + 1
                    creditou_assist = True
                    break
        if maior_duracao_inimigo > 0:
            enemy_flash_landed_count[thrower] = enemy_flash_landed_count.get(thrower, 0) + 1
            enemy_flash_landed_duration_sum[thrower] = (
                enemy_flash_landed_duration_sum.get(thrower, 0.0) + maior_duracao_inimigo
            )

    players = [
        {
            "steam_id64": sid,
            "nick": names.get(sid, ""),
            "team": ft,
            "kills": 0,
            "deaths": 0,
            "assists": assists.get(sid, 0),
            "headshot_kills": 0,
            "damage": damage.get(sid, 0),
            "utility_damage": utility_damage.get(sid, 0),
            "shots_fired": shots_fired.get(sid, 0),
            "shots_hit": shots_hit.get(sid, 0),
            "he_damage": he_damage.get(sid, 0),
            "molotov_damage": molotov_damage.get(sid, 0),
            "he_team_damage": he_team_damage.get(sid, 0),
            "molotov_team_damage": molotov_team_damage.get(sid, 0),
            "flash_assists": flash_assists.get(sid, 0),
            "enemy_flash_landed_count": enemy_flash_landed_count.get(sid, 0),
            "enemy_flash_landed_duration_sum": round(enemy_flash_landed_duration_sum.get(sid, 0.0), 2),
            "smokes_thrown": smokes_thrown.get(sid, 0),
            "flashes_thrown": flashes_thrown.get(sid, 0),
            "he_thrown": he_thrown.get(sid, 0),
            "molotovs_thrown": molotovs_thrown.get(sid, 0),
            "enemies_flashed": enemies_flashed.get(sid, 0),
            "teammates_flashed": teammates_flashed.get(sid, 0),
            "enemy_flash_duration": round(enemy_flash_duration.get(sid, 0.0), 2),
            "teammate_flash_duration": round(teammate_flash_duration.get(sid, 0.0), 2),
            "weapons": weapons.get(sid, {}),
        }
        for sid, ft in fixed.items()
        if sid
    ]

    # Rounds: vencedor por delta de team_rounds_total nos ticks de fim de round.
    rounds = []
    ended = parser.parse_event("round_officially_ended", other=["total_rounds_played"])
    end_ticks = sorted({int(t) for t in ended["tick"].tolist()})
    if end_ticks:
        snaps = parser.parse_ticks(["team_rounds_total"], ticks=end_ticks)
        by_tick = {}
        for r in snaps.to_dict("records"):
            ft = fixed.get(_sid(r.get("steamid")))
            total = _num(r.get("team_rounds_total"))
            if ft and total is not None:
                by_tick.setdefault(int(r["tick"]), {})[ft] = total
        prev = {"A": 0, "B": 0}
        for i, t in enumerate(end_ticks):
            cur = by_tick.get(t, prev)
            if cur.get("A", 0) > prev["A"]:
                winner = "A"
            elif cur.get("B", 0) > prev["B"]:
                winner = "B"
            else:
                winner = None
            rounds.append({"round_number": i + 1, "winner_team": winner, "win_reason": ""})
            prev = {"A": cur.get("A", prev["A"]), "B": cur.get("B", prev["B"])}

    played_at = datetime.datetime.fromtimestamp(
        os.path.getmtime(path), tz=datetime.timezone.utc
    ).isoformat()

    return {
        "map": mapa,
        "score_a": score["A"],
        "score_b": score["B"],
        "played_at": played_at,
        "rounds": rounds,
        "players": players,
        "kills": kills,
        "round_econ": round_econ,
        "kill_positions": kill_positions,
    }


def extract_replay(path, target_hz=8, demo_tick_rate=64):
    """Dados do Replay 2D numa passada: posições (com downsample) + kills.

    Devolve {"ticks": [{round, tick, players:[{id,nick,x,y,yaw,hp,team,alive}]}],
             "kills": [{round, tick, killer, victim, weapon, headshot}]}.
    O round de cada tick/kill é atribuído pelos limites de freeze_end (consistente
    entre posições e kills). Só validável contra um .dem real.
    """
    from demoparser2 import DemoParser

    parser = DemoParser(str(path))
    freeze = parser.parse_event("round_freeze_end", other=["total_rounds_played"])
    ended = parser.parse_event("round_officially_ended", other=["total_rounds_played"])
    inicios = sorted({int(t) for t in freeze["tick"].tolist()})
    fins = sorted({int(t) for t in ended["tick"].tolist()})  # dedupe: há 2 linhas por round

    # Time fixo A/B pelo primeiro freeze_end (mesmo método de parse_demo, recalculado
    # aqui porque extract_replay é uma passada independente). Precisa ser ESTÁVEL pro
    # jogo inteiro — team_num sozinho é o lado atual (CT/T), que troca no intervalo;
    # usar team_num por tick corrompia a detecção de clutch (replay.py) pra qualquer
    # round antes da troca de lado, contando/perdendo clutches que nunca existiram.
    fixed = {}
    if inicios:
        snap0 = parser.parse_ticks(["team_num"], ticks=[inicios[0]])
        for r in snap0.to_dict("records"):
            sid, team_num = _sid(r.get("steamid")), _num(r.get("team_num"))
            if sid and team_num is not None:
                fixed[sid] = _team_letter(team_num)

    passo = max(1, round(demo_tick_rate / target_hz))
    alvo = []
    limites = []
    for i, ini in enumerate(inicios):
        fim = fins[i] if i < len(fins) else ini + 64 * 115
        limites.append((i + 1, ini, fim))
        for t in range(ini, fim, passo):
            alvo.append(t)
    if not alvo:
        return {"ticks": [], "kills": [], "hits": []}

    def round_do_tick(t):
        for rnd, ini, fim in limites:
            if ini <= t <= fim:
                return rnd
        return limites[-1][0]

    # Posições (parse_ticks já traz a coluna "name").
    df = parser.parse_ticks(["X", "Y", "yaw", "health", "team_num", "is_alive"], ticks=alvo)
    por_tick = {}
    for r in df.to_dict("records"):
        sid = _sid(r.get("steamid"))
        if not sid:
            continue
        # Jogador desconectado neste tick vem com os campos NaN — fica fora do frame
        # (mesma causa do _num acima; int(NaN)/float NaN estouram ou corrompem o JSON).
        x, y, team_num = _flt(r.get("X")), _flt(r.get("Y")), _num(r.get("team_num"))
        if x is None or y is None or team_num is None:
            continue
        por_tick.setdefault(int(r["tick"]), []).append(
            {
                "id": sid,
                "nick": r.get("name") or "",
                "x": x,
                "y": y,
                "yaw": _flt(r.get("yaw")) or 0.0,
                "hp": _num(r.get("health")) or 0,
                # Time ESTÁVEL (fixed), não o lado atual — team_num sozinho flipa no
                # intervalo. Fallback pro lado atual só pra quem não estava no 1º freeze
                # (entrou depois — raro, mas não pode sumir do replay).
                "team": fixed.get(sid, _team_letter(team_num)),
                "alive": bool(r.get("is_alive")),
            }
        )
    ticks = [{"round": round_do_tick(t), "tick": t, "players": por_tick[t]} for t in sorted(por_tick)]

    # Kills (fora do warmup).
    deaths = parser.parse_event("player_death", other=["total_rounds_played", "is_warmup_period"])
    deaths = deaths[deaths["is_warmup_period"] == False]  # noqa: E712
    kills = []
    for r in deaths.to_dict("records"):
        killer, victim = _sid(r.get("attacker_steamid")), _sid(r.get("user_steamid"))
        # killer pode ser None (dano de queda/mundo, sem atacante) — mantém pro heatmap
        # de mortes (a posição da morte existe mesmo sem "quem matou"); só descarta
        # suicídio (killer == victim, ex.: própria HE/molotov).
        if not victim or killer == victim:
            continue
        tk = int(r["tick"])
        kills.append(
            {
                "round": round_do_tick(tk),
                "tick": tk,
                "killer": killer,
                "victim": victim,
                "weapon": r.get("weapon") or "",
                "headshot": bool(r.get("headshot")),
            }
        )

    # Tiros que ACERTARAM alguém mas não mataram (pedido do usuário: traçado de bala
    # em todo tiro, não só nos kills — miss não dá pra traçar sem simular física de
    # bala contra o mapa, que não temos; hit é o que dá pra mostrar de verdade).
    # Dedupe do hit fatal: mesmo (vítima, tick) já vem em `kills` (player_death e
    # player_hurt disparam no MESMO tick pro dano que mata, confirmado empírico).
    kills_por_vitima_tick = {(k["victim"], k["tick"]) for k in kills}
    hurt = parser.parse_event("player_hurt", other=["weapon", "hitgroup"])
    hits = []
    for r in hurt.to_dict("records"):
        atk, vic = _sid(r.get("attacker_steamid")), _sid(r.get("user_steamid"))
        if not atk or not vic or atk == vic:
            continue
        if not _eh_arma_de_fogo(r.get("weapon")):
            continue  # HE/molotov (dano por tick) e faca não são "disparo" — sem bala pra traçar
        tk = int(r["tick"])
        if (vic, tk) in kills_por_vitima_tick:
            continue  # já é o hit fatal, coberto por `kills`
        hits.append(
            {
                "round": round_do_tick(tk),
                "tick": tk,
                "killer": atk,
                "victim": vic,
                "weapon": r.get("weapon") or "",
                "headshot": r.get("hitgroup") == "head",
            }
        )

    # ---- Utilitárias + bomba ----
    def evento(nome):
        try:
            return parser.parse_event(nome).to_dict("records")
        except Exception:
            return []

    def _xy(r):
        return _flt(r.get("x")) or 0.0, _flt(r.get("y")) or 0.0

    # Smokes e fogo: casa detonate/startburn com expired pelo entityid (duração real).
    def granadas_com_duracao(ev_ini, ev_fim, dur_padrao_s):
        fins = {}
        for r in evento(ev_fim):
            fins[r.get("entityid")] = int(r["tick"])
        saida = []
        for r in evento(ev_ini):
            x, y = _xy(r)
            t0 = int(r["tick"])
            t1 = fins.get(r.get("entityid"), t0 + int(dur_padrao_s * 64))
            saida.append({"round": round_do_tick(t0), "x": x, "y": y, "tickStart": t0, "tickEnd": t1})
        return saida

    smokes = granadas_com_duracao("smokegrenade_detonate", "smokegrenade_expired", 18)
    fires = granadas_com_duracao("inferno_startburn", "inferno_expire", 7)

    def granadas_instantaneas(nome):
        saida = []
        for r in evento(nome):
            x, y = _xy(r)
            t0 = int(r["tick"])
            saida.append({"round": round_do_tick(t0), "x": x, "y": y, "tick": t0})
        return saida

    flashes = granadas_instantaneas("flashbang_detonate")
    hes = granadas_instantaneas("hegrenade_detonate")

    blinds = []
    for r in evento("player_blind"):
        vic = _sid(r.get("user_steamid"))
        if not vic:
            continue
        t0 = int(r["tick"])
        blinds.append(
            {
                "round": round_do_tick(t0),
                "tick": t0,
                "victim": vic,
                "attacker": _sid(r.get("attacker_steamid")),
                "duration": _flt(r.get("blind_duration")) or 0.0,
            }
        )

    def bomba(nome):
        saida = []
        for r in evento(nome):
            sid = _sid(r.get("user_steamid"))
            if not sid:
                continue
            t0 = int(r["tick"])
            saida.append({"round": round_do_tick(t0), "tick": t0, "steamid": sid})
        return saida

    bomb_pickups = bomba("bomb_pickup")
    bomb_drops = bomba("bomb_dropped")
    bomb_plants = bomba("bomb_planted")

    return {
        "ticks": ticks,
        "kills": kills,
        "hits": hits,
        "smokes": smokes,
        "fires": fires,
        "flashes": flashes,
        "hes": hes,
        "blinds": blinds,
        "bombPickups": bomb_pickups,
        "bombDrops": bomb_drops,
        "bombPlants": bomb_plants,
    }
