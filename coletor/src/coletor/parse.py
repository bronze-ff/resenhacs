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


def _lado_de_team_num(team_number):
    """team_num (lado ATUAL, troca no intervalo) → 'T'/'CT' — convenção 2=T/3=CT já
    usada pro "side" do Replay 2D. None pra qualquer outro valor (ex.: espectador,
    desconhecido) — não confundir com `_team_letter`, que devolve o time FIXO A/B."""
    if team_number == 2:
        return "T"
    if team_number == 3:
        return "CT"
    return None


def _construir_rounds(end_ticks, by_tick, score, lado_por_round=None):
    """Monta a lista de `rounds` (vencedor por round) a partir dos ticks de fim de round
    oficial + placar final. Completa o round DECISIVO quando ele falta — o
    round_officially_ended do round que fecha a partida tipicamente não dispara (o mapa
    termina antes, no cs_win_panel_match); sem isso, o clutch/entry desse round (quase
    sempre o mais memorável) nunca aparecia em `rounds`. O time que tem mais rounds no
    placar final (`score`) do que o já contabilizado pelos ticks de fim de round venceu
    o round que falta — winner sintético; `win_reason` fica vazio (não há evento de
    razão de vitória disponível tão perto do fim da partida).

    `end_ticks`: lista ordenada de ticks de round_officially_ended.
    `by_tick`: {tick: {"A": total_rounds, "B": total_rounds}} — snapshot em cada end_tick.
    `score`: {"A": int, "B": int} — placar final da partida (team_rounds_total no fim).
    `lado_por_round` (opcional, FIL-51): {round_number: "CT"|"T"} lado que o time A
    ocupava naquele round — vira `side_a` em cada round. Sem dado pro round decisivo
    sintético (mesma limitação do win_reason vazio: perto demais do fim da partida).
    """
    lado_por_round = lado_por_round or {}
    rounds = []
    prev = {"A": 0, "B": 0}
    for i, t in enumerate(end_ticks):
        cur = by_tick.get(t, prev)
        if cur.get("A", 0) > prev["A"]:
            winner = "A"
        elif cur.get("B", 0) > prev["B"]:
            winner = "B"
        else:
            winner = None
        rounds.append({
            "round_number": i + 1, "winner_team": winner, "win_reason": "",
            "side_a": lado_por_round.get(i + 1),
        })
        prev = {"A": cur.get("A", prev["A"]), "B": cur.get("B", prev["B"])}

    total_rounds_esperado = score.get("A", 0) + score.get("B", 0)
    if total_rounds_esperado > len(rounds):
        if score.get("A", 0) > prev.get("A", 0):
            vencedor_decisivo = "A"
        elif score.get("B", 0) > prev.get("B", 0):
            vencedor_decisivo = "B"
        else:
            vencedor_decisivo = None
        rounds.append({
            "round_number": len(rounds) + 1, "winner_team": vencedor_decisivo, "win_reason": "",
            "side_a": lado_por_round.get(len(rounds) + 1),
        })
    return rounds


_ROUNDS_PRA_VENCER_MR12 = 13


def _detectar_abandono(score, end_ticks, disconnects, kills):
    """(ended_early, abandoned_by_steam_id64_ou_None).

    Descoberta empírica (2026-07-21, partida 44a32a9e/de_mirage 4x1, comparada com uma
    partida normal 13x7): o round_officially_ended do round DECISIVO nunca dispara —
    mesmo numa partida 100% normal (a 13x7 real também tem exatamente esse gap de 1).
    Não dá pra usar isso como sinal de abandono. O placar É o sinal confiável: o
    formato competitivo/premier (MR12) só termina com um time batendo 13 — os dois
    lados abaixo de 13 numa partida já 'parsed' (demo completo, a Valve só libera o
    demo depois que a partida termina) só é possível por abandono/forfeit técnico.

    Pra achar QUEM abandonou: pega o ÚLTIMO disconnect de cada jogador (`disconnects`,
    steam_id64+tick); se não teve NENHUM kill/death depois desse tick E o disconnect
    aconteceu até o último round_officially_ended REAL (`end_ticks[-1]` — não faz
    parte da debandada normal de fim de partida, que sempre acontece por último), é
    candidato a ter sido quem abandonou. Só atribui quando há exatamente 1 candidato —
    ambíguo (2+ ao mesmo tempo, ou nenhum) fica sem atribuição (abandoned_by=None)."""
    ended_early = score.get("A", 0) < _ROUNDS_PRA_VENCER_MR12 and score.get("B", 0) < _ROUNDS_PRA_VENCER_MR12
    if not ended_early or not end_ticks:
        return ended_early, None

    ultimo_tick_real = end_ticks[-1]
    ultimo_disconnect_por_sid = {}
    for d in disconnects:
        sid = d.get("steam_id64")
        if not sid:
            continue
        ultimo_disconnect_por_sid[sid] = max(ultimo_disconnect_por_sid.get(sid, -1), d["tick"])

    candidatos = []
    for sid, tick in ultimo_disconnect_por_sid.items():
        if tick > ultimo_tick_real:
            continue
        teve_atividade_depois = any(
            k["tick"] > tick and (k["attacker"] == sid or k["victim"] == sid) for k in kills
        )
        if not teve_atividade_depois:
            candidatos.append(sid)

    return ended_early, candidatos[0] if len(candidatos) == 1 else None


def _nomes_de_time(registros, fixed):
    """(nome_time_a, nome_time_b) a partir de um snapshot de tick com team_clan_name —
    None quando a demo não traz nome de clã (comum em partida de matchmaking do grupo,
    só partida de pro/LAN costuma ter). `registros` é uma lista de dict/records (mesmo
    formato de parser.parse_ticks(...).to_dict("records"))."""
    import pandas as pd

    nomes = {"A": None, "B": None}
    for r in registros:
        sid = _sid(r.get("steamid"))
        lado = fixed.get(sid)
        bruto = r.get("team_clan_name")
        # team_clan_name ausente vira NaN/pd.NA (não None/"") em alguns snapshots do
        # parser — NaN é "truthy" em Python, então um `or ""` sozinho não pega esse caso
        # e `.strip()` estoura (bug real, 2026-07-24). pd.isna cobre None/NaN/pd.NA de uma
        # vez, mesmo espírito de _sid/_num logo abaixo.
        nome = "" if bruto is None or pd.isna(bruto) else str(bruto).strip()
        if lado and nome and not nomes[lado]:
            nomes[lado] = nome
    return nomes["A"], nomes["B"]


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


