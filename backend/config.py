import os
import secrets

_SECRET_KEY = os.getenv("SECRET_KEY")
if not _SECRET_KEY:
    _SECRET_KEY = secrets.token_urlsafe(32)
    print(f"[WARN] SECRET_KEY 未设置，已自动生成随机密钥（重启后所有 token 失效）")
    print(f"       生产环境请设置环境变量 SECRET_KEY 为固定随机字符串")
SECRET_KEY = _SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 天

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{BASE_DIR}/travel_album.db")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081").split(",")

os.makedirs(UPLOAD_DIR, exist_ok=True)
