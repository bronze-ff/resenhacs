"""Sincronização FACEIT (comando `sincronizar-faceit`).

Três etapas por rodada, cada item isolado (falha de um não derruba os outros):

1. Descoberta: /players/{id}/history com `from` = Partida FACEIT mais recente
   conhecida do membro menos MARGEM_DESCOBERTA (ou o histórico inteiro na primeira
   varredura), paginando até o fim.
2. Processamento da fila: Demo pelo pipeline completo quando o download funciona;
   senão a Partida entra na hora só com as estatísticas da API e fica agendada pra
   re-tentar a Demo.
3. Re-tentativa da Demo: enquanto a Demo existe na FACEIT (~4 semanas), tenta de novo
   de forma espaçada. Se passar (ex.: a chave ganhou acesso à Downloads API), a Demo
   é ingerida NA MESMA Partida via ingest_demo(alvo=...).

Depois vem o ELO, igual antes. Logs saem num repositório público: SteamID, id FACEIT e
id de partida só passam por `ref` (hash curto).
"""

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import discord
from . import db as dbmod
from . import faceit

MARGEM_DESCOBERTA = timedelta(days=3)
JANELA_DEMO = timedelta(days=28)
LIMITE_RETRY_POR_RODADA = 3
# Espera depois da n-ésima falha: logo depois da Partida a Demo às vezes ainda não
# está pronta, então as duas primeiras voltas são curtas; depois, 1x por dia.
_ESPERAS_RETRY = (timedelta(hours=1), timedelta(hours=6))
_ESPERA_DIARIA = timedelta(days=1)

MSG_SEM_ACESSO = (
    "sincronizar-faceit: Downloads API sem acesso (403) — a FACEIT_API_KEY não tem a "
    "aprovação pra baixar Demos. As Partidas entram só com estatísticas básicas e a Demo "
    "é re-tentada 1x por dia por até 4 semanas. Como pedir: docs/operacao.md, seção FACEIT."
)


def espera_retry(tentativas_demo):
    """Quanto esperar depois da `tentativas_demo`-ésima falha (1-based)."""
    if 1 <= tentativas_demo <= len(_ESPERAS_RETRY):
        return _ESPERAS_RETRY[tentativas_demo - 1]
    return _ESPERA_DIARIA


def _para_dt(valor):
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)
    return datetime.fromtimestamp(int(valor), tz=timezone.utc)


class _Rodada:
    def __init__(self, ref):
        self.ref = ref
        self.sem_acesso = False
        self.com_demo = 0
        self.stats_only = 0
        self.agendadas = 0
        self.recuperadas = 0

    def registrar_erro_demo(self, faceit_match_id, erro):
        if faceit.sem_acesso_downloads(erro):
            if not self.sem_acesso:
                print(MSG_SEM_ACESSO)
            self.sem_acesso = True
            return
        print(f"  {self.ref(faceit_match_id)}: Demo falhou ({type(erro).__name__}: {erro})")


def _baixar_e_ingerir(config, conn, ingest_demo, demo_url, played_at, source, alvo=None):
    dem_bytes = faceit.baixar_demo(config.faceit_api_key, demo_url)
    with tempfile.TemporaryDirectory() as tmp:
        dem_path = Path(tmp) / "faceit.dem"
        dem_path.write_bytes(dem_bytes)
        return ingest_demo(
            config, conn, dem_path, share_code=None, source=source, upload=True,
            played_at=played_at, **({"alvo": alvo} if alvo is not None else {}),
        )


def descobrir(config, conn, vinculados, ref, agora):
    conhecidas = dbmod.faceit_match_ids_conhecidos(conn)
    for steam_id64, faceit_id in vinculados:
        try:
            ultimo = _para_dt(dbmod.ultimo_finished_at_faceit(conn, steam_id64))
            desde = int((ultimo - MARGEM_DESCOBERTA).timestamp()) if ultimo else None
            res = faceit.listar_historico_5v5(
                config.faceit_api_key, faceit_id, conhecidas, desde=desde,
                ate=int(agora.timestamp()),
            )
            for item in res["novas"]:
                dbmod.enfileirar_faceit(
                    conn, item["faceit_match_id"], steam_id64, item.get("finished_at"),
                )
                conhecidas.add(item["faceit_match_id"])
            dbmod.marcar_membro_sincronizado_faceit(conn, steam_id64)
            janela = "histórico inteiro" if desde is None else (
                "desde " + datetime.fromtimestamp(desde, tz=timezone.utc).strftime("%Y-%m-%d"))
            print(
                f"  descoberta {ref(steam_id64)} ({janela}): {res['na_api']} na API / "
                f"{res['ja_conhecidas']} já conhecida(s) / {len(res['novas'])} nova(s)"
                + (f" / {res['ignoradas']} fora de 5v5" if res["ignoradas"] else "")
            )
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  descoberta {ref(steam_id64)}: FALHOU ({type(e).__name__}: {e})")


