import os
import uuid
import shutil
import aiofiles
import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from pydantic import BaseModel
from app.database import get_db
from app.models.models import User, FileEntry, ActivityLog, ShareLink
from app.utils.auth import get_current_user
from app.utils.files import get_file_category, get_mime_type, generate_thumbnail, format_size
from app.config import settings

router = APIRouter(prefix="/api/files", tags=["files"])


class FileResponse_(BaseModel):
    id: int
    name: str
    path: str
    mime_type: Optional[str]
    size: int
    is_folder: bool
    parent_id: Optional[int]
    is_favorite: bool
    is_trashed: bool
    category: str
    thumbnail_url: Optional[str]
    size_formatted: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: Optional[int] = None


class RenameRequest(BaseModel):
    name: str


class MoveRequest(BaseModel):
    target_parent_id: Optional[int] = None


def file_to_response(f: FileEntry) -> FileResponse_:
    return FileResponse_(
        id=f.id,
        name=f.name,
        path=f.path,
        mime_type=f.mime_type,
        size=f.size,
        is_folder=f.is_folder,
        parent_id=f.parent_id,
        is_favorite=f.is_favorite,
        is_trashed=f.is_trashed,
        category="folder" if f.is_folder else get_file_category(f.name),
        thumbnail_url=f"/api/files/thumbnail/{f.thumbnail_path}" if f.thumbnail_path else None,
        size_formatted=format_size(f.size),
        created_at=f.created_at,
        updated_at=f.updated_at,
    )


def get_user_storage_path(user: User) -> str:
    path = os.path.join(settings.STORAGE_PATH, str(user.id))
    os.makedirs(path, exist_ok=True)
    return path


