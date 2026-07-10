"""Codec dos share codes de matchmaking da Valve (CSGO-xxxxx-xxxxx-...).

Um Share Code identifica uma Partida e carrega match_id, reservation_id e tv_port.
O Coletor usa a Steam Web API (GetNextMatchSharingCode) para andar a corrente de
share codes de um Jogador; cada código decodificado identifica uma Partida nova.
"""

DICTIONARY = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
_BASE = len(DICTIONARY)  # 57


def decode(share_code: str) -> dict:
    """Decodifica 'CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx' em ids inteiros."""
    cleaned = share_code.replace("CSGO-", "").replace("-", "")
    if len(cleaned) != 25:
        raise ValueError(f"Share code inválido: {share_code!r}")
    big = 0
    for ch in reversed(cleaned):
        idx = DICTIONARY.find(ch)
        if idx < 0:
            raise ValueError(f"Caractere inválido no share code: {ch!r}")
        big = big * _BASE + idx
    data = big.to_bytes(18, byteorder="big")
    return {
        "match_id": int.from_bytes(data[0:8], "little"),
        "reservation_id": int.from_bytes(data[8:16], "little"),
        "tv_port": int.from_bytes(data[16:18], "little"),
    }


def encode(match_id: int, reservation_id: int, tv_port: int) -> str:
    """Inverso de decode(): monta o share code a partir dos ids."""
    data = (
        int(match_id).to_bytes(8, "little")
        + int(reservation_id).to_bytes(8, "little")
        + int(tv_port).to_bytes(2, "little")
    )
    big = int.from_bytes(data, "big")
    chars = []
    for _ in range(25):
        chars.append(DICTIONARY[big % _BASE])
        big //= _BASE
    cleaned = "".join(chars)
    grupos = [cleaned[i : i + 5] for i in range(0, 25, 5)]
    return "CSGO-" + "-".join(grupos)


def is_valid(share_code: str) -> bool:
    try:
        decode(share_code)
        return True
    except (ValueError, TypeError):
        return False
