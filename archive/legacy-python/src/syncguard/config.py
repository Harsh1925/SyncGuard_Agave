import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    erp_path: str
    pm_url: str
    lease_seconds: int
    max_attempts: int
    poll_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.getenv(
                "SYNCGUARD_DATABASE_URL",
                "postgresql://syncguard:syncguard@localhost:5432/syncguard",
            ),
            erp_path=os.getenv("SYNCGUARD_ERP_PATH", "artifacts/erp.sqlite"),
            pm_url=os.getenv("SYNCGUARD_PM_URL", "http://localhost:8002"),
            lease_seconds=max(1, int(os.getenv("SYNCGUARD_LEASE_SECONDS", "10"))),
            max_attempts=max(1, int(os.getenv("SYNCGUARD_MAX_ATTEMPTS", "5"))),
            poll_seconds=max(0.1, float(os.getenv("SYNCGUARD_POLL_SECONDS", "5"))),
        )
