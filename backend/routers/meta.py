from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import User, UserMeta
from schemas import MetaOut, MetaUpdate
from auth import get_current_user

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("", response_model=MetaOut)
async def get_meta(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserMeta).where(UserMeta.user_id == current_user.id))
    meta = result.scalar_one_or_none()
    if not meta:
        meta = UserMeta(user_id=current_user.id)
        db.add(meta)
        await db.commit()
        await db.refresh(meta)
    return MetaOut.model_validate(meta)


@router.put("", response_model=MetaOut)
async def update_meta(
    body: MetaUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserMeta).where(UserMeta.user_id == current_user.id))
    meta = result.scalar_one_or_none()
    if not meta:
        meta = UserMeta(user_id=current_user.id)
        db.add(meta)

    if body.theme is not None:
        meta.theme = body.theme
    if body.home is not None:
        meta.home = body.home

    await db.commit()
    await db.refresh(meta)
    return MetaOut.model_validate(meta)
