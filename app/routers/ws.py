import asyncio
import json
import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from app.utils.auth import get_current_user
from app.models.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Manages WebSocket connections per user and broadcasts events."""

    def __init__(self):
        # user_id -> set of websocket connections
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        async with self._lock:
            if user_id not in self.active_connections:
                self.active_connections[user_id] = set()
            self.active_connections[user_id].add(websocket)
        logger.info(f"WebSocket connecté: user {user_id} ({self.count_connections()} total)")

    async def disconnect(self, websocket: WebSocket, user_id: int):
        async with self._lock:
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
        logger.info(f"WebSocket déconnecté: user {user_id} ({self.count_connections()} total)")

    def count_connections(self) -> int:
        return sum(len(conns) for conns in self.active_connections.values())

    async def send_to_user(self, user_id: int, event: dict):
        """Send an event to all connections of a specific user."""
        if user_id not in self.active_connections:
            return
        dead = []
        for ws in self.active_connections[user_id]:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active_connections[user_id].discard(ws)

    async def broadcast(self, event: dict, exclude_user: int = None):
        """Broadcast an event to all connected users."""
        for user_id, connections in list(self.active_connections.items()):
            if user_id == exclude_user:
                continue
            dead = []
            for ws in connections:
                try:
                    await ws.send_json(event)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                connections.discard(ws)


# Singleton instance
manager = ConnectionManager()


# === Helper functions for other routers to emit events ===

async def emit_upload(user_id: int, file_name: str, file_size: str, count: int = 1):
    await manager.send_to_user(user_id, {
        "type": "upload",
        "data": {"file_name": file_name, "file_size": file_size, "count": count},
    })


async def emit_delete(user_id: int, file_name: str):
    await manager.send_to_user(user_id, {
        "type": "delete",
        "data": {"file_name": file_name},
    })


async def emit_move(user_id: int, file_name: str, destination: str):
    await manager.send_to_user(user_id, {
        "type": "move",
        "data": {"file_name": file_name, "destination": destination},
    })


async def emit_share(user_id: int, file_name: str, token: str):
    await manager.send_to_user(user_id, {
        "type": "share",
        "data": {"file_name": file_name, "token": token},
    })


async def emit_quota_warning(user_id: int, percent_used: float, storage_used: str, storage_quota: str):
    await manager.send_to_user(user_id, {
        "type": "quota_warning",
        "data": {
            "percent_used": percent_used,
            "storage_used": storage_used,
            "storage_quota": storage_quota,
        },
    })


async def emit_system_alert(message: str, level: str = "info"):
    """Broadcast a system alert to all connected users."""
    await manager.broadcast({
        "type": "system_alert",
        "data": {"message": message, "level": level},
    })


# === WebSocket endpoint ===

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint. Client must send auth token as first message:
    {"type": "auth", "token": "Bearer xxx"}
    """
    user_id = None
    try:
        await websocket.accept()

        # Wait for auth message (timeout 10s)
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            data = json.loads(raw)
        except (asyncio.TimeoutError, json.JSONDecodeError):
            await websocket.close(code=4001, reason="Auth timeout ou format invalide")
            return

        if data.get("type") != "auth" or not data.get("token"):
            await websocket.close(code=4001, reason="Message d'auth requis")
            return

        # Validate token
        token = data["token"].replace("Bearer ", "")
        from jose import JWTError, jwt as jose_jwt
        from app.config import settings
        try:
            payload = jose_jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            sub = payload.get("sub")
            if sub is None:
                raise ValueError
            user_id = int(sub)
        except (JWTError, ValueError, TypeError):
            await websocket.close(code=4003, reason="Token invalide")
            return

        # Register connection (re-accept not needed, already accepted above)
        async with manager._lock:
            if user_id not in manager.active_connections:
                manager.active_connections[user_id] = set()
            manager.active_connections[user_id].add(websocket)

        logger.info(f"WebSocket authentifié: user {user_id}")

        # Send welcome
        await websocket.send_json({
            "type": "connected",
            "data": {"message": "Connecté au NAS en temps réel", "user_id": user_id},
        })

        # Keep connection alive — listen for pings
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Send server ping to check connection
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if user_id is not None:
            async with manager._lock:
                if user_id in manager.active_connections:
                    manager.active_connections[user_id].discard(websocket)
                    if not manager.active_connections[user_id]:
                        del manager.active_connections[user_id]
            logger.info(f"WebSocket fermé: user {user_id}")