def _txt(v):
    """str(v), ou None pra NaN/None — active_weapon_name vem NaN (não None) quando o
    jogador não tinha arma equipada naquele tick exato; sem isso o texto "NaN" vazava
    pra victim_weapon gravado no banco e aparecia literalmente na tela ("segurando: NaN",
    achado pelo usuário no modal de detalhe por round)."""
    import pandas as pd

    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return str(v)


def _premier_ratings(rows, fixed, score):
    """A partir de um snapshot de tick (rank/rank_if_win/rank_if_loss/rank_if_tie por
    jogador, lido no mesmo end_tick do placar final) + o time fixo de cada um + o
    placar final por time, devolve {steam_id64: {"before": x, "after": y}} só pra quem
    tem dado de Premier (rank presente) — Wingman/Competitivo por mapa/Partida Pro não
    têm esse campo no replay, então saem de fora naturalmente (sem precisar detectar o
    modo por um enum separado, que não é documentado publicamente)."""
    resultado = {}
    for r in rows:
        sid = _sid(r.get("steamid"))
        antes = _num(r.get("rank"))
        time = fixed.get(sid)
        if not sid or antes is None or not time:
            continue
        outro = "B" if time == "A" else "A"
        if score.get(time, 0) > score.get(outro, 0):
            depois = _num(r.get("rank_if_win"))
        elif score.get(time, 0) < score.get(outro, 0):
            depois = _num(r.get("rank_if_loss"))
        else:
            depois = _num(r.get("rank_if_tie"))
        if depois is not None:
            resultado[sid] = {"before": antes, "after": depois}
    return resultado


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

# Durações oficiais de utilitária no CS2 (pesquisado 2026-07-14, NÃO é o valor de
# CS:GO): fumaça dura 18s no total (nuvem plena por ~16s + ~2s formando — swap.gg
# "How Long Does Smoke Last in CS2?", bo3.gg "How long do grenades in CS2?");
# molotov/incendiário queima 7s no chão (`inferno_flame_lifetime` default = 7,
# totalcsgo.com/commands/infernoflamelifetime — o valor real usado pelo próprio jogo,
# não estimativa de guia). Usados como TETO de duração (nunca o fim do round) quando o
# evento de expiração não casa com o de início, ou casa com uma duração absurda — ver
# _casar_fim_de_granada.
DURACAO_SMOKE_S = 18
DURACAO_FOGO_S = 7
_FOLGA_DURACAO_S = 2  # tolerância acima do teto antes de descartar o evento casado como errado

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


def _arma_limpa(weapon):
    """Nome cru da arma sem o prefixo 'weapon_' (só o weapon_fire traz o prefixo;
    player_death/player_hurt já vêm sem). None quando não há arma. NÃO resolve a
    ambiguidade das duplas abaixo — isso depende do round de quem disparou, não dá
    pra fazer numa função pura de string (ver _mapa_variante_ambigua/_resolver_arma_hurt)."""
    if not weapon:
        return None
    return str(weapon).replace("weapon_", "") or None


def _casar_arremesso_com_detonacao(fires, detonates, janela_ticks=600):
    """{(detonate_tick, thrower): fire_tick} — casa cada detonação com o weapon_fire mais
    recente (e anterior) do MESMO jogador, dentro de uma janela.

    Descoberta empírica (demo real de matchmaking, 2026-07-13): `weapon_fire` NÃO traz
    `entityid` (só existe no evento de detonação) — não dá pra casar por entityid, só por
    (thrower, tick). Testado nos 4 tipos de granada (450 fires / 456 detonates no total):
    correlação por "fire mais recente e anterior ao detonate, do mesmo user_steamid" bateu
    100% (0 detonates órfãos). Delta de tick observado: smoke 15-473, HE 109-118, flash
    0-118, molotov/incendiary 41-143 — janela de 200 (do rascunho original) já teria perdido
    21/109 smokes; usamos 600 (~9.4s a 64 ticks) de folga confortável acima do máximo
    observado (473), sem abrir espaço demais pra casar com o fire de um arremesso anterior
    do mesmo jogador (fires do mesmo tipo tendem a ficar bem mais que 600 ticks distantes
    entre si numa partida real). Detonação sem fire correspondente (raro, ex.: round
    cortado) fica de fora — nesse caso o lineup não tem posição de arremesso, só de
    aterrissagem."""
    por_thrower = {}
    for f in fires:
        por_thrower.setdefault(f["thrower"], []).append(f["tick"])
    for ticks in por_thrower.values():
        ticks.sort()

    casados = {}
    for d in detonates:
        candidatos = por_thrower.get(d["thrower"], [])
        melhor = None
        for t in candidatos:
            if t <= d["tick"] and d["tick"] - t <= janela_ticks:
                melhor = t
        if melhor is not None:
            casados[(d["tick"], d["thrower"])] = melhor
    return casados


def _casar_fim_de_granada(inicios, fins, cap_ticks, folga_ticks):
    """[tickEnd por início] — casa cada início de granada com duração (smoke/molotov,
    `inicios`: [{tick, entityid}]) com o PRÓXIMO evento de expiração do MESMO entityid
    (`fins`: [{tick, entityid}]), na mesma ordem de `inicios`.

    Bug real (achado pelo usuário via print, 2026-07-14): o código antigo casava por
    um dict simples `entityid -> tick` construído numa passada só sobre TODOS os
    eventos de fim da demo inteira — como demoparser2/Source reciclam entityid ao
    longo da partida, a última ocorrência daquele id no dict podia ser de uma granada
    de outro round, produzindo tickEnd absurdo (67.9s vistos no Replay 2D pra uma
    smoke que dura ~18s de verdade). Aqui casamos com o fim mais próximo ESTRITAMENTE
    DEPOIS do início (bisect no fim por entityid, todos ordenados) — e, quando não há
    fim casável OU a duração resultante estoura `cap_ticks + folga_ticks` (sinal de
    casamento ainda errado), caímos pro teto `cap_ticks` (duração oficial do CS2) a
    partir do início. NUNCA usa o fim do round como fallback."""
    import bisect

    fins_por_entidade = {}
    for f in fins:
        fins_por_entidade.setdefault(f.get("entityid"), []).append(int(f["tick"]))
    for lista in fins_por_entidade.values():
        lista.sort()

    saida = []
    for ini in inicios:
        t0 = int(ini["tick"])
        candidatos = fins_por_entidade.get(ini.get("entityid"), [])
        pos = bisect.bisect_right(candidatos, t0)
        t1 = candidatos[pos] if pos < len(candidatos) else None
        if t1 is None or t1 - t0 > cap_ticks + folga_ticks:
            t1 = t0 + cap_ticks
        saida.append(t1)
    return saida


