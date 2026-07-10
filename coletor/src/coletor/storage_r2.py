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
