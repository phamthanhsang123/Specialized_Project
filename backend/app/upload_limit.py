import json
from collections.abc import Iterable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .services.source import MAX_UPLOAD_BYTES


# Browser multipart bodies include a boundary and headers for every selected file.
# 2 MiB leaves roughly 4 KiB of metadata for each of the 500 supported files while
# keeping the amount buffered before multipart parsing tightly bounded.
MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024
MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES


class InvalidContentLength(ValueError):
    pass


def _parse_content_length(headers: Iterable[tuple[bytes, bytes]]) -> int | None:
    values: list[int] = []
    for name, raw_value in headers:
        if name.lower() != b"content-length":
            continue
        for token in raw_value.split(b","):
            token = token.strip()
            if not token or not token.isdigit():
                raise InvalidContentLength
            values.append(int(token))
    if not values:
        return None
    if any(value != values[0] for value in values[1:]):
        raise InvalidContentLength
    return values[0]


def _is_project_upload_path(path: str, api_prefix: str) -> bool:
    normalized_path = path.rstrip("/") or "/"
    normalized_prefix = "/" + api_prefix.strip("/") if api_prefix.strip("/") else ""
    prefixes = ("", normalized_prefix) if normalized_prefix else ("",)
    for prefix in prefixes:
        base = f"{prefix}/projects/"
        if not normalized_path.startswith(base):
            continue
        remainder = normalized_path[len(base):]
        parts = remainder.split("/")
        if len(parts) == 2 and parts[0] and parts[1] == "upload":
            return True
    return False


async def _send_json_error(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class UploadBodyLimitMiddleware:
    """Bound project-upload request bodies before FastAPI parses multipart data."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        api_prefix: str = "/api",
        max_request_bytes: int = MAX_UPLOAD_REQUEST_BYTES,
    ) -> None:
        if max_request_bytes <= 0:
            raise ValueError("max_request_bytes must be positive")
        self.app = app
        self.api_prefix = api_prefix
        self.max_request_bytes = max_request_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") != "POST"
            or not _is_project_upload_path(scope.get("path", ""), self.api_prefix)
        ):
            await self.app(scope, receive, send)
            return

        try:
            content_length = _parse_content_length(scope.get("headers", ()))
        except InvalidContentLength:
            await _send_json_error(send, 400, "Content-Length không hợp lệ")
            return
        if content_length is not None and content_length > self.max_request_bytes:
            await _send_json_error(send, 413, "Request upload vượt quá giới hạn cho phép")
            return

        # Buffer only this bounded endpoint before handing the body to Starlette's
        # multipart parser. This also covers HTTP/1.1 chunked and HTTP/2 bodies,
        # where Content-Length may be absent or untrustworthy.
        buffered_body = bytearray()
        received_bytes = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            received_bytes += len(message.get("body", b""))
            if received_bytes > self.max_request_bytes:
                await _send_json_error(send, 413, "Request upload vượt quá giới hạn cho phép")
                return
            buffered_body.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break

        replay_body = bytes(buffered_body)
        body_was_replayed = False

        async def replay_receive() -> Message:
            nonlocal body_was_replayed
            if not body_was_replayed:
                body_was_replayed = True
                return {"type": "http.request", "body": replay_body, "more_body": False}
            return {"type": "http.disconnect"}

        await self.app(scope, replay_receive, send)
