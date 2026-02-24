import os
import mimetypes
from PIL import Image
from app.config import settings

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff'}
VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'}
DOCUMENT_EXTENSIONS = {'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.csv', '.md'}
ARCHIVE_EXTENSIONS = {'.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'}


def get_file_category(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    elif ext in VIDEO_EXTENSIONS:
        return "video"
    elif ext in AUDIO_EXTENSIONS:
        return "audio"
    elif ext in DOCUMENT_EXTENSIONS:
        return "document"
    elif ext in ARCHIVE_EXTENSIONS:
        return "archive"
    return "other"


def get_mime_type(filename: str) -> str:
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"


def generate_thumbnail(file_path: str, thumb_name: str, size=(300, 300)) -> str | None:
    """Generate thumbnail for image files. Returns thumbnail path or None."""
    try:
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in IMAGE_EXTENSIONS or ext == '.svg':
            return None

        thumb_path = os.path.join(settings.THUMBNAILS_PATH, thumb_name)
        with Image.open(file_path) as img:
            img.thumbnail(size, Image.Resampling.LANCZOS)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            img.save(thumb_path, "JPEG", quality=85)
        return thumb_name
    except Exception:
        return None


def format_size(size_bytes: int) -> str:
    """Format bytes to human readable string."""
    for unit in ['o', 'Ko', 'Mo', 'Go', 'To']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} Po"
