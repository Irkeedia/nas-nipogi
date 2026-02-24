import psutil
import platform
import os
import shutil
from fastapi import APIRouter, Depends
from app.utils.auth import get_current_user, get_admin_user
from app.models.models import User
from app.config import settings
from app.utils.files import format_size

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/info")
async def system_info(current_user: User = Depends(get_current_user)):
    cpu_percent = psutil.cpu_percent(interval=0.5)
    memory = psutil.virtual_memory()
    disk = shutil.disk_usage(settings.STORAGE_PATH)

    return {
        "hostname": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "cpu": {
            "percent": cpu_percent,
            "cores": psutil.cpu_count(),
            "freq": psutil.cpu_freq().current if psutil.cpu_freq() else 0,
        },
        "memory": {
            "total": memory.total,
            "used": memory.used,
            "percent": memory.percent,
            "total_formatted": format_size(memory.total),
            "used_formatted": format_size(memory.used),
        },
        "disk": {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
            "percent": round((disk.used / disk.total) * 100, 1),
            "total_formatted": format_size(disk.total),
            "used_formatted": format_size(disk.used),
            "free_formatted": format_size(disk.free),
        },
        "uptime": int(psutil.boot_time()),
        "nas_version": "1.0.0",
    }


@router.get("/network")
async def network_info(current_user: User = Depends(get_current_user)):
    interfaces = []
    for name, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family.name == 'AF_INET':
                interfaces.append({
                    "name": name,
                    "ip": addr.address,
                    "netmask": addr.netmask,
                })
    return {"interfaces": interfaces, "port": settings.PORT}
