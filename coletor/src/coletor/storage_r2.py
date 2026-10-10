"""Arquivamento de demos no Cloudflare R2 (S3-compatível). Ver ADR-0002.

O cliente boto3 é injetado nas funções, então a lógica de chave/upload é testável
com um fake. make_client() só é chamado em runtime.
"""

import gzip


def demo_key(match_id):
    """Chave do objeto no bucket para o .dem de uma Partida."""
    return f"demos/{match_id}.dem.bz2"


def replay_key(match_id):
    """Chave do índice do Replay 2D. O corpo é JSON; uploads novos vão gzip
    (ContentEncoding) e o browser descomprime no fetch().json()."""
    return f"replays/{match_id}.json"


def gzip_bytes(data):
    """Comprime o corpo que será gravado com ContentEncoding=gzip.

    mtime=0 deixa o resultado estável entre runs (o header gzip não carrega
    o relógio). Não altera a chave nem o Content-Type.
    """
    return gzip.compress(data, mtime=0)


def upload_bytes(client, bucket, key, data, content_type="application/octet-stream", content_encoding=None, if_match=None):
    params = {"Bucket": bucket, "Key": key, "Body": data, "ContentType": content_type}
    if content_encoding:
        params["ContentEncoding"] = content_encoding
    # If-Match: o PUT só conclui se o ETag ainda for o do HEAD. O R2 responde 412
    # se outra escrita (reprocess do Coletor) mudou o objeto no meio — aí o corpo
    # novo fica, e este backfill não grava cópia velha por cima.
    if if_match:
        params["IfMatch"] = if_match
    client.put_object(**params)
    return key


class ArquivoGrandeDemaisError(RuntimeError):
    """Objeto no R2 excede o teto de tamanho aceito pra baixar inteiro pra memória."""


def content_length(client, bucket, key):
    """HEAD no objeto — descobre o tamanho sem baixar o corpo. Usado ANTES de um
    download_bytes(..., max_bytes=...) pra decidir se vale a pena baixar."""
    return client.head_object(Bucket=bucket, Key=key)["ContentLength"]


def download_bytes(client, bucket, key, max_bytes=None):
    """Baixa um objeto de volta (reprocessamento: pega o .dem já arquivado sem
    precisar re-baixar da Valve, que expira o link em poucos minutos).

    `max_bytes` (opcional): auditoria finding #2 — nenhuma camada limitava o tamanho
    do .dem antes do upload manual (o PUT pré-assinado simples, ver site/server/src/
    routes/upload.js, não suporta uma condição real de Content-Length na assinatura).
    Quando informado, faz um HEAD (content_length) ANTES de baixar e levanta
    ArquivoGrandeDemaisError se o objeto for maior que o teto — evita carregar um
    arquivo gigante inteiro pra memória do runner só pra descobrir depois que era
    grande demais."""
    if max_bytes is not None:
        tamanho = content_length(client, bucket, key)
        if tamanho > max_bytes:
            raise ArquivoGrandeDemaisError(
                f"objeto {key} tem {tamanho} bytes, acima do teto de {max_bytes} bytes"
            )
    return client.get_object(Bucket=bucket, Key=key)["Body"].read()


def key_from_url(url, bucket):
    """Extrai a key de um demo_url/replay_url já gravado (endpoint/bucket/key) —
    usado no reprocessamento pra saber qual objeto baixar/sobrescrever sem depender
    de recalcular o nome (que pode mudar; ver ids['match_id'] em ingest_demo)."""
    marker = f"/{bucket}/"
    return url.split(marker, 1)[1] if marker in url else None


def delete_object(client, bucket, key):
    client.delete_object(Bucket=bucket, Key=key)


def configurar_cors(client, bucket, origens):
    """Regra de CORS pro bucket — sem ela o R2 recusa o PUT pré-assinado vindo de
    navegador (upload manual de demo pro na página Partidas Pro). Rodar uma vez."""
    client.put_bucket_cors(
        Bucket=bucket,
        CORSConfiguration={
            "CORSRules": [
                {
                    "AllowedOrigins": list(origens),
                    "AllowedMethods": ["PUT", "GET"],
                    "AllowedHeaders": ["content-type"],
                    "MaxAgeSeconds": 3600,
                }
            ]
        },
    )


def make_client(config):
    import boto3

    config.require("r2_account_id", "r2_access_key_id", "r2_secret_access_key")
    return boto3.client(
        "s3",
        endpoint_url=config.r2_endpoint,
        aws_access_key_id=config.r2_access_key_id,
        aws_secret_access_key=config.r2_secret_access_key,
        region_name="auto",
    )


