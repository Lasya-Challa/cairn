import os
import tempfile

import pytest

# Point the app at a throwaway database before anything imports it.
_db_file = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["CAIRN_DATABASE_URL"] = f"sqlite:///{_db_file}"
os.environ["CAIRN_SECRET_KEY"] = "test-secret-key-that-is-at-least-32-bytes"

from fastapi.testclient import TestClient  # noqa: E402

import seed  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = seed.PASSWORD
USERS = {
    "maya": "maya.okafor@riverbend.example",
    "daniel": "daniel.reyes@riverbend.example",
    "admin": "grace.whitfield@riverbend.example",
    "billing": "tom.alvarez@riverbend.example",
}


@pytest.fixture(scope="session", autouse=True)
def seeded():
    seed.main()


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session")
def tokens(client, seeded):
    out = {}
    for key, email in USERS.items():
        r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        out[key] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return out
