def is_known_write(observed_fingerprint: str, expected_fingerprint: str | None) -> bool:
    """Confirmation only. ERP acceptance must still enter the forward ERP→PM detector."""
    return expected_fingerprint is not None and observed_fingerprint == expected_fingerprint
