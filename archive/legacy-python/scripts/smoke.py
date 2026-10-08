"""Read-only checks against a running local Compose deployment."""

import httpx


def main():
    for label, url in (
        ("API", "http://localhost:8000/health"),
        ("ERP", "http://localhost:8001/health"),
        ("PM", "http://localhost:8002/health"),
        ("Dashboard", "http://localhost:8080"),
    ):
        response = httpx.get(url, timeout=5)
        response.raise_for_status()
        print(f"{label}: HTTP {response.status_code}")


if __name__ == "__main__":
    main()