def processar_fila(config, conn, ingest_demo, rodada, agora, limite):
    ingeridas_por_membro = {}
    total = 0
    for faceit_match_id, steam_id64, _tentativas in dbmod.listar_faceit_pendentes(conn, limite):
        r = rodada.ref(faceit_match_id)
        try:
            detalhes = faceit.detalhes_partida(config.faceit_api_key, faceit_match_id)
            stats = faceit.stats_partida(config.faceit_api_key, faceit_match_id)
            finished = _para_dt(detalhes.get("finished_at"))
            played_at = finished.isoformat() if finished else None

            match_id = None
            demo_urls = detalhes.get("demo_url") or []
            erro_demo = None
            if demo_urls and not rodada.sem_acesso:
                try:
                    match_id = _baixar_e_ingerir(
                        config, conn, ingest_demo, demo_urls[0], played_at, "faceit",
                    )
                except Exception as e:  # noqa: BLE001
                    conn.rollback()
                    erro_demo = e
                    rodada.registrar_erro_demo(faceit_match_id, e)
            elif demo_urls:
                erro_demo = "Downloads API sem acesso"

            com_demo = match_id is not None
            if not com_demo:
                parsed = faceit.montar_parsed_stats_only(detalhes, stats)
                match_id = dbmod.store_parsed(
                    conn, parsed, source="faceit",
                    prefer_new_played_at=bool(parsed.get("played_at")),
                )
                dbmod.gravar_extras_faceit(conn, match_id, parsed.get("players", []))
                # ingest_demo já avisa no caminho com demo; aqui é o único aviso desta
                # Partida (e a trava discord_notificado_em evita repetir quando a demo
                # chegar depois pelo retry).
                try:
                    discord.notificar_partida(conn, match_id)
                except Exception:  # noqa: BLE001 — aviso nunca derruba a importação
                    pass

            dbmod.marcar_faceit_match(conn, match_id, faceit_match_id)
            dbmod.concluir_faceit_pendente(conn, faceit_match_id)

            if com_demo:
                rodada.com_demo += 1
                print(f"  {r}: ok com Demo")
            else:
                rodada.stats_only += 1
                dentro_da_janela = finished is None or agora - finished < JANELA_DEMO
                # Sem demo_url no primeiro detalhe também entra na fila: a FACEIT costuma
                # publicar a URL da demo um tempo depois do fim da partida.
                if dentro_da_janela:
                    dbmod.agendar_retry_demo(
                        conn, faceit_match_id, agora + espera_retry(1), 1,
                        erro_demo or "Demo ainda não disponível na FACEIT",
                    )
                    rodada.agendadas += 1
                    print(f"  {r}: ok só com estatísticas — Demo agendada pra nova tentativa")
                else:
                    print(f"  {r}: ok só com estatísticas")

            ingeridas_por_membro.setdefault(steam_id64, []).append((match_id, finished))
            total += 1
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            dbmod.falhar_faceit_pendente(conn, faceit_match_id, e)
            print(f"  {r}: FALHOU ({type(e).__name__}: {e})")
    return total, ingeridas_por_membro