# --- inventário e backfill de gzip (só leitura / overwrite da mesma chave) ---

REPLAY_PREFIX = "replays/"


def prefixo_topo(key):
    """Primeiro segmento do caminho. Objeto sem barra cai em '(raiz)'."""
    if not key or "/" not in key:
        return "(raiz)"
    return key.split("/", 1)[0]


def _iter_objetos(client, bucket, prefix=None):
    """ListObjectsV2 paginado. Sem Delimiter: a soma por prefixo inclui o que está aninhado."""
    token = None
    while True:
        kwargs = {"Bucket": bucket}
        if prefix is not None:
            kwargs["Prefix"] = prefix
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        for obj in page.get("Contents") or []:
            yield obj
        if not page.get("IsTruncated"):
            return
        token = page.get("NextContinuationToken")
        if not token:
            return


def _iter_multipart(client, bucket):
    """ListMultipartUploads paginado — uploads iniciados e nunca concluídos nem abortados."""
    key_marker = None
    upload_id_marker = None
    while True:
        kwargs = {"Bucket": bucket}
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if upload_id_marker:
            kwargs["UploadIdMarker"] = upload_id_marker
        page = client.list_multipart_uploads(**kwargs)
        for upload in page.get("Uploads") or []:
            yield upload
        if not page.get("IsTruncated"):
            return
        key_marker = page.get("NextKeyMarker")
        upload_id_marker = page.get("NextUploadIdMarker")
        if not key_marker and not upload_id_marker:
            return


def _fmt_bytes(n):
    valor = float(n)
    for unidade in ("B", "KB", "MB", "GB", "TB"):
        if valor < 1024 or unidade == "TB":
            if unidade == "B":
                return f"{int(valor)} B"
            return f"{valor:.2f} {unidade}"
        valor /= 1024
    return f"{n} B"


def inventariar(client, bucket):
    """Conta objetos e bytes por prefixo de topo, mais multipart incompletos.

    Só leitura: ListObjectsV2 + ListMultipartUploads. Não baixa corpo e não escreve.
    """
    por_prefixo = {}
    total_n = 0
    total_b = 0
    for obj in _iter_objetos(client, bucket):
        tamanho = int(obj.get("Size") or 0)
        prefixo = prefixo_topo(obj.get("Key") or "")
        n, b = por_prefixo.get(prefixo, (0, 0))
        por_prefixo[prefixo] = (n + 1, b + tamanho)
        total_n += 1
        total_b += tamanho
    prefixos = [
        {"prefixo": prefixo, "objetos": n, "bytes": b}
        for prefixo, (n, b) in sorted(por_prefixo.items(), key=lambda item: (-item[1][1], item[0]))
    ]
    multipart = []
    for upload in _iter_multipart(client, bucket):
        iniciado = upload.get("Initiated")
        if hasattr(iniciado, "isoformat"):
            iniciado = iniciado.isoformat()
        multipart.append({
            "key": upload.get("Key"),
            "upload_id": upload.get("UploadId"),
            "iniciado_em": iniciado,
        })
    return {
        "bucket": bucket,
        "prefixos": prefixos,
        "total": {"objetos": total_n, "bytes": total_b},
        "multipart_incompletos": multipart,
    }


def formatar_inventario(relatorio):
    linhas = [f"Inventário R2: {relatorio['bucket']}"]
    linhas.append(f"{'prefixo':<28} {'objetos':>10} {'bytes':>14}")
    for item in relatorio["prefixos"]:
        linhas.append(
            f"{item['prefixo']:<28} {item['objetos']:>10} {_fmt_bytes(item['bytes']):>14}"
        )
    total = relatorio["total"]
    linhas.append(f"{'TOTAL':<28} {total['objetos']:>10} {_fmt_bytes(total['bytes']):>14}")
    multipart = relatorio["multipart_incompletos"]
    linhas.append(f"multipart incompletos: {len(multipart)}")
    for upload in multipart:
        linhas.append(
            f"  {upload['key']}  upload_id={upload['upload_id']}  iniciado_em={upload['iniciado_em']}"
        )
    return "\n".join(linhas)


def _mensagem_falha_put(erro):
    """412/PreconditionFailed é corrida de ETag: o objeto novo ficou intacto."""
    resposta = getattr(erro, "response", None) or {}
    codigo = (resposta.get("Error") or {}).get("Code")
    status = (resposta.get("ResponseMetadata") or {}).get("HTTPStatusCode")
    if codigo == "PreconditionFailed" or status == 412:
        return "ETag mudou durante o backfill (If-Match); objeto novo foi preservado"
    return str(erro)


