import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


def _uuid():
    return str(uuid.uuid4())


def _now():
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=_now)

    places = relationship("Place", back_populates="user", cascade="all, delete-orphan")
    meta = relationship("UserMeta", back_populates="user", uselist=False, cascade="all, delete-orphan")


class Place(Base):
    __tablename__ = "places"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    full_name = Column(String)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    rating = Column(Integer, default=3)
    notes = Column(Text, default="")
    visit_date = Column(String, default="")
    created_at = Column(DateTime, default=_now)

    user = relationship("User", back_populates="places")
    photos = relationship("Photo", back_populates="place", cascade="all, delete-orphan")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(String, primary_key=True, default=_uuid)
    place_id = Column(String, ForeignKey("places.id"), nullable=False, index=True)
    storage_path = Column(String, nullable=False)
    caption = Column(String, default="")
    created_at = Column(DateTime, default=_now)

    place = relationship("Place", back_populates="photos")


class UserMeta(Base):
    __tablename__ = "user_meta"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    theme = Column(String, default="#ff6b6b")
    home = Column(JSON, nullable=True)

    user = relationship("User", back_populates="meta")
