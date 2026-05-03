from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from database import get_db
from models import User, Place, Photo
from schemas import PlaceCreate, PlaceUpdate, PlaceOut, PhotoOut
from auth import get_current_user

router = APIRouter(prefix="/api/places", tags=["places"])


def _photo_url(storage_path: str) -> str:
    return f"/api/photos/file/{storage_path}"


def _place_to_out(place: Place) -> PlaceOut:
    return PlaceOut(
        id=place.id,
        name=place.name,
        full_name=place.full_name,
        lat=place.lat,
        lng=place.lng,
        rating=place.rating,
        notes=place.notes,
        visit_date=place.visit_date,
        created_at=place.created_at,
        photos=[PhotoOut(id=p.id, caption=p.caption, url=_photo_url(p.storage_path), created_at=p.created_at)
                for p in (place.photos or [])],
    )


async def _get_place(db: AsyncSession, place_id: str, user_id: str) -> Place:
    result = await db.execute(
        select(Place)
        .options(selectinload(Place.photos))
        .where(Place.id == place_id, Place.user_id == user_id)
    )
    return result.scalar_one_or_none()


@router.get("", response_model=list[PlaceOut])
async def list_places(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Place)
        .options(selectinload(Place.photos))
        .where(Place.user_id == current_user.id)
        .order_by(Place.created_at.desc())
    )
    places = result.unique().scalars().all()
    return [_place_to_out(p) for p in places]


@router.post("", response_model=PlaceOut)
async def create_place(
    body: PlaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    place = Place(user_id=current_user.id, **body.model_dump())
    db.add(place)
    await db.commit()
    await db.refresh(place)
    # 新建地点无照片，直接构造返回值，避免触发 async lazy load
    return PlaceOut(
        id=place.id,
        name=place.name,
        full_name=place.full_name,
        lat=place.lat,
        lng=place.lng,
        rating=place.rating,
        notes=place.notes,
        visit_date=place.visit_date,
        created_at=place.created_at,
        photos=[],
    )


@router.put("/{place_id}", response_model=PlaceOut)
async def update_place(
    place_id: str,
    body: PlaceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    place = await _get_place(db, place_id, current_user.id)
    if not place:
        raise HTTPException(status_code=404, detail="地点不存在")

    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(place, key, val)
    await db.commit()
    await db.refresh(place)
    return _place_to_out(place)


@router.delete("/{place_id}")
async def delete_place(
    place_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    place = await _get_place(db, place_id, current_user.id)
    if not place:
        raise HTTPException(status_code=404, detail="地点不存在")

    # 删关联照片文件
    from storage import delete_photo
    for photo in place.photos:
        await delete_photo(photo.storage_path)

    await db.delete(place)
    await db.commit()
    return {"ok": True}
