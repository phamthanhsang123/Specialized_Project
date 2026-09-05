import asyncio
import json

from fastapi import FastAPI, File, UploadFile
from fastapi.testclient import TestClient
import pytest

from app.upload_limit import MAX_UPLOAD_REQUEST_BYTES, UploadBodyLimitMiddleware


class RecordingApp:
    def __init__(self) -> None:
        self.calls = 0
        self.body = b""

    async def __call__(self, _scope, receive, send) -> None:
        self.calls += 1
        chunks: list[bytes] = []
        while True:
            message = await receive()
            assert message["type"] == "http.request"
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        self.body = b"".join(chunks)
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})


def invoke(
    middleware,
    *,
    path="/api/projects/prj_1/upload",
    method="POST",
    headers=(),
    messages=(),
):
    sent = []
    pending = iter(messages)

    async def receive():
        return next(pending)

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": method, "path": path, "headers": list(headers)}
    asyncio.run(middleware(scope, receive, send))
    return sent


def response_payload(messages):
    return json.loads(messages[-1]["body"])


@pytest.mark.parametrize("path", ["/projects/prj_1/upload", "/api/projects/prj_1/upload/"])
def test_content_length_over_limit_is_rejected_before_read_or_app(path):
    downstream = RecordingApp()
    middleware = UploadBodyLimitMiddleware(downstream, max_request_bytes=10)

    sent = invoke(middleware, path=path, headers=[(b"content-length", b"11")])

    assert sent[0]["status"] == 413
    assert response_payload(sent)["detail"] == "Request upload vượt quá giới hạn cho phép"
    assert downstream.calls == 0


def test_chunked_body_over_limit_is_rejected_before_multipart_app():
    downstream = RecordingApp()
    middleware = UploadBodyLimitMiddleware(downstream, max_request_bytes=10)

    sent = invoke(
        middleware,
        headers=[(b"transfer-encoding", b"chunked")],
        messages=[
            {"type": "http.request", "body": b"123456", "more_body": True},
            {"type": "http.request", "body": b"78901", "more_body": False},
        ],
    )

    assert sent[0]["status"] == 413
    assert downstream.calls == 0


def test_body_at_limit_is_replayed_without_modification():
    downstream = RecordingApp()
    middleware = UploadBodyLimitMiddleware(downstream, max_request_bytes=10)

    sent = invoke(
        middleware,
        headers=[(b"content-length", b"10")],
        messages=[
            {"type": "http.request", "body": b"1234", "more_body": True},
            {"type": "http.request", "body": b"567890", "more_body": False},
        ],
    )

    assert sent[0]["status"] == 204
    assert downstream.calls == 1
    assert downstream.body == b"1234567890"


def test_custom_api_prefix_and_non_upload_routes():
    downstream = RecordingApp()
    middleware = UploadBodyLimitMiddleware(downstream, api_prefix="/v2/api", max_request_bytes=2)
    request = [{"type": "http.request", "body": b"abc", "more_body": False}]

    rejected = invoke(middleware, path="/v2/api/projects/one/upload", messages=request)
    bypassed = invoke(middleware, path="/v2/api/projects/one/scan", messages=request)

    assert rejected[0]["status"] == 413
    assert bypassed[0]["status"] == 204
    assert downstream.calls == 1
    assert downstream.body == b"abc"


@pytest.mark.parametrize(
    "headers",
    [
        [(b"content-length", b"invalid")],
        [(b"content-length", b"1"), (b"content-length", b"2")],
        [(b"content-length", b"1, 2")],
    ],
)
def test_invalid_or_conflicting_content_length_is_rejected(headers):
    downstream = RecordingApp()
    middleware = UploadBodyLimitMiddleware(downstream, max_request_bytes=10)

    sent = invoke(middleware, headers=headers)

    assert sent[0]["status"] == 400
    assert downstream.calls == 0


def test_default_limit_allows_ten_megabytes_plus_typical_multipart_metadata():
    assert MAX_UPLOAD_REQUEST_BYTES >= 10 * 1024 * 1024 + 500 * 1024


def test_replayed_body_remains_compatible_with_fastapi_multipart_parser():
    app = FastAPI()
    app.add_middleware(UploadBodyLimitMiddleware, max_request_bytes=1024)

    @app.post("/api/projects/demo/upload")
    async def upload(file: UploadFile = File(...)):
        return {"name": file.filename, "content": (await file.read()).decode()}

    with TestClient(app) as client:
        response = client.post(
            "/api/projects/demo/upload",
            files={"file": ("src/main.py", b"print('ok')\n", "text/x-python")},
        )

    assert response.status_code == 200
    assert response.json() == {"name": "src/main.py", "content": "print('ok')\n"}
