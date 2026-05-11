from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


# ===== 认证 =====
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ===== 照片 =====
class PhotoOut(BaseModel):
    id: str
    caption: str
    url: str  # 前端可用 URL
    created_at: datetime

    model_config = {"from_attributes": True}


class PhotoCreate(BaseModel):
    caption: str = ""


# ===== 地点 =====
class PlaceCreate(BaseModel):
    name: str
    full_name: Optional[str] = None
    lat: float
    lng: float
    rating: int = 3
    notes: str = ""
    visit_date: str = ""


class PlaceUpdate(BaseModel):
    name: Optional[str] = None
    full_name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    visit_date: Optional[str] = None


class PlaceOut(BaseModel):
    id: str
    name: str
    full_name: Optional[str] = None
    lat: float
    lng: float
    rating: int
    notes: str
    visit_date: str
    created_at: datetime
    photos: List[PhotoOut] = []

    model_config = {"from_attributes": True}


# ===== Meta =====
class MetaOut(BaseModel):
    theme: str
    home: Optional[dict] = None

    model_config = {"from_attributes": True}


class MetaUpdate(BaseModel):
    theme: Optional[str] = None
    home: Optional[dict] = None


# ===== 导入导出 =====
class ExportData(BaseModel):
    export_time: str
    theme: str
    home: Optional[dict] = None
    places: List[PlaceOut] = []
