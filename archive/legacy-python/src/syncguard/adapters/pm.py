import httpx

from syncguard.domain.models import Invoice, Job


def normalize_invoice(record: dict) -> Invoice:
    return Invoice.model_validate(record["invoice"])


class PMAdapter:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def get(self, logical_id: str) -> dict | None:
        response = httpx.get(f"{self.base_url}/invoices/{logical_id}", timeout=5)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def verify(self, operation: dict) -> bool:
        response = httpx.get(f"{self.base_url}/operations/{operation['operation_id']}", timeout=5)
        if response.status_code == 404:
            return False
        response.raise_for_status()
        receipt = response.json()
        if receipt["version"] != operation["version"]:
            return False
        actual = self.get(str(operation["logical_id"]))
        if operation["action"] == "delete":
            return actual is None
        return (
            actual is not None and normalize_invoice(actual).fingerprint == operation["fingerprint"]
        )

    def write(self, operation: dict) -> dict:
        response = httpx.put(
            f"{self.base_url}/invoices/{operation['logical_id']}",
            json={
                "operation_id": str(operation["operation_id"]),
                "version": operation["version"],
                "action": operation["action"],
                "invoice": operation["desired"],
            },
            timeout=5,
        )
        response.raise_for_status()
        return response.json()

    def jobs(self) -> list[Job]:
        response = httpx.get(f"{self.base_url}/jobs", timeout=5)
        response.raise_for_status()
        return [Job.model_validate(item) for item in response.json()]

    def invoices(self) -> dict[str, Invoice]:
        result = {}
        cursor = None
        while True:
            response = httpx.get(
                f"{self.base_url}/invoices", params={"cursor": cursor} if cursor else {}, timeout=5
            )
            response.raise_for_status()
            page = response.json()
            for record in page["items"]:
                invoice = normalize_invoice(record)
                result[invoice.logical_id] = invoice
            cursor = page["next_cursor"]
            if cursor is None:
                return result
