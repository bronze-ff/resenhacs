import os


class Config:
    def __init__(self, env=None):
        env = env if env is not None else os.environ
        self.database_url = env.get("DATABASE_URL")
        self.steam_api_key = env.get("STEAM_API_KEY")
        # Cloudflare R2 (compatível com S3)
        self.r2_account_id = env.get("R2_ACCOUNT_ID")
        self.r2_access_key_id = env.get("R2_ACCESS_KEY_ID")
        self.r2_secret_access_key = env.get("R2_SECRET_ACCESS_KEY")
        self.r2_bucket = env.get("R2_BUCKET", "resenha-demos")

    @property
    def r2_endpoint(self):
        if not self.r2_account_id:
            return None
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"

    def require(self, *chaves):
        faltando = [k for k in chaves if not getattr(self, k)]
        if faltando:
            raise RuntimeError(f"Config faltando: {', '.join(faltando)}")
