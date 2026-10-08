from syncguard.domain.models import Invoice, Job, Vendor


def validate_invoice(
    invoice: Invoice, vendors: list[Vendor], jobs: list[Job], existing: set[str]
) -> list[str]:
    reasons = []
    if not any(v.id == invoice.vendor_id and v.company_id == invoice.company_id for v in vendors):
        reasons.append("unknown_vendor")
    if not any(j.id == invoice.job_id and j.active for j in jobs):
        reasons.append("unknown_or_inactive_job")
    if invoice.logical_id in existing:
        reasons.append("duplicate_invoice_business_key")
    return reasons
