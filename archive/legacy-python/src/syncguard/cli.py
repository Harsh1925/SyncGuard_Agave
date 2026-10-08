import argparse
import json
import logging
import time

from simulators.erp.database import seed
from syncguard.adapters.erp import ERPAdapter
from syncguard.adapters.pm import PMAdapter
from syncguard.chaos.planner import plan
from syncguard.config import Settings
from syncguard.engine.detector import SnapshotDetector
from syncguard.engine.reconciler import Reconciler
from syncguard.engine.worker import SyncWorker
from syncguard.state.database import migrate


def main() -> None:
    parser = argparse.ArgumentParser(description="SyncGuard local development commands")
    parser.add_argument(
        "command",
        choices=[
            "migrate",
            "seed",
            "bootstrap",
            "poll",
            "poll-loop",
            "worker",
            "reconcile",
            "chaos-plan",
        ],
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    settings = Settings.from_env()
    erp, pm = ERPAdapter(settings.erp_path), PMAdapter(settings.pm_url)
    if args.command in ("migrate", "bootstrap"):
        migrate(settings.database_url)
    if args.command in ("seed", "bootstrap"):
        seed(settings.erp_path)
    if args.command == "poll":
        print(json.dumps(SnapshotDetector(settings.database_url, erp).run()))
    if args.command == "poll-loop":
        detector = SnapshotDetector(settings.database_url, erp)
        while True:
            try:
                logging.info("snapshot result %s", detector.run())
            except Exception:
                logging.exception("poll failed; previous complete snapshot remains authoritative")
            time.sleep(settings.poll_seconds)
    if args.command == "worker":
        SyncWorker(settings, pm).run_forever()
    if args.command == "reconcile":
        print(json.dumps(Reconciler(settings.database_url, erp, pm).run()))
    if args.command == "chaos-plan":
        print(
            json.dumps(
                {"seed": args.seed, "status": "planned", "sequence": plan(args.seed)}, indent=2
            )
        )


if __name__ == "__main__":
    main()
