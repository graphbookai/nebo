from nebo.core.transport import Transport


def test_transport_is_protocol():
    class DuckTransport:
        def send_event(self, event: dict) -> None: ...
        def flush(self, timeout: float = 5.0) -> bool: return True
        def close(self) -> None: ...

    assert isinstance(DuckTransport(), Transport)


def test_transport_missing_method_fails_isinstance():
    class IncompleteTransport:
        def send_event(self, event: dict) -> None: ...

    assert not isinstance(IncompleteTransport(), Transport)
