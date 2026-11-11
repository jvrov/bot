"""Armazenamento dos dados dos usuários.

Usa Redis quando ``REDIS_URL`` está configurado; caso contrário, salva tudo em
um arquivo JSON local (``data.json``) — assim o projeto roda sem dependências
externas durante o desenvolvimento.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger(__name__)


class JSONFileStore:
    """Armazenamento chave/valor simples em arquivo, seguro entre threads."""

    def __init__(self, path: str | os.PathLike):
        self.path = Path(path)
        self._lock = threading.Lock()

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _write(self, data: dict) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def get(self, key: str):
        with self._lock:
            return self._read().get(key)

    def set(self, key: str, value: str) -> None:
        with self._lock:
            data = self._read()
            data[key] = value
            self._write(data)

    def delete(self, key: str) -> None:
        with self._lock:
            data = self._read()
            if data.pop(key, None) is not None:
                self._write(data)

    def keys(self, prefix: str) -> list[str]:
        with self._lock:
            return [k for k in self._read() if k.startswith(prefix)]


class RedisStore:
    def __init__(self, url: str):
        import redis

        self.client = redis.from_url(url, decode_responses=True)
        self.client.ping()

    def get(self, key: str):
        return self.client.get(key)

    def set(self, key: str, value: str) -> None:
        self.client.set(key, value)

    def delete(self, key: str) -> None:
        self.client.delete(key)

    def keys(self, prefix: str) -> list[str]:
        return list(self.client.scan_iter(match=f"{prefix}*"))


def create_store():
    url = os.getenv("REDIS_URL") or os.getenv("KV_URL")
    if url:
        try:
            store = RedisStore(url)
            logger.info("Usando Redis para armazenamento")
            return store
        except Exception as exc:  # noqa: BLE001 - qualquer falha cai no fallback
            logger.error("Não foi possível conectar ao Redis (%s); usando arquivo local", exc)

    path = os.getenv("DATA_FILE", "data.json")
    if os.getenv("VERCEL") and not os.path.isabs(path):
        # Na Vercel só /tmp é gravável (e não é persistente!).
        path = os.path.join("/tmp", path)
        logger.warning("REDIS_URL não configurado: dados ficarão em /tmp e serão perdidos")
    logger.info("Usando arquivo local para armazenamento: %s", path)
    return JSONFileStore(path)


class UserRepository:
    """Lê e grava email/produtos de cada usuário."""

    def __init__(self, store):
        self.store = store

    @staticmethod
    def _email_key(user_id: str) -> str:
        return f"email:{user_id}"

    @staticmethod
    def _products_key(user_id: str) -> str:
        return f"produtos:{user_id}"

    def get_email(self, user_id: str) -> str | None:
        return self.store.get(self._email_key(user_id))

    def set_email(self, user_id: str, email: str) -> None:
        self.store.set(self._email_key(user_id), email)

    def get_products(self, user_id: str) -> list[dict]:
        raw = self.store.get(self._products_key(user_id))
        if not raw:
            return []
        try:
            products = json.loads(raw)
        except json.JSONDecodeError:
            logger.error("Dados corrompidos para o usuário %s", user_id)
            return []
        return products if isinstance(products, list) else []

    def save_products(self, user_id: str, products: list[dict]) -> None:
        self.store.set(self._products_key(user_id), json.dumps(products, ensure_ascii=False))

    def all_user_ids(self) -> list[str]:
        prefix = "produtos:"
        return [k[len(prefix):] for k in self.store.keys(prefix)]

    def move_user(self, old_id: str, new_id: str) -> None:
        """Migra dados antigos (chaveados por IP) para o novo identificador."""
        email = self.get_email(old_id)
        products = self.get_products(old_id)
        if email and not self.get_email(new_id):
            self.set_email(new_id, email)
        if products and not self.get_products(new_id):
            self.save_products(new_id, products)
        self.store.delete(self._email_key(old_id))
        self.store.delete(self._products_key(old_id))
