import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, BigInteger, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    display_name = Column(String(100), nullable=True)
    avatar_color = Column(String(7), default="#E63946")
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    storage_quota = Column(BigInteger, default=50 * 1024 * 1024 * 1024)  # 50GB default
    storage_used = Column(BigInteger, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login = Column(DateTime, nullable=True)

    files = relationship("FileEntry", back_populates="owner", cascade="all, delete-orphan")
    shares = relationship("ShareLink", back_populates="owner", cascade="all, delete-orphan")


class FileEntry(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    path = Column(Text, nullable=False)  # relative path in storage
    mime_type = Column(String(100), nullable=True)
    size = Column(BigInteger, default=0)
    is_folder = Column(Boolean, default=False)
    parent_id = Column(Integer, ForeignKey("files.id"), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_favorite = Column(Boolean, default=False)
    is_trashed = Column(Boolean, default=False)
    thumbnail_path = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    owner = relationship("User", back_populates="files")
    parent = relationship("FileEntry", remote_side=[id], backref="children")
    shares = relationship("ShareLink", back_populates="file", cascade="all, delete-orphan")


class ShareLink(Base):
    __tablename__ = "shares"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    password = Column(String(255), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    max_downloads = Column(Integer, nullable=True)
    download_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    file = relationship("FileEntry", back_populates="shares")
    owner = relationship("User", back_populates="shares")


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(50), nullable=False)  # upload, download, delete, share, etc.
    target_name = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
