"""Campos extras da biblioteca automática de granadas (migration 0055).

Puro e testável: recebe o rdata cru de extract_replay (coordenadas de MUNDO) e o
replay_json já montado por replay.build_replay, e devolve o que _montar_lineups grava
além do radar 0..1 — posição de mundo do arremesso/alvo (pro comando `setpos` de
treino) e o frame do Replay 2D em que a granada estoura (pro link "Ver no Replay 2D").
"""

# chave do rdata -> (chave no round do replay_json, campo de frame do item)
_CHAVE_REPLAY = {
    "smokes": ("smokes", "tStart"),
    "fires": ("fires", "tStart"),
    "flashes": ("flashes", "t"),
    "hes": ("hes", "t"),
}


def _arred(v, casas=2):
    return None if v is None else round(float(v), casas)


def campos_mundo(g):
    """Coordenadas de mundo do arremesso e do alvo. Z pode faltar (demo antiga, evento
    sem z) — o valor vai None e a coluna nullable aceita; quem monta o comando de
    prática só usa a lineup que tiver X/Y/Z do arremesso."""
    return {
        "thrower_world_x": _arred(g.get("throwerX")),
        "thrower_world_y": _arred(g.get("throwerY")),
        "thrower_world_z": _arred(g.get("throwerZ")),
        "target_world_x": _arred(g.get("x")),
        "target_world_y": _arred(g.get("y")),
        "target_world_z": _arred(g.get("z")),
    }


def frames_por_granada(rdata, replay_json):
    """{(chave, posição na lista do rdata): frame} — frame do Replay 2D (índice dentro do
    round) do momento em que a granada estoura.

    build_replay agrupa as granadas por round PRESERVANDO a ordem do rdata, então a
    i-ésima smoke do round N no rdata é a i-ésima smoke do round N no replay_json. Se a
    contagem do round não bater (replay montado de outro rdata, round sem frames), não
    chuta: aquele round fica sem frame (o link abre no início do round)."""
    if not replay_json:
        return {}
    rounds = {r.get("round"): r for r in replay_json.get("rounds", [])}
    saida = {}
    for chave, (chave_replay, campo) in _CHAVE_REPLAY.items():
        lista = rdata.get(chave, [])
        por_round = {}
        for i, g in enumerate(lista):
            por_round.setdefault(g.get("round"), []).append(i)
        for rnd, indices in por_round.items():
            itens = (rounds.get(rnd) or {}).get(chave_replay) or []
            if len(itens) != len(indices):
                continue
            for pos, i in enumerate(indices):
                frame = itens[pos].get(campo)
                if frame is not None:
                    saida[(chave, i)] = int(frame)
    return saida
