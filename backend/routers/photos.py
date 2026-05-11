import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import User, Place, Photo
from schemas import PhotoOut
from auth import get_current_user
from storage import save_photo, delete_photo, get_photo_path

router = APIRouter(prefix="/api/photos", tags=["photos"])


@router.post("/places/{place_id}", response_model=PhotoOut)
async def upload_photo(
    place_id: str,
    file: UploadFile = File(...),
    caption: str = Form(""),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Place).where(Place.id == place_id, Place.user_id == current_user.id)
    )
    place = result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="地点不存在")

    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
    ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="不支持的文件类型，仅允许 JPEG/PNG/GIF/WebP")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过 10MB 限制")
    storage_path = await save_photo(data, file.filename or "photo.jpg", current_user.id, place_id)

    photo = Photo(place_id=place_id, storage_path=storage_path, caption=caption)
    db.add(photo)
    await db.commit()
    await db.refresh(photo)

    url = f"/api/photos/file/{storage_path}"
    return PhotoOut(id=photo.id, caption=photo.caption, url=url, created_at=photo.created_at)


@router.get("/file/{storage_path:path}")
async def serve_photo(storage_path: str):
    """直接返回照片文件，无需认证（照片 URL 本身就是访问密钥）"""
    filepath = get_photo_path(storage_path)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="照片不存在")
    return FileResponse(filepath)


@router.delete("/{photo_id}")
async def remove_photo(
    photo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Photo).join(Place).where(Photo.id == photo_id, Place.user_id == current_user.id)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="照片不存在")

    await delete_photo(photo.storage_path)
    await db.delete(photo)
    await db.commit()
    return {"ok": True}
