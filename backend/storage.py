import os
import uuid
import aiofiles
from config import UPLOAD_DIR


def _ext(path: str) -> str:
    _, ext = os.path.splitext(path)
    return ext.lower() if ext else ".jpg"


async def save_photo(file_data: bytes, original_filename: str, user_id: str, place_id: str) -> str:
    """保存照片到文件系统，返回 storage_path"""
    filename = f"{uuid.uuid4()}{_ext(original_filename)}"
    user_dir = os.path.join(UPLOAD_DIR, user_id, place_id)
    os.makedirs(user_dir, exist_ok=True)
    filepath = os.path.join(user_dir, filename)
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(file_data)
    return f"{user_id}/{place_id}/{filename}"


async def delete_photo(storage_path: str):
    filepath = os.path.join(UPLOAD_DIR, storage_path)
    if os.path.exists(filepath):
        os.remove(filepath)


def get_photo_path(storage_path: str) -> str:
    return os.path.join(UPLOAD_DIR, storage_path)
