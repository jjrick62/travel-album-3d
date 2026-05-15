from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


# ===== 认证 =====
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
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
    name: str = Field(min_length=1, max_length=200)
    full_name: Optional[str] = Field(default=None, max_length=500)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    rating: int = Field(default=3, ge=1, le=5)
    notes: str = Field(default="", max_length=5000)
    visit_date: str = Field(default="", max_length=20)


class PlaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    full_name: Optional[str] = Field(default=None, max_length=500)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    notes: Optional[str] = Field(default=None, max_length=5000)
    visit_date: Optional[str] = Field(default=None, max_length=20)


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