# Descoberta empírica (mesmo demo real, 2026-07-11): player_hurt NÃO distingue essas
# 3 duplas de arma — os hits/dano de QUALQUER uma das duas vêm com o nome do lado
# direito (genérico), mesmo quando o kill (player_death) ou o tiro (weapon_fire, que
# TAMBÉM distingue certinho) foi com a da esquerda (precisa). Rastreado round a round
# contra um duelo real pra confirmar (não é achismo): kill m4a1_silencer <- hurt
# correspondente chega como "m4a1"; kill usp_silencer <- hurt chega como "hkp2000";
# kill revolver <- hurt chega como "deagle".
#
# Bug antigo (achado pelo usuário, 2026-07-13): a correção rodava num _arma_limpa()
# aplicado também em KILLS e shots_fired — que já vêm certos (player_death/weapon_fire
# distinguem a dupla direitinho) — e "achatava" tudo pro nome genérico. Resultado: todo
# kill de USP-S aparecia como P2000 nas stats do jogador (e no ícone do Replay 2D).
# A correção agora só entra pro HIT/DANO ambíguo, e usa o weapon_fire do mesmo round
# (que sabe distinguir) pra descobrir qual das duas o jogador realmente segurava —
# um jogador só carrega uma variante do par por vez.
_GENERICA_POR_PRECISA = {"m4a1_silencer": "m4a1", "usp_silencer": "hkp2000", "revolver": "deagle"}
_PRECISAS_AMBIGUAS = set(_GENERICA_POR_PRECISA)
_GENERICAS_AMBIGUAS = set(_GENERICA_POR_PRECISA.values())


def _mapa_variante_ambigua(disparos):
    """dict (steamid, round, arma_genérica) -> arma_precisa, a partir de `disparos`
    ([{user_steamid, weapon, round}], vindo do weapon_fire). Só grava quando a PRECISA
    foi de fato disparada naquele round — ausência não significa nada (fica pro
    _resolver_arma_hurt manter o nome genérico como já vinha)."""
    mapa = {}
    for d in disparos:
        sid = _sid(d.get("user_steamid"))
        arma = _arma_limpa(d.get("weapon"))
        if not sid or arma not in _PRECISAS_AMBIGUAS:
            continue
        mapa[(sid, d["round"], _GENERICA_POR_PRECISA[arma])] = arma
    return mapa


def _resolver_arma_hurt(mapa_variante, sid, round_no, arma):
    """Corrige o nome genérico de um hit/dano (player_hurt) pra variante precisa de
    fato usada naquele round, se soubermos (ver _mapa_variante_ambigua). Arma que não
    é uma das genéricas ambíguas passa direto — nada a corrigir."""
    if arma not in _GENERICAS_AMBIGUAS:
        return arma
    return mapa_variante.get((sid, round_no, arma), arma)


def cabecalho_mapa(caminho):
    """Só o `map_name` do header do .dem — não parseia o arquivo inteiro. Usado pra
    agrupar partes de uma mesma série (ver main.cmd_processar_fila_pro): o nome do
    arquivo (-p1/-p2) é convenção do HLTV, não garantida; o mapa real do header é."""
    from demoparser2 import DemoParser

    return DemoParser(str(caminho)).parse_header().get("map_name")


_LETRA_OPOSTA = {"A": "B", "B": "A"}


def _inverter_letra_time(letra):
    return _LETRA_OPOSTA.get(letra, letra)


def _deve_inverter_letra(referencia_por_sid, atual_por_sid):
    """True quando a MAIORIA dos steam_id64 em comum entre a parte de referência
    (1ª do grupo) e `atual_por_sid` está com a letra A/B trocada — parse_demo atribui
    a letra por arquivo (quem aparece primeiro no snapshot), sem garantia de que o
    MESMO jogador fique com a MESMA letra em duas partes do mesmo mapa."""
    comuns = set(referencia_por_sid) & set(atual_por_sid)
    if not comuns:
        return False
    diferentes = sum(1 for sid in comuns if referencia_por_sid[sid] != atual_por_sid[sid])
    return diferentes > len(comuns) / 2


def _corrigir_letra_parte(parte, inverter):
    """Cópia de `parte` (dict cru de parse_demo) com toda letra de time A/B invertida,
    se `inverter`. steam_id64 (killer/victim/thrower/attacker) e lado CT/T não mudam —
    só a letra A/B arbitrária. score_a/score_b não precisa: é recalculado do zero em
    cima do `rounds` já fundido (_recontar_placar), nunca herdado de uma parte crua."""
    if not inverter:
        return parte
    return {
        **parte,
        "team_a_name": parte.get("team_b_name"),
        "team_b_name": parte.get("team_a_name"),
        "players": [{**p, "team": _inverter_letra_time(p["team"])} for p in parte.get("players", [])],
        "rounds": [
            {**r, "winner_team": _inverter_letra_time(r.get("winner_team"))} for r in parte.get("rounds", [])
        ],
        "round_econ": [{**e, "team": _inverter_letra_time(e.get("team"))} for e in parte.get("round_econ", [])],
        "player_round_econ": [
            {**e, "team": _inverter_letra_time(e.get("team"))} for e in parte.get("player_round_econ", [])
        ],
        # purchases não tem campo "team" (é por steam_id64, que não muda com a letra).
        "purchases": parte.get("purchases", []),
    }


def _corrigir_letra_rdata(rdata, inverter):
    """Mesma correção de _corrigir_letra_parte, mas pro rdata cru de extract_replay —
    só `ticks[].players[].team` carrega letra A/B ali (side CT/T é dado real do jogo,
    não muda)."""
    if not inverter:
        return rdata
    return {
        **rdata,
        "ticks": [
            {**t, "players": [{**p, "team": _inverter_letra_time(p.get("team"))} for p in t.get("players", [])]}
            for t in rdata.get("ticks", [])
        ],
    }


def _offset_campo(items, offset, campo):
    return [{**it, campo: it[campo] + offset} for it in items]


