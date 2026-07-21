"""HTTP client with rate limiting, ETag caching, robots.txt compliance, and retries."""

import asyncio
import hashlib
import time
from urllib.robotparser import RobotFileParser

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from scraper.config import Config


class RateLimitedClient:
    """Thin wrapper around httpx.AsyncClient with polite-crawling behaviour."""

    def __init__(self, config: Config) -> None:
        self._config = config
        self._last_request_time: float = 0.0
        self._etag_cache: dict[str, str] = {}
        self._robots: RobotFileParser | None = None
        self._client = httpx.AsyncClient(
            headers={"User-Agent": config.user_agent},
            follow_redirects=True,
            timeout=30.0,
        )

    async def __aenter__(self) -> "RateLimitedClient":
        await self._load_robots()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def _load_robots(self) -> None:
        robots_url = f"{self._config.base_url}/robots.txt"
        try:
            resp = await self._client.get(robots_url)
            parser = RobotFileParser()
            parser.set_url(robots_url)
            parser.feed(resp.text)
            self._robots = parser
        except Exception:
            self._robots = None

    def _can_fetch(self, url: str) -> bool:
        if self._robots is None:
            return True
        return self._robots.can_fetch(self._config.user_agent, url)

    async def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_time
        wait = self._config.rate_limit_seconds - elapsed
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_request_time = time.monotonic()

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=2, min=2, max=30),
        reraise=True,
    )
    async def get(self, url: str, **kwargs: object) -> httpx.Response:
        if not self._can_fetch(url):
            raise PermissionError(f"robots.txt disallows: {url}")

        await self._throttle()

        headers = dict(kwargs.pop("headers", {}))  # type: ignore[arg-type]

        # ETag / If-None-Match cache
        if url in self._etag_cache:
            headers["If-None-Match"] = self._etag_cache[url]

        response = await self._client.get(url, headers=headers, **kwargs)  # type: ignore[arg-type]

        if response.status_code == 304:
            # Not modified — return a placeholder with 304
            return response

        if "ETag" in response.headers:
            self._etag_cache[url] = response.headers["ETag"]

        response.raise_for_status()
        return response
