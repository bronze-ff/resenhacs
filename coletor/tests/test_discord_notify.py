import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coletor import discord_notify


def _resumo(**overrides):
    base = {
        "map": "de_mirage", "score_grupo": 13, "score_rival": 9,
        "mvp_nick": "fulano", "mvp_rating": 1.45,
    }
    base.update(overrides)
    return base


def test_montar_embed_vitoria_e_verde():
    payload = discord_notify.montar_embed(_resumo(), "m1", "https://resenha-phi.vercel.app")
    embed = payload["embeds"][0]
    assert embed["title"] == "Vitória 13×9 no de_mirage"
    assert embed["color"] == discord_notify.COR_VITORIA
    assert embed["url"] == "https://resenha-phi.vercel.app/partidas/m1"
    assert "fulano" in embed["description"]
    assert "1.45" in embed["description"]
    assert embed["footer"] == {"text": "Resenha"}


def test_montar_embed_derrota_e_vermelho():
    payload = discord_notify.montar_embed(
        _resumo(score_grupo=5, score_rival=13), "m1", "https://x.com",
    )
    embed = payload["embeds"][0]
    assert embed["title"] == "Derrota 5×13 no de_mirage"
    assert embed["color"] == discord_notify.COR_DERROTA


def test_montar_embed_empate_e_cinza():
    payload = discord_notify.montar_embed(
        _resumo(score_grupo=12, score_rival=12), "m1", "https://x.com",
    )
    embed = payload["embeds"][0]
    assert embed["title"] == "Empate 12×12 no de_mirage"
    assert embed["color"] == discord_notify.COR_EMPATE


def test_montar_embed_sem_mvp_omite_descricao():
    payload = discord_notify.montar_embed(
        _resumo(mvp_nick=None, mvp_rating=None), "m1", "https://x.com",
    )
    embed = payload["embeds"][0]
    assert "description" not in embed


def test_enviar_webhook_chama_http_post_com_url_e_payload():
    chamadas = []
    discord_notify.enviar_webhook(
        "https://discord.com/api/webhooks/x/y",
        {"embeds": []},
        http_post=lambda url, payload: chamadas.append((url, payload)),
    )
    assert chamadas == [("https://discord.com/api/webhooks/x/y", {"embeds": []})]


def test_enviar_webhook_propaga_excecao_do_http_post():
    def _explode(url, payload):
        raise RuntimeError("Discord respondeu 404")

    import pytest
    with pytest.raises(RuntimeError, match="404"):
        discord_notify.enviar_webhook("https://x", {}, http_post=_explode)
