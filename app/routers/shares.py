import os
import secrets
import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from app.database import get_db
from app.models.models import User, FileEntry, ShareLink, ActivityLog
from app.utils.auth import get_current_user
from app.utils.files import format_size
from app.config import settings
from app.routers.ws import emit_share

router = APIRouter(prefix="/api/shares", tags=["shares"])


# === Schemas ===

class CreateShareRequest(BaseModel):
    file_id: int
    password: Optional[str] = None
    expires_in_hours: Optional[int] = None  # None = no expiry
    max_downloads: Optional[int] = None


class ShareResponse(BaseModel):
    id: int
    token: str
    file_id: int
    file_name: str
    file_size_formatted: str
    is_folder: bool
    password_protected: bool
    expires_at: Optional[datetime.datetime]
    max_downloads: Optional[int]
    download_count: int
    share_url: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True


class AccessShareRequest(BaseModel):
    password: Optional[str] = None


# === Endpoints ===

@router.post("/create", response_model=ShareResponse)
async def create_share(
    req: CreateShareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a share link for a file or folder."""
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == req.file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    token = secrets.token_urlsafe(32)
    expires_at = None
    if req.expires_in_hours:
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(hours=req.expires_in_hours)

    # Hash password if provided
    hashed_pw = None
    if req.password:
        from app.utils.auth import hash_password
        hashed_pw = hash_password(req.password)

    share = ShareLink(
        token=token,
        file_id=req.file_id,
        owner_id=current_user.id,
        password=hashed_pw,
        expires_at=expires_at,
        max_downloads=req.max_downloads,
    )
    db.add(share)

    log = ActivityLog(
        user_id=current_user.id,
        action="share",
        target_name=file_entry.name,
        details=f"Lien de partage créé (expire: {expires_at or 'jamais'})",
    )
    db.add(log)
    await db.commit()
    await db.refresh(share)

    # WebSocket notification
    await emit_share(current_user.id, file_entry.name, share.token)

    return _share_to_response(share, file_entry)


@router.get("/list", response_model=list[ShareResponse])
async def list_shares(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all share links owned by the current user."""
    result = await db.execute(
        select(ShareLink, FileEntry)
        .join(FileEntry, ShareLink.file_id == FileEntry.id)
        .where(ShareLink.owner_id == current_user.id)
        .order_by(ShareLink.created_at.desc())
    )
    rows = result.all()
    return [_share_to_response(share, file_entry) for share, file_entry in rows]


@router.delete("/{share_id}")
async def delete_share(
    share_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a share link."""
    result = await db.execute(
        select(ShareLink).where(
            and_(ShareLink.id == share_id, ShareLink.owner_id == current_user.id)
        )
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="Partage non trouvé")

    await db.delete(share)
    await db.commit()
    return {"message": "Lien de partage supprimé"}


@router.get("/public/{token}")
async def get_shared_file_info(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Get info about a shared file (public, no auth needed)."""
    share, file_entry = await _validate_share(token, db)

    return {
        "file_name": file_entry.name,
        "file_size": file_entry.size,
        "file_size_formatted": format_size(file_entry.size),
        "is_folder": file_entry.is_folder,
        "mime_type": file_entry.mime_type,
        "password_protected": share.password is not None,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "download_count": share.download_count,
        "max_downloads": share.max_downloads,
    }


@router.post("/public/{token}/download")
async def download_shared_file(
    token: str,
    req: AccessShareRequest = AccessShareRequest(),
    db: AsyncSession = Depends(get_db),
):
    """Download a shared file (public, no auth needed). Requires password if set."""
    share, file_entry = await _validate_share(token, db)

    # Check password
    if share.password:
        if not req.password:
            raise HTTPException(status_code=403, detail="Mot de passe requis")
        from app.utils.auth import verify_password
        if not verify_password(req.password, share.password):
            raise HTTPException(status_code=403, detail="Mot de passe incorrect")

    # Check max downloads
    if share.max_downloads and share.download_count >= share.max_downloads:
        raise HTTPException(status_code=410, detail="Nombre maximum de téléchargements atteint")

    # Find the owner to build the path
    owner_result = await db.execute(select(User).where(User.id == file_entry.owner_id))
    owner = owner_result.scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="Propriétaire non trouvé")

    abs_path = os.path.join(settings.STORAGE_PATH, str(owner.id), file_entry.path)

    if file_entry.is_folder:
        # ZIP download for shared folders
        import zipfile
        import tempfile
        zip_path = os.path.join(tempfile.gettempdir(), f"share_{share.token}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files_in_dir in os.walk(abs_path):
                for file_name in files_in_dir:
                    file_abs = os.path.join(root, file_name)
                    arcname = os.path.relpath(file_abs, os.path.dirname(abs_path))
                    zf.write(file_abs, arcname)

        share.download_count += 1
        await db.commit()

        return FileResponse(
            zip_path,
            filename=f"{file_entry.name}.zip",
            media_type="application/zip",
        )

    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Fichier physique non trouvé")

    share.download_count += 1
    await db.commit()

    return FileResponse(
        abs_path,
        filename=file_entry.name,
        media_type=file_entry.mime_type or "application/octet-stream",
    )


# === Helpers ===

async def _validate_share(token: str, db: AsyncSession):
    """Validate a share token and return (ShareLink, FileEntry)."""
    result = await db.execute(
        select(ShareLink, FileEntry)
        .join(FileEntry, ShareLink.file_id == FileEntry.id)
        .where(ShareLink.token == token)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Lien de partage invalide ou expiré")

    share, file_entry = row

    # Check expiry
    if share.expires_at and share.expires_at < datetime.datetime.utcnow():
        raise HTTPException(status_code=410, detail="Ce lien de partage a expiré")

    return share, file_entry


def _share_to_response(share: ShareLink, file_entry: FileEntry) -> ShareResponse:
    return ShareResponse(
        id=share.id,
        token=share.token,
        file_id=share.file_id,
        file_name=file_entry.name,
        file_size_formatted=format_size(file_entry.size),
        is_folder=file_entry.is_folder,
        password_protected=share.password is not None,
        expires_at=share.expires_at,
        max_downloads=share.max_downloads,
        download_count=share.download_count,
        share_url=f"/share/{share.token}",
        created_at=share.created_at,
    )
