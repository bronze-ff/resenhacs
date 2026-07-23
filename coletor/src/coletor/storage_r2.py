"""Arquivamento de demos no Cloudflare R2 (S3-compatível). Ver ADR-0002.

O cliente boto3 é injetado nas funções, então a lógica de chave/upload é testável
com um fake. make_client() só é chamado em runtime.
"""


def demo_key(match_id):
    """Chave do objeto no bucket para o .dem de uma Partida."""
    return f"demos/{match_id}.dem.bz2"


def replay_key(match_id):
    """Chave dos frames do Replay 2D (Fase 4). JSON puro para o browser fazer fetch direto."""
    return f"replays/{match_id}.json"


def upload_bytes(client, bucket, key, data, content_type="application/octet-stream"):
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
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