def _somar_pares(items, chaves):
    """Funde itens repetidos (mesma chave-de-agrupamento) somando os campos numéricos
    restantes — usado pra player_damage/player_flashes quando um mapa vem em 2+ .dem
    (Partidas Pro): não tem round_number pra offsetar nem letra de time pra inverter
    (attacker/victim já são steam_id64, não mudam), só soma o que se repete entre partes."""
    acumulado = {}
    for item in items:
        chave = tuple(item[k] for k in chaves)
        if chave not in acumulado:
            acumulado[chave] = dict(item)
            continue
        alvo = acumulado[chave]
        for k, v in item.items():
            if k in chaves or not isinstance(v, (int, float)):
                continue
            alvo[k] = alvo.get(k, 0) + v
    return list(acumulado.values())


_MAX_COMPRAS_POR_ROUND = {"Flashbang": 2}
_MAX_COMPRAS_POR_ROUND_PADRAO = 1


def _filtrar_ecos_de_compra(purchases):
    """demoparser2 sintetiza "item_purchase" a partir da CRIAÇÃO da entidade de arma (não
    existe evento nativo de compra no CS2) — funciona bem pra armas (a entidade dura o
    round todo), mas granadas/consumíveis (Flashbang, HE, Smoke, Incendiary, Zeus) têm a
    entidade recriada quando o jogador reequipa/saca da reserva, gerando uma 2ª (ou 3ª)
    "compra" fantasma do MESMO item/round/jogador, sempre num tick DEPOIS da compra real
    (limitação documentada do parser: github.com/LaihoE/demoparser/issues/214). Como o
    CS2 limita quantas unidades de cada item dá pra comprar por round (2 flashbang, 1 de
    qualquer outra coisa), mantém só as N ocorrências de tick mais cedo por
    (round_number, steam_id64, item) — o resto é eco de reequipar, não compra nova."""
    agrupado = {}
    for c in purchases:
        agrupado.setdefault((c["round_number"], c["steam_id64"], c["item"]), []).append(c)
    limpas = []
    for (_rn, _sid, item), grupo in agrupado.items():
        limite = _MAX_COMPRAS_POR_ROUND.get(item, _MAX_COMPRAS_POR_ROUND_PADRAO)
        grupo_ordenado = sorted(grupo, key=lambda c: c.get("tick") or 0)
        limpas.extend(grupo_ordenado[:limite])
    return limpas


def _dedupe_purchases_por_reinicio(purchases_por_parte):
    """purchases pode ter 2 lotes pro MESMO (round_number, steam_id64) quando o
    reinício técnico cai no meio da fase de compra: o jogador reabre o buy menu e
    recompra tudo na parte seguinte. Diferente de player_damage/player_flashes
    (_somar_pares) — aqui não dá pra somar, um jogador pode legitimamente comprar 2
    flashbangs no mesmo round, então somar contaria a recompra-por-restart junto com
    uma recompra real. Em vez disso, mesma semântica do fix de player_round_econ
    (commit 92a3a25, "fica o mais recente"): se uma parte MAIS NOVA tem qualquer
    compra pro mesmo par, descarta o lote INTEIRO da parte mais velha pra esse par.
    `purchases_por_parte` é a lista de listas de compras já com offset aplicado, na
    ordem cronológica das partes."""
    pares_em_parte_mais_nova = set()
    mantidas_por_parte = []
    for compras in reversed(purchases_por_parte):
        mantidas = [c for c in compras if (c["round_number"], c["steam_id64"]) not in pares_em_parte_mais_nova]
        pares_em_parte_mais_nova |= {(c["round_number"], c["steam_id64"]) for c in compras}
        mantidas_por_parte.append(mantidas)
    mantidas_por_parte.reverse()
    return [c for compras in mantidas_por_parte for c in compras]


def _somar_weapons(a, b):
    saida = {arma: dict(stats) for arma, stats in a.items()}
    for arma, stats in b.items():
        alvo = saida.setdefault(arma, {})
        for campo, valor in stats.items():
            alvo[campo] = alvo.get(campo, 0) + valor
    return saida


def _somar_jogador(a, b):
    """Funde as stats de UM jogador presente nas duas partes: soma todo campo
    numérico (kills, damage, etc.), funde `weapons` campo a campo por arma, mantém
    steam_id64/nick/team de `a` (já normalizados pra letra canônica antes de chegar
    aqui — são o mesmo jogador nas duas partes). `premier_rating_before`/`_after` não
    são somáveis (são leituras pontuais de rating, não contadores): o restart técnico
    funde partes do MESMO Premier real, então "before" fica o mais antigo (estado
    antes de tudo começar) e "after" o mais recente (resultado real final) — nunca
    soma."""
    saida = dict(a)
    for k, v in b.items():
        if k in ("steam_id64", "nick", "team", "weapons"):
            continue
        if k == "premier_rating_before":
            if saida.get(k) is None and v is not None:
                saida[k] = v
            continue
        if k == "premier_rating_after":
            if v is not None:
                saida[k] = v
            continue
        if isinstance(v, (int, float)) and isinstance(a.get(k), (int, float)):
            saida[k] = a.get(k, 0) + v
        elif k not in a:
            saida[k] = v
    saida["weapons"] = _somar_weapons(a.get("weapons", {}), b.get("weapons", {}))
    return saida


def _merge_players(partes_players):
    por_sid, ordem = {}, []
    for players in partes_players:
        for p in players:
            sid = p["steam_id64"]
            if sid not in por_sid:
                por_sid[sid] = dict(p)
                ordem.append(sid)
            else:
                por_sid[sid] = _somar_jogador(por_sid[sid], p)
    return [por_sid[sid] for sid in ordem]


_CAMPOS_RDATA_POR_ROUND = (
    "ticks", "kills", "hits", "smokes", "fires", "flashes", "hes",
    "blinds", "bombPickups", "bombDrops", "bombPlants",
)


