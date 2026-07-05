"""
Server-side user registry for global username uniqueness.
Stored in data/users.json (local file, shared across all clients).
"""

import json
import os
import threading

from werkzeug.security import check_password_hash, generate_password_hash

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
_lock = threading.Lock()


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _load_users():
    _ensure_data_dir()
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_users(users):
    _ensure_data_dir()
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)


def find_user_by_name(users, username):
    """Case-insensitive lookup. Returns (canonical_key, user_dict) or (None, None)."""
    lower = username.strip().lower()
    for key, user in users.items():
        if key.lower() == lower or user.get("username_lower") == lower:
            return key, user
    return None, None


def register(username, password):
    username = username.strip()
    if len(username) < 3:
        return False, "Username must be at least 3 characters."
    if len(password) < 4:
        return False, "Password must be at least 4 characters."

    with _lock:
        users = _load_users()
        _, existing = find_user_by_name(users, username)
        if existing:
            return False, "Username already taken."

        users[username] = {
            "username": username,
            "username_lower": username.lower(),
            "type": "registered",
            "password_hash": generate_password_hash(password),
        }
        _save_users(users)
    return True, None


def login(username, password):
    username = username.strip()
    if len(username) < 3:
        return False, "Username must be at least 3 characters."
    if len(password) < 4:
        return False, "Password must be at least 4 characters."

    with _lock:
        users = _load_users()
        key, user = find_user_by_name(users, username)
        if not user:
            return False, "User not found. Click Register to create an account."
        if user["type"] == "guest":
            return False, "This is a guest account. Use the Guest tab."
        if not check_password_hash(user["password_hash"], password):
            return False, "Wrong password."

    return True, key


def guest_login(username):
    username = username.strip()
    if len(username) < 3:
        return False, "Username must be at least 3 characters."

    with _lock:
        users = _load_users()
        key, existing = find_user_by_name(users, username)
        if existing:
            if existing["type"] == "registered":
                return False, "This username is taken by a registered user."
            return True, key

        users[username] = {
            "username": username,
            "username_lower": username.lower(),
            "type": "guest",
            "password_hash": None,
        }
        _save_users(users)
    return True, username


def check_username(username):
    username = username.strip()
    if len(username) < 3:
        return False, "Username must be at least 3 characters."

    with _lock:
        users = _load_users()
        _, existing = find_user_by_name(users, username)
        if existing:
            if existing["type"] == "registered":
                return False, "Username already taken."
            return False, "Username already taken by a guest."

    return True, None