@router.get("/list", response_model=list[FileResponse_])
async def list_files(
    parent_id: Optional[int] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    favorites_only: bool = False,
    trash: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    query = select(FileEntry).where(
        and_(
            FileEntry.owner_id == current_user.id,
            FileEntry.is_trashed == trash,
        )
    )

    if not trash and not search and not favorites_only and category is None:
        query = query.where(FileEntry.parent_id == parent_id)

    if category and category != "all":
        # Filter by file extension category
        from app.utils.files import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS
        ext_map = {
            "image": IMAGE_EXTENSIONS,
            "video": VIDEO_EXTENSIONS,
            "audio": AUDIO_EXTENSIONS,
            "document": DOCUMENT_EXTENSIONS,
        }
        if category in ext_map:
            exts = ext_map[category]
            # We'll filter in Python since SQLite doesn't have good extension support
            query = query.where(FileEntry.is_folder == False)

    if search:
        query = query.where(FileEntry.name.ilike(f"%{search}%"))

    if favorites_only:
        query = query.where(FileEntry.is_favorite == True)

    query = query.order_by(FileEntry.is_folder.desc(), FileEntry.name.asc())
    result = await db.execute(query)
    files = result.scalars().all()

    # Post-filter by category if needed
    if category and category in ("image", "video", "audio", "document"):
        from app.utils.files import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS
        ext_map = {
            "image": IMAGE_EXTENSIONS,
            "video": VIDEO_EXTENSIONS,
            "audio": AUDIO_EXTENSIONS,
            "document": DOCUMENT_EXTENSIONS,
        }
        exts = ext_map[category]
        files = [f for f in files if os.path.splitext(f.name)[1].lower() in exts]

    return [file_to_response(f) for f in files]


@router.post("/folder", response_model=FileResponse_)
async def create_folder(
    req: CreateFolderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Build the path
    if req.parent_id:
        parent_result = await db.execute(
            select(FileEntry).where(
                and_(FileEntry.id == req.parent_id, FileEntry.owner_id == current_user.id)
            )
        )
        parent = parent_result.scalar_one_or_none()
        if not parent or not parent.is_folder:
            raise HTTPException(status_code=404, detail="Dossier parent non trouvé")
        rel_path = os.path.join(parent.path, req.name)
    else:
        rel_path = req.name

    abs_path = os.path.join(get_user_storage_path(current_user), rel_path)
    os.makedirs(abs_path, exist_ok=True)

    folder = FileEntry(
        name=req.name,
        path=rel_path,
        is_folder=True,
        parent_id=req.parent_id,
        owner_id=current_user.id,
    )
    db.add(folder)
    log = ActivityLog(user_id=current_user.id, action="create_folder", target_name=req.name)
    db.add(log)
    await db.commit()
    await db.refresh(folder)
    return file_to_response(folder)


@router.post("/upload", response_model=list[FileResponse_])
async def upload_files(
    files: list[UploadFile] = File(...),
    parent_id: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Resolve parent path
    parent_path = ""
    if parent_id:
        parent_result = await db.execute(
            select(FileEntry).where(
                and_(FileEntry.id == parent_id, FileEntry.owner_id == current_user.id)
            )
        )
        parent = parent_result.scalar_one_or_none()
        if parent:
            parent_path = parent.path

    uploaded = []
    user_storage = get_user_storage_path(current_user)

    for upload_file in files:
        # Unique filename to prevent collisions
        ext = os.path.splitext(upload_file.filename)[1]
        unique_name = f"{uuid.uuid4().hex[:8]}_{upload_file.filename}"
        rel_path = os.path.join(parent_path, unique_name) if parent_path else unique_name
        abs_path = os.path.join(user_storage, rel_path)

        os.makedirs(os.path.dirname(abs_path), exist_ok=True)

        # Stream write
        size = 0
        async with aiofiles.open(abs_path, 'wb') as out_file:
            while chunk := await upload_file.read(1024 * 1024):  # 1MB chunks
                await out_file.write(chunk)
                size += len(chunk)

        # Generate thumbnail for images
        thumb_name = f"{uuid.uuid4().hex}.jpg"
        thumbnail = generate_thumbnail(abs_path, thumb_name)

        mime_type = get_mime_type(upload_file.filename)

        file_entry = FileEntry(
            name=upload_file.filename,
            path=rel_path,
            mime_type=mime_type,
            size=size,
            is_folder=False,
            parent_id=parent_id,
            owner_id=current_user.id,
            thumbnail_path=thumbnail,
        )
        db.add(file_entry)

        # Update user storage
        current_user.storage_used += size

        uploaded.append(file_entry)

    log = ActivityLog(
        user_id=current_user.id,
        action="upload",
        target_name=f"{len(uploaded)} fichier(s)",
    )
    db.add(log)
    await db.commit()

    for f in uploaded:
        await db.refresh(f)

    return [file_to_response(f) for f in uploaded]


@router.get("/download/{file_id}")
async def download_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry or file_entry.is_folder:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    abs_path = os.path.join(get_user_storage_path(current_user), file_entry.path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Fichier physique non trouvé")

    log = ActivityLog(user_id=current_user.id, action="download", target_name=file_entry.name)
    db.add(log)
    await db.commit()

    return FileResponse(
        abs_path,
        filename=file_entry.name,
        media_type=file_entry.mime_type or "application/octet-stream"
    )


@router.get("/preview/{file_id}")
async def preview_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry or file_entry.is_folder:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    abs_path = os.path.join(get_user_storage_path(current_user), file_entry.path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="Fichier physique non trouvé")

    return FileResponse(
        abs_path,
        media_type=file_entry.mime_type or "application/octet-stream"
    )


@router.get("/thumbnail/{thumb_name}")
async def get_thumbnail(thumb_name: str):
    thumb_path = os.path.join(settings.THUMBNAILS_PATH, thumb_name)
    if not os.path.exists(thumb_path):
        raise HTTPException(status_code=404, detail="Miniature non trouvée")
    return FileResponse(thumb_path, media_type="image/jpeg")


@router.put("/{file_id}/rename", response_model=FileResponse_)
async def rename_file(
    file_id: int,
    req: RenameRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    user_storage = get_user_storage_path(current_user)
    old_abs = os.path.join(user_storage, file_entry.path)
    new_rel = os.path.join(os.path.dirname(file_entry.path), req.name)
    new_abs = os.path.join(user_storage, new_rel)

    if os.path.exists(old_abs):
        os.rename(old_abs, new_abs)

    file_entry.name = req.name
    file_entry.path = new_rel
    await db.commit()
    await db.refresh(file_entry)
    return file_to_response(file_entry)


@router.put("/{file_id}/favorite")
async def toggle_favorite(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    file_entry.is_favorite = not file_entry.is_favorite
    await db.commit()
    return {"is_favorite": file_entry.is_favorite}


@router.put("/{file_id}/trash")
async def trash_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    file_entry.is_trashed = not file_entry.is_trashed
    await db.commit()
    action = "trash" if file_entry.is_trashed else "restore"
    log = ActivityLog(user_id=current_user.id, action=action, target_name=file_entry.name)
    db.add(log)
    await db.commit()
    return {"is_trashed": file_entry.is_trashed}


@router.delete("/{file_id}")
async def delete_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.id == file_id, FileEntry.owner_id == current_user.id)
        )
    )
    file_entry = result.scalar_one_or_none()
    if not file_entry:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    user_storage = get_user_storage_path(current_user)
    abs_path = os.path.join(user_storage, file_entry.path)

    if os.path.exists(abs_path):
        if file_entry.is_folder:
            shutil.rmtree(abs_path, ignore_errors=True)
        else:
            os.remove(abs_path)
            current_user.storage_used = max(0, current_user.storage_used - file_entry.size)

    # Remove thumbnail
    if file_entry.thumbnail_path:
        thumb_abs = os.path.join(settings.THUMBNAILS_PATH, file_entry.thumbnail_path)
        if os.path.exists(thumb_abs):
            os.remove(thumb_abs)

    log = ActivityLog(user_id=current_user.id, action="delete", target_name=file_entry.name)
    db.add(log)
    await db.delete(file_entry)
    await db.commit()
    return {"message": "Fichier supprimé"}


@router.get("/stats")
async def get_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Count by category
    result = await db.execute(
        select(FileEntry).where(
            and_(FileEntry.owner_id == current_user.id, FileEntry.is_trashed == False)
        )
    )
    files = result.scalars().all()

    stats = {"image": 0, "video": 0, "audio": 0, "document": 0, "archive": 0, "other": 0, "folder": 0}
    size_by_cat = {"image": 0, "video": 0, "audio": 0, "document": 0, "archive": 0, "other": 0}

    for f in files:
        if f.is_folder:
            stats["folder"] += 1
        else:
            cat = get_file_category(f.name)
            stats[cat] = stats.get(cat, 0) + 1
            size_by_cat[cat] = size_by_cat.get(cat, 0) + f.size

    total_files = sum(v for k, v in stats.items() if k != "folder")

    return {
        "total_files": total_files,
        "total_folders": stats["folder"],
        "storage_used": current_user.storage_used,
        "storage_quota": current_user.storage_quota,
        "storage_used_formatted": format_size(current_user.storage_used),
        "storage_quota_formatted": format_size(current_user.storage_quota),
        "storage_percent": round((current_user.storage_used / current_user.storage_quota) * 100, 1) if current_user.storage_quota > 0 else 0,
        "by_category": stats,
        "size_by_category": {k: format_size(v) for k, v in size_by_cat.items()},
    }


@router.get("/activity")
async def get_activity(
    limit: int = Query(default=20, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.user_id == current_user.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()
    return [
        {
            "id": l.id,
            "action": l.action,
            "target_name": l.target_name,
            "details": l.details,
            "created_at": l.created_at.isoformat(),
        }
        for l in logs
    ]


@router.get("/breadcrumb/{file_id}")
async def get_breadcrumb(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get breadcrumb path for a folder/file."""
    breadcrumb = []
    current_id = file_id

    while current_id:
        result = await db.execute(
            select(FileEntry).where(
                and_(FileEntry.id == current_id, FileEntry.owner_id == current_user.id)
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            break
        breadcrumb.insert(0, {"id": entry.id, "name": entry.name})
        current_id = entry.parent_id

    return breadcrumb