def fundir_partes_mesmo_mapa(partes, rdatas=None):
    """Funda os dados CRUS (pré transform.enrich/replay.build_replay) de 2+ .dem que
    são o MESMO mapa dividido em pedaços por um reinício técnico no meio da partida
    (o HLTV distribui o mapa como .dem separados dentro do mesmo .rar da série — ver
    main.cmd_processar_fila_pro). `partes` é a lista de dicts de parse_demo, na ordem
    real da série; `rdatas`, se fornecido, é a lista paralela de dicts de
    extract_replay (mesma ordem).

    Grupo de 1 parte devolve a própria parte sem tocar em nada (comportamento atual,
    sem merge). Devolve (parsed_fundido, rdata_fundido_ou_None).
    """
    if len(partes) == 1:
        return partes[0], (rdatas[0] if rdatas else None)

    referencia = {p["steam_id64"]: p["team"] for p in partes[0]["players"]}
    inverter_flags = [False]
    for parte in partes[1:]:
        atual = {p["steam_id64"]: p["team"] for p in parte["players"]}
        inverter_flags.append(_deve_inverter_letra(referencia, atual))

    partes_corrigidas = [_corrigir_letra_parte(p, inv) for p, inv in zip(partes, inverter_flags)]

    offsets = []
    rounds_ja_contados = 0
    for parte in partes_corrigidas:
        offsets.append(rounds_ja_contados)
        rounds_ja_contados += len(parte.get("rounds", []))

    rounds_fundidos, kills_fundidos, econ_fundido, kill_pos_fundidas = [], [], [], []
    player_econ_fundido, purchases_por_parte, round_damage_fundido = [], [], []
    for parte, offset in zip(partes_corrigidas, offsets):
        rounds_fundidos += _offset_campo(parte.get("rounds", []), offset, "round_number")
        kills_fundidos += _offset_campo(parte.get("kills", []), offset, "round_number")
        econ_fundido += _offset_campo(parte.get("round_econ", []), offset, "round_number")
        kill_pos_fundidas += _offset_campo(parte.get("kill_positions", []), offset, "round_number")
        player_econ_fundido += _offset_campo(parte.get("player_round_econ", []), offset, "round_number")
        purchases_por_parte.append(_offset_campo(parte.get("purchases", []), offset, "round_number"))
        round_damage_fundido += _offset_campo(parte.get("player_round_damage", []), offset, "round_number")
    purchases_fundidas = _dedupe_purchases_por_reinicio(purchases_por_parte)

    score_a = sum(1 for r in rounds_fundidos if r.get("winner_team") == "A")
    score_b = sum(1 for r in rounds_fundidos if r.get("winner_team") == "B")

    nome_a = next((p.get("team_a_name") for p in partes_corrigidas if p.get("team_a_name")), None)
    nome_b = next((p.get("team_b_name") for p in partes_corrigidas if p.get("team_b_name")), None)

    player_damage_fundido = _somar_pares(
        [d for p in partes_corrigidas for d in p.get("player_damage", [])],
        ("attacker", "victim", "weapon"),
    )
    player_flashes_fundido = _somar_pares(
        [f for p in partes_corrigidas for f in p.get("player_flashes", [])],
        ("attacker", "victim"),
    )

    parsed_fundido = {
        **partes_corrigidas[0],
        "score_a": score_a, "score_b": score_b,
        "team_a_name": nome_a, "team_b_name": nome_b,
        "rounds": rounds_fundidos, "kills": kills_fundidos,
        "round_econ": econ_fundido, "kill_positions": kill_pos_fundidas,
        "player_round_econ": player_econ_fundido, "purchases": purchases_fundidas,
        "player_damage": player_damage_fundido, "player_flashes": player_flashes_fundido,
        "player_round_damage": round_damage_fundido,
        "players": _merge_players([p.get("players", []) for p in partes_corrigidas]),
    }

    rdata_fundido = None
    if rdatas and len(rdatas) == len(partes):
        rdatas_corrigidos = [_corrigir_letra_rdata(r, inv) for r, inv in zip(rdatas, inverter_flags)]
        rdata_fundido = {campo: [] for campo in _CAMPOS_RDATA_POR_ROUND}
        for rdata, offset in zip(rdatas_corrigidos, offsets):
            for campo in _CAMPOS_RDATA_POR_ROUND:
                rdata_fundido[campo] += _offset_campo(rdata.get(campo, []), offset, "round")

    return parsed_fundido, rdata_fundido


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

    fogo = parser.parse_event("weapon_fire", other=["total_rounds_played"])
    fogo = fogo[fogo["tick"] >= first_freeze]

    # weapon_fire DISTINGUE as duplas ambíguas (m4a1/m4a1_silencer etc.) certinho —
    # usado só pra corrigir o hit/dano ambíguo do player_hurt (ver _resolver_arma_hurt).
    mapa_variante = _mapa_variante_ambigua(
        {"user_steamid": r.get("user_steamid"), "weapon": r.get("weapon"),
         "round": int(r["total_rounds_played"]) + 1}
        for r in fogo.to_dict("records")
    )

    win_panel = parser.parse_event("cs_win_panel_match")
    end_tick = (
        int(win_panel["tick"].iloc[0]) - 100 if len(win_panel) else int(deaths["tick"].max())
    )

    # Times fixos A/B pelo primeiro freeze_end. team_clan_name vem junto (só partida de
    # pro/LAN costuma trazer nome de clã) pra extrair o nome de cada lado (_nomes_de_time).
    snap0 = parser.parse_ticks(["team_num", "team_clan_name"], ticks=[first_freeze])
    fixed = {}
    for r in snap0.to_dict("records"):
        team_num = _num(r.get("team_num"))
        sid = _sid(r.get("steamid"))
        if sid and team_num is not None:
            fixed[sid] = _team_letter(team_num)
    nome_a, nome_b = _nomes_de_time(snap0.to_dict("records"), fixed)

    # Economia por round×time: soma do equipamento dos 5 jogadores no fim do freezetime
    # (current_equip_value), classificada no esquema HLTV (_tipo_de_compra). Best-effort:
    # se o nome de campo não bater numa versão do demoparser2, cai pra lista vazia em
    # vez de derrubar o ingest inteiro (mesmo padrão de player_blind acima).
    # player_round_econ é o MESMO current_equip_value já lido pra somar o round_econ por
    # time — só não descartamos mais o valor individual. buy_type por jogador usa a mesma
    # classificação HLTV do time (_tipo_de_compra), só que sobre o gasto individual dele.
    round_econ = []
    player_round_econ = []
    lado_por_round = {}  # round_number -> "CT"/"T" que o time FIXO A ocupava (FIL-51)
    try:
        tick_to_round = {int(t): int(rn) + 1 for t, rn in zip(freeze["tick"], freeze["total_rounds_played"])}
        # team_num no mesmo snapshot da econ (já é um parse_ticks nesses ticks mesmo) —
        # dá o lado FÍSICO (CT/T) de cada jogador naquele round, sem custo extra de parse.
        econ_df = parser.parse_ticks(["current_equip_value", "team_num"], ticks=sorted(tick_to_round.keys()))
        soma = {}  # (round_number, team) -> equip_value somado
        for r in econ_df.to_dict("records"):
            sid = _sid(r.get("steamid"))
            time = fixed.get(sid)
            equip = _num(r.get("current_equip_value"))
            rn = tick_to_round.get(int(r["tick"]))
            if not time or equip is None or rn is None:
                continue
            soma[(rn, time)] = soma.get((rn, time), 0) + equip
            if sid:
                player_round_econ.append({
                    "round_number": rn, "steam_id64": sid, "team": time,
                    "equip_value": equip, "buy_type": _tipo_de_compra(equip),
                })
            if time == "A" and rn not in lado_por_round:
                lado = _lado_de_team_num(_num(r.get("team_num")))
                if lado:
                    lado_por_round[rn] = lado
        round_econ = [
            {"round_number": rn, "team": time, "equip_value": equip, "buy_type": _tipo_de_compra(equip)}
            for (rn, time), equip in soma.items()
        ]
    except Exception:  # noqa: BLE001
        pass

    # Itens comprados por round×jogador — event bruto, sem agregação (a UI decide como
    # agrupar). Campos confirmados lendo o código-fonte do demoparser2 (create_custom_
    # event_weapon_purchase em second_pass/game_events.rs): o item_purchase NASCE com
    # "steamid" puro (não "user_steamid" — ele não passa pela tradução userid→user_*
    # que outros eventos como player_death/weapon_fire recebem) e o nome do item vem em
    # "item_name" (não "item"/"weapon"). "cost" é o preço pago POR ESSE item específico.
    purchases = []
    try:
        compras_evt = parser.parse_event("item_purchase", other=["total_rounds_played"])
        for r in compras_evt.to_dict("records"):
            sid = _sid(r.get("steamid"))
            item = r.get("item_name")
            rn = r.get("total_rounds_played")
            if not sid or not item or rn is None:
                continue
            purchases.append({
                "round_number": int(rn) + 1, "steam_id64": sid,
                "item": str(item), "cost": _num(r.get("cost")), "tick": _num(r.get("tick")),
            })
        purchases = _filtrar_ecos_de_compra(purchases)
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
                "assister": ast,
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
            # active_weapon_name: o que a VÍTIMA tinha na mão ao morrer — diferente de
            # "weapon" (a arma do ATACANTE, usada pra matar). Responde "eu morri de AWP
            # mas eu tava jogando de pistola" sem confundir com a arma de quem matou.
            pos_df = parser.parse_ticks(["X", "Y", "active_weapon_name"], ticks=death_ticks)
            pos_by_sid_tick = {}
            for r in pos_df.to_dict("records"):
                sid = _sid(r.get("steamid"))
                x, y = _flt(r.get("X")), _flt(r.get("Y"))
                if sid and x is not None and y is not None:
                    pos_by_sid_tick[(sid, int(r["tick"]))] = (x, y, _txt(r.get("active_weapon_name")))
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
                        "assister": k["assister"],
                        "weapon": k["weapon"],
                        "victim_weapon": vic_pos[2],
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
    # `damage` (o que vira ADR em toda a UI) é SÓ dano em INIMIGO — mesma comparação
    # com o Leetify de 2026-07-11 que motivou separar he_damage/molotov_damage de
    # he_team_damage/molotov_team_damage também vale pro dano de bala: sem esse filtro,
    # fogo amigo (bala ou granada não-HE/molotov acertando aliado) inflava o ADR de
    # quem tomava/dava dano em aliado (achado real: ADR 140.1 no nosso site vs 107 no
    # Leetify pro mesmo jogador na mesma partida). `team_damage` guarda esse fogo amigo
    # à parte, pro caso de algum dia querer expor/investigar. utility_damage continua
    # sendo a soma de TUDO (inimigo + time), pro stat tile antigo "Dano utilitária" não
    # mudar de significado.
    damage, team_damage, utility_damage, shots_hit = {}, {}, {}, {}
    he_damage, molotov_damage = {}, {}
    he_team_damage, molotov_team_damage = {}, {}
    # Dano em inimigo por (round, atacante) — base do filtro T/CT dentro da Partida
    # (FIL-51b): sem isso, ADR/rating filtrado por lado não tem como ser recalculado,
    # só o total da partida inteira estava disponível antes.
    round_damage = {}
    # Dano por PAR (quem bateu em quem, com quê) — base do "Head to Head": o player_hurt
    # já carrega atacante+vítima+arma+dano, só nunca guardávamos o par, só o total do
    # atacante. Chave (atacante, vítima, arma) pra já vir separado por arma na consulta.
    damage_pares = {}
    for r in hurt.to_dict("records"):
        atk = _sid(r.get("attacker_steamid"))
        if not atk:
            continue
        dmg = int(r["dmg_health"])
        vic = _sid(r.get("user_steamid"))
        arma = r.get("weapon")
        rn = int(r["total_rounds_played"]) + 1
        time_kill = bool(vic and fixed.get(atk) == fixed.get(vic))
        if time_kill:
            team_damage[atk] = team_damage.get(atk, 0) + dmg
        else:
            damage[atk] = damage.get(atk, 0) + dmg
            round_damage[(rn, atk)] = round_damage.get((rn, atk), 0) + dmg
        if arma in _ARMAS_UTILITARIAS:
            utility_damage[atk] = utility_damage.get(atk, 0) + dmg
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
            arma_par = _arma_limpa(arma) or str(arma)
        elif _eh_arma_de_fogo(arma):
            shots_hit[atk] = shots_hit.get(atk, 0) + 1
            round_no = int(r["total_rounds_played"]) + 1
            arma_resolvida = _resolver_arma_hurt(mapa_variante, atk, round_no, _arma_limpa(arma))
            slot = weapon_slot(atk, arma_resolvida)
            slot["shots_hit"] += 1
            if not time_kill:
                slot["damage"] += dmg
            arma_par = arma_resolvida
        else:
            arma_par = _arma_limpa(arma) or str(arma)
        if vic:
            chave = (atk, vic, arma_par)
            par = damage_pares.setdefault(chave, {"damage": 0, "hits": 0})
            par["damage"] += dmg
            par["hits"] += 1

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
            # weapon_fire distingue m4a1/m4a1_silencer (etc.) certinho — sem alias
            # nenhum aqui, `arma` (já sem prefixo) é o bucket certo direto.
            weapon_slot(sid, arma)["shots_fired"] += 1
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
    # Flashes por PAR (quem cegou quem) — mesma ideia do damage_pares acima, pra
    # alimentar o Head to Head ("flashes que X deu em Y"). Conta as duas direções
    # (aliado ou não), o consumidor decide o que exibir.
    flash_pares = {}
    for (thrower, tick0), vitimas in flashbangs.items():
        creditou_assist = False
        maior_duracao_inimigo = 0.0
        for v in vitimas:
            if not v["aliado"]:
                maior_duracao_inimigo = max(maior_duracao_inimigo, v["duracao"])
            if v["duracao"] <= LIMIAR_CEGUEIRA_S:
                continue  # meio-cego não conta em nada (nem contagem, nem assist)
            par = flash_pares.setdefault((thrower, v["vitima"]), {"count": 0, "duracao": 0.0})
            par["count"] += 1
            par["duracao"] += v["duracao"]
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

    # Premier: mesmo tick (end_tick) onde o placar final já é lido acima. Best-effort —
    # se o replay não tiver esses campos (Wingman/Competitivo por mapa/Partida Pro),
    # cai pra dict vazio em vez de derrubar o ingest inteiro (mesmo padrão do round_econ).
    premier = {}
    try:
        premier_snap = parser.parse_ticks(
            ["rank", "rank_if_win", "rank_if_loss", "rank_if_tie"], ticks=[end_tick],
        )
        premier = _premier_ratings(premier_snap.to_dict("records"), fixed, score)
    except Exception:  # noqa: BLE001
        pass

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
            "premier_rating_before": premier.get(sid, {}).get("before"),
            "premier_rating_after": premier.get(sid, {}).get("after"),
        }
        for sid, ft in fixed.items()
        if sid
    ]

    # Rounds: vencedor por delta de team_rounds_total nos ticks de fim de round, com o
    # round decisivo completado a partir do placar final (ver _construir_rounds).
    ended = parser.parse_event("round_officially_ended", other=["total_rounds_played"])
    end_ticks = sorted({int(t) for t in ended["tick"].tolist()})
    by_tick = {}
    if end_ticks:
        snaps = parser.parse_ticks(["team_rounds_total"], ticks=end_ticks)
        for r in snaps.to_dict("records"):
            ft = fixed.get(_sid(r.get("steamid")))
            total = _num(r.get("team_rounds_total"))
            if ft and total is not None:
                by_tick.setdefault(int(r["tick"]), {})[ft] = total
    rounds = _construir_rounds(end_ticks, by_tick, score, lado_por_round=lado_por_round)

    # Abandono: ver docstring de _detectar_abandono. Best-effort — parse_event pode
    # não achar o evento numa versão antiga do demo; cai pra "sem dado" (mesmo padrão
    # de round_econ/purchases/blind acima) em vez de derrubar o ingest inteiro.
    try:
        disc_evt = parser.parse_event("player_disconnect")
        disconnects = [
            {"steam_id64": _sid(r.get("user_steamid")), "tick": int(r["tick"])}
            for r in disc_evt.to_dict("records")
        ]
    except Exception:  # noqa: BLE001
        disconnects = []
    ended_early, abandoned_by = _detectar_abandono(score, end_ticks, disconnects, kills)

    played_at = datetime.datetime.fromtimestamp(
        os.path.getmtime(path), tz=datetime.timezone.utc
    ).isoformat()

    player_damage = [
        {"attacker": atk, "victim": vic, "weapon": arma, "damage": v["damage"], "hits": v["hits"]}
        for (atk, vic, arma), v in damage_pares.items()
    ]
    player_flashes = [
        {"attacker": atk, "victim": vic, "count": v["count"], "duration_sum": round(v["duracao"], 2)}
        for (atk, vic), v in flash_pares.items()
    ]
    player_round_damage = [
        {"round_number": rn, "steam_id64": atk, "damage": dmg}
        for (rn, atk), dmg in round_damage.items()
    ]

    return {
        "map": mapa,
        "score_a": score["A"],
        "score_b": score["B"],
        "team_a_name": nome_a,
        "team_b_name": nome_b,
        "played_at": played_at,
        "rounds": rounds,
        "players": players,
        "kills": kills,
        "round_econ": round_econ,
        "player_round_econ": player_round_econ,
        "purchases": purchases,
        "player_damage": player_damage,
        "player_flashes": player_flashes,
        "kill_positions": kill_positions,
        "player_round_damage": player_round_damage,
        "ended_early": ended_early,
        "abandoned_by": abandoned_by,
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
                # Lado REAL (CT/T) nesse tick específico — ao contrário de "team" acima,
                # esse troca no intervalo de propósito (pedido do usuário: mapa de calor
                # filtrar "morreu avançando de CT", que só faz sentido com o lado de
                # verdade daquele momento, não o time fixo A/B).
                "side": "T" if team_num == 2 else "CT",
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
                # _arma_limpa por segurança (remove prefixo "weapon_" se vier — sem
                # isso, categoriaArma() no client não bate nenhuma arma no dicionário e
                # o ícone do Replay 2D cai sempre no formato de pistola por padrão,
                # não importa a arma real; achado pelo usuário, 2026-07-13).
                "weapon": _arma_limpa(r.get("weapon")) or "",
                "headshot": bool(r.get("headshot")),
            }
        )

    # Tiros que ACERTARAM alguém mas não mataram (pedido do usuário: traçado de bala
    # em todo tiro, não só nos kills — miss não dá pra traçar sem simular física de
    # bala contra o mapa, que não temos; hit é o que dá pra mostrar de verdade).
    # Dedupe do hit fatal: mesmo (vítima, tick) já vem em `kills` (player_death e
    # player_hurt disparam no MESMO tick pro dano que mata, confirmado empírico).
    kills_por_vitima_tick = {(k["victim"], k["tick"]) for k in kills}

    # weapon_fire distingue as duplas ambíguas (m4a1/m4a1_silencer, usp_silencer/
    # hkp2000, revolver/deagle) certinho — o player_hurt abaixo não (ver comentário
    # de _GENERICA_POR_PRECISA em cima). Usado só pra corrigir o ícone/traçado do hit.
    fogo = parser.parse_event("weapon_fire")
    if inicios:
        # Sem esse corte, tiro de warmup (fora de qualquer round real) cairia no
        # ÚLTIMO round via o fallback de round_do_tick — podendo poluir o mapa da
        # dupla ambígua nesse round com uma arma que só foi testada no warmup.
        fogo = fogo[fogo["tick"] >= inicios[0]]
    mapa_variante = _mapa_variante_ambigua(
        {"user_steamid": r.get("user_steamid"), "weapon": r.get("weapon"),
         "round": round_do_tick(int(r["tick"]))}
        for r in fogo.to_dict("records")
    )

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
        rn = round_do_tick(tk)
        arma = _resolver_arma_hurt(mapa_variante, atk, rn, _arma_limpa(r.get("weapon")) or "")
        hits.append(
            {
                "round": rn,
                "tick": tk,
                "killer": atk,
                "victim": vic,
                "weapon": arma,
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

    # Posição/ângulo de ORIGEM do arremesso (base pra biblioteca de lineup): o evento de
    # detonação só traz onde a granada explodiu, não de onde foi jogada. Pra isso casamos
    # com o weapon_fire do MESMO jogador (weapon_fire não tem entityid — ver
    # _casar_arremesso_com_detonacao pro critério de correlação, confirmado contra demo
    # real) e depois consultamos a posição dele no tick do fire.
    _fogo_de_granada = evento("weapon_fire")

    def _fires_de(*armas):
        saida = []
        for r in _fogo_de_granada:
            if r.get("weapon") not in armas:
                continue
            sid = _sid(r.get("user_steamid"))
            if not sid:
                continue
            saida.append({"tick": int(r["tick"]), "thrower": sid})
        return saida

    fires_por_tipo = {
        "smokegrenade_detonate": _fires_de("weapon_smokegrenade"),
        "inferno_startburn": _fires_de("weapon_molotov", "weapon_incgrenade"),
        "flashbang_detonate": _fires_de("weapon_flashbang"),
        "hegrenade_detonate": _fires_de("weapon_hegrenade"),
    }
    fire_ticks_unicos = sorted({f["tick"] for lst in fires_por_tipo.values() for f in lst})
    # Snapshot batched (uma chamada só) da posição/ângulo do arremessador em cada tick de
    # fire — mesmo padrão de performance já usado pro snapshot de team_num acima.
    snap_fire = {}
    if fire_ticks_unicos:
        df_fire = parser.parse_ticks(["X", "Y", "yaw", "pitch", "team_num"], ticks=fire_ticks_unicos)
        for r in df_fire.to_dict("records"):
            sid = _sid(r.get("steamid"))
            if not sid:
                continue
            # Lado REAL (T/CT) no momento do arremesso — team_num aqui é o lado atual
            # daquele tick (não o time fixo A/B).
            lado = _lado_de_team_num(_num(r.get("team_num")))
            snap_fire[(int(r["tick"]), sid)] = {
                "x": _flt(r.get("X")),
                "y": _flt(r.get("Y")),
                "yaw": _flt(r.get("yaw")),
                "pitch": _flt(r.get("pitch")),
                "lado": lado,
            }

    def _dados_arremesso(ev_detonate, detonates):
        """{(detonate_tick, thrower): {thrower, throwerX, throwerY, throwerYaw,
        throwerPitch, throwerLado}} — None nos campos quando não achou fire
        correspondente ou a posição dele naquele tick (ex.: desconectado)."""
        casados = _casar_arremesso_com_detonacao(fires_por_tipo[ev_detonate], detonates)
        saida = {}
        for d in detonates:
            chave = (d["tick"], d["thrower"])
            fire_tick = casados.get(chave)
            pos = snap_fire.get((fire_tick, d["thrower"])) if fire_tick is not None else None
            saida[chave] = {
                "thrower": d["thrower"],
                "throwerX": pos["x"] if pos else None,
                "throwerY": pos["y"] if pos else None,
                "throwerYaw": pos["yaw"] if pos else None,
                "throwerPitch": pos["pitch"] if pos else None,
                "throwerLado": pos["lado"] if pos else None,
            }
        return saida

    _SEM_ARREMESSO = {
        "thrower": None,
        "throwerX": None,
        "throwerY": None,
        "throwerYaw": None,
        "throwerPitch": None,
        "throwerLado": None,
    }

    # Smokes e fogo: casa detonate/startburn com expired pelo entityid (duração real),
    # com teto na duração oficial do CS2 quando não casa ou casa errado — ver
    # _casar_fim_de_granada (correção do bug de tickEnd absurdo, 2026-07-14).
    def granadas_com_duracao(ev_ini, ev_fim, dur_padrao_s):
        regs_ini = evento(ev_ini)
        regs_fim = evento(ev_fim)
        cap_ticks = round(dur_padrao_s * 64)
        folga_ticks = round(_FOLGA_DURACAO_S * 64)
        tick_ends = _casar_fim_de_granada(
            [{"tick": int(r["tick"]), "entityid": r.get("entityid")} for r in regs_ini],
            [{"tick": int(r["tick"]), "entityid": r.get("entityid")} for r in regs_fim],
            cap_ticks,
            folga_ticks,
        )

        detonates = []
        for r in regs_ini:
            sid = _sid(r.get("user_steamid"))
            if sid:
                detonates.append({"tick": int(r["tick"]), "thrower": sid})
        arremessos = _dados_arremesso(ev_ini, detonates)

        saida = []
        for r, t1 in zip(regs_ini, tick_ends):
            x, y = _xy(r)
            t0 = int(r["tick"])
            sid = _sid(r.get("user_steamid"))
            item = {"round": round_do_tick(t0), "x": x, "y": y, "tickStart": t0, "tickEnd": t1}
            item.update(arremessos.get((t0, sid), _SEM_ARREMESSO))
            saida.append(item)
        return saida

    smokes = granadas_com_duracao("smokegrenade_detonate", "smokegrenade_expired", DURACAO_SMOKE_S)
    fires = granadas_com_duracao("inferno_startburn", "inferno_expire", DURACAO_FOGO_S)

    def granadas_instantaneas(nome):
        regs = evento(nome)
        detonates = []
        for r in regs:
            sid = _sid(r.get("user_steamid"))
            if sid:
                detonates.append({"tick": int(r["tick"]), "thrower": sid})
        arremessos = _dados_arremesso(nome, detonates)

        saida = []
        for r in regs:
            x, y = _xy(r)
            t0 = int(r["tick"])
            sid = _sid(r.get("user_steamid"))
            item = {"round": round_do_tick(t0), "x": x, "y": y, "tick": t0}
            item.update(arremessos.get((t0, sid), _SEM_ARREMESSO))
            saida.append(item)
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