def retentar_demos(config, conn, ingest_demo, rodada, agora, erros_definitivos=()):
    for (faceit_match_id, _steam, tentativas_demo, finished_at, match_id,
         tem_demo) in dbmod.listar_retries_demo(conn, agora, LIMITE_RETRY_POR_RODADA):
        r = rodada.ref(faceit_match_id)
        finished = _para_dt(finished_at)
        if match_id is None or tem_demo:
            # Demo já chegou por outro caminho (envio manual) ou a Partida sumiu.
            dbmod.encerrar_retry_demo(conn, faceit_match_id)
            continue
        if finished is not None and agora - finished >= JANELA_DEMO:
            dbmod.encerrar_retry_demo(conn, faceit_match_id, "Demo expirou na FACEIT (4 semanas)")
            print(f"  {r}: Demo fora da janela de 4 semanas — fica só com estatísticas")
            continue
        n = (tentativas_demo or 0) + 1
        if rodada.sem_acesso:
            dbmod.agendar_retry_demo(
                conn, faceit_match_id, agora + espera_retry(n), n, "Downloads API sem acesso",
            )
            continue
        try:
            detalhes = faceit.detalhes_partida(config.faceit_api_key, faceit_match_id)
            demo_urls = detalhes.get("demo_url") or []
            if not demo_urls:
                # Ainda sem URL: tenta de novo mais tarde (a janela de 4 semanas acima
                # encerra quando a demo já não pode mais existir).
                dbmod.agendar_retry_demo(
                    conn, faceit_match_id, agora + espera_retry(n), n, "Demo ainda não disponível na FACEIT",
                )
                continue
            dados = dbmod.dados_da_partida_alvo(conn, match_id)
            if dados is None:
                dbmod.encerrar_retry_demo(conn, faceit_match_id)
                continue
            alvo = {
                "match_id": match_id, "map": dados["map"], "steam_ids": dados["steam_ids"],
                "score_a": dados["score_a"], "score_b": dados["score_b"],
            }
            fin = _para_dt(detalhes.get("finished_at")) or finished
            _baixar_e_ingerir(
                config, conn, ingest_demo, demo_urls[0],
                fin.isoformat() if fin else None, dados.get("source") or "faceit", alvo=alvo,
            )
            dbmod.encerrar_retry_demo(conn, faceit_match_id)
            rodada.recuperadas += 1
            print(f"  {r}: Demo recuperada na tentativa {n}")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            if erros_definitivos and isinstance(e, erros_definitivos):
                dbmod.encerrar_retry_demo(conn, faceit_match_id, e)
                print(f"  {r}: Demo não confere com a Partida ({e}) — re-tentativa encerrada")
                continue
            rodada.registrar_erro_demo(faceit_match_id, e)
            dbmod.agendar_retry_demo(conn, faceit_match_id, agora + espera_retry(n), n, e)


def atualizar_elos(config, conn, vinculados, ingeridas_por_membro, ref):
    for steam_id64, faceit_id in vinculados:
        try:
            elo, level = faceit.elo_atual(config.faceit_api_key, faceit_id)
            if elo is None:
                continue
            antes, snapshot_em = dbmod.elo_snapshot(conn, steam_id64)
            alvo = faceit.escolher_partida_para_elo(
                ingeridas_por_membro.get(steam_id64, []), snapshot_em,
            )
            if alvo and antes is not None:
                dbmod.gravar_elo_partida(conn, alvo, steam_id64, antes, elo)
            dbmod.atualizar_elo(conn, steam_id64, elo, level)
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            print(f"  elo {ref(steam_id64)}: FALHOU ({type(e).__name__})")


def sincronizar(config, conn, ingest_demo, ref, limite=10, agora=None,
                erros_definitivos=()):
    """Roda a rodada inteira. Devolve quantas Partidas da fila foram processadas."""
    if not config.faceit_api_key:
        print("sincronizar-faceit: FACEIT_API_KEY ausente — pulando")
        return 0
    vinculados = dbmod.listar_vinculados_faceit(conn)
    if not vinculados:
        print("sincronizar-faceit: nenhum membro com FACEIT vinculada")
        return 0
    agora = agora or datetime.now(timezone.utc)
    rodada = _Rodada(ref)

    descobrir(config, conn, vinculados, ref, agora)
    total, ingeridas = processar_fila(config, conn, ingest_demo, rodada, agora, limite)
    retentar_demos(config, conn, ingest_demo, rodada, agora, erros_definitivos)
    atualizar_elos(config, conn, vinculados, ingeridas, ref)

    print(
        f"sincronizar-faceit: {total} partida(s) processada(s) "
        f"({rodada.com_demo} com Demo, {rodada.stats_only} só estatísticas, "
        f"{rodada.agendadas} agendada(s) pra re-tentar a Demo), "
        f"{rodada.recuperadas} Demo(s) recuperada(s)"
    )
    return total
