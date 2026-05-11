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


_UPLOAD_DIR_REAL = os.path.realpath(UPLOAD_DIR)


def _safe_path(storage_path: str) -> str:
    """校验并返回安全的绝对路径，路径逃逸则抛出 ValueError"""
    full = os.path.realpath(os.path.join(UPLOAD_DIR, storage_path))
    if not full.startswith(_UPLOAD_DIR_REAL + os.sep):
        raise ValueError("非法的存储路径")
    return full


async def delete_photo(storage_path: str):
    filepath = _safe_path(storage_path)
    if os.path.exists(filepath):
        os.remove(filepath)


def get_photo_path(storage_path: str) -> str:
    return _safe_path(storage_path)