def _ja_gzip(encoding):
    if not encoding:
        return False
    partes = [parte.strip().lower() for parte in str(encoding).split(",")]
    return "gzip" in partes or "x-gzip" in partes


def comprimir_replays(client, bucket, dry_run=True, limit=None):
    """Regrava replays/{...} na MESMA chave com corpo gzip e ContentEncoding=gzip.

    dry_run (padrão) baixa e mede, sem put. Objeto que já tem ContentEncoding gzip
    é pulado (retomada idempotente) e não consome `limit`. `limit` conta só os que
    seriam/foram comprimidos.

    Nunca apaga. O put_object só acontece depois do gzip conferido por roundtrip,
    com If-Match no ETag do HEAD. Se o ETag mudou (reprocess concorrente) o R2
    recusa o PUT e o objeto novo permanece. Sem ETag no HEAD, não regrava.
    """
    if limit is not None and limit < 0:
        raise ValueError("limit deve ser >= 0")
    pulados = 0
    feitos = 0
    falhas = 0
    bytes_antes = 0
    bytes_depois = 0
    objetos = []
    interrompido = False
    for obj in _iter_objetos(client, bucket, prefix=REPLAY_PREFIX):
        # Para assim que a cota de compressões fecha — não segue dando HEAD no resto.
        # A próxima run retoma do início e pula quem já está gzip.
        if limit is not None and feitos >= limit:
            interrompido = True
            break
        key = obj.get("Key")
        try:
            head = client.head_object(Bucket=bucket, Key=key)
            if _ja_gzip(head.get("ContentEncoding")):
                tamanho = int(head.get("ContentLength") or obj.get("Size") or 0)
                pulados += 1
                objetos.append({
                    "key": key,
                    "acao": "pulado",
                    "bytes_antes": tamanho,
                    "bytes_depois": tamanho,
                })
                continue
            cru = client.get_object(Bucket=bucket, Key=key)["Body"].read()
            comprimido = gzip_bytes(cru)
            if gzip.decompress(comprimido) != cru:
                raise RuntimeError("roundtrip gzip não confere; objeto não foi regravado")
            if not dry_run:
                etag = head.get("ETag")
                if not etag:
                    raise RuntimeError("HEAD sem ETag; não regravei")
                upload_bytes(
                    client, bucket, key, comprimido,
                    content_type=head.get("ContentType") or "application/json",
                    content_encoding="gzip",
                    if_match=etag,
                )
            antes = len(cru)
            depois = len(comprimido)
            bytes_antes += antes
            bytes_depois += depois
            feitos += 1
            objetos.append({
                "key": key,
                "acao": "simulado" if dry_run else "gravado",
                "bytes_antes": antes,
                "bytes_depois": depois,
            })
        except Exception as e:  # noqa: BLE001 — uma chave ruim não aborta o resto
            falhas += 1
            objetos.append({"key": key, "acao": "falha", "erro": _mensagem_falha_put(e)})
    return {
        "bucket": bucket,
        "prefixo": REPLAY_PREFIX,
        "dry_run": dry_run,
        "limit": limit,
        "pulados": pulados,
        "comprimidos": feitos,
        "falhas": falhas,
        "bytes_antes": bytes_antes,
        "bytes_depois": bytes_depois,
        "interrompido_por_limit": interrompido,
        "objetos": objetos,
    }


def formatar_comprimir(relatorio):
    modo = "DRY-RUN" if relatorio["dry_run"] else "APLICAR"
    linhas = [f"comprimir-replays: {modo} limit={relatorio['limit']}"]
    for item in relatorio["objetos"]:
        acao = item["acao"]
        if acao == "pulado":
            linhas.append(f"PULADO {item['key']} (já gzip, {item['bytes_antes']} bytes)")
        elif acao == "falha":
            linhas.append(f"FALHA {item['key']}: {item['erro']}")
        else:
            linhas.append(
                f"{acao.upper()} {item['key']} {item['bytes_antes']} -> {item['bytes_depois']} bytes"
            )
    linhas.append(
        "resumo: "
        f"pulados={relatorio['pulados']} comprimidos={relatorio['comprimidos']} "
        f"falhas={relatorio['falhas']} "
        f"bytes_antes={relatorio['bytes_antes']} ({_fmt_bytes(relatorio['bytes_antes'])}) "
        f"bytes_depois={relatorio['bytes_depois']} ({_fmt_bytes(relatorio['bytes_depois'])}) "
        "(só os objetos comprimidos nesta run)"
    )
    if relatorio["interrompido_por_limit"]:
        linhas.append("interrompido pelo --limit; rode de novo pra continuar (os já gzip são pulados)")
    return "\n".join(linhas)
