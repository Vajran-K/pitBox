"""HTTP fetching with a polite rate limit and an on-disk cache.

Every response is cached under data/raw/, so re-running the pipeline costs no
API requests. Only cache misses wait on the rate limiter.
"""

from __future__ import annotations

import gzip
import hashlib
import os
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "PitBox/0.1 (personal F1 stats project)"


class NotFound(Exception):
    pass


class RateLimiter:
    """Spaces requests evenly: at most one every `min_interval` seconds."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self) -> None:
        delay = self._last + self.min_interval - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self._last = time.monotonic()


class Client:
    def __init__(self, cache_dir: Path, limiter: RateLimiter, name: str, verbose: bool = True):
        self.cache_dir = Path(cache_dir) / name
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.limiter = limiter
        self.name = name
        self.verbose = verbose
        self.hits = 0
        self.misses = 0

    def _path(self, url: str) -> Path:
        return self.cache_dir / (hashlib.sha1(url.encode()).hexdigest()[:20] + ".json.gz")

    def get(self, url: str, ttl: float | None = None):
        """Return parsed JSON for `url`. ttl=None caches forever; otherwise seconds."""
        path = self._path(url)
        if path.exists() and (ttl is None or time.time() - path.stat().st_mtime < ttl):
            with gzip.open(path, "rt", encoding="utf-8") as f:
                entry = json.load(f)
            self.hits += 1
            if entry.get("status") == 404:
                raise NotFound(url)
            return entry["body"]

        status, body = self._fetch(url)
        self.misses += 1
        tmp = path.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump({"url": url, "status": status, "fetched_at": time.time(), "body": body}, f)
        tmp.replace(path)
        if status == 404:
            raise NotFound(url)
        return body

    # OpenF1 locks the whole free API while any F1 session is live (about 1-2 h).
    # Rather than failing, wait it out; the data is free again once the session ends.
    LIVE_LOCK_TEXT = "session in progress"
    LIVE_LOCK_POLL = 300        # seconds between checks
    # give up after this long; the scheduled GitHub job sets a short limit and simply tries again later
    LIVE_LOCK_MAX = int(os.environ.get("PITBOX_LIVE_LOCK_MAX", 4 * 3600))

    def _fetch(self, url: str):
        attempt, locked_since = 0, None
        while attempt < 6:
            self.limiter.wait()
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    raw = r.read()
                if self.verbose:
                    print(f"  [{self.name}] GET {url.split('//', 1)[-1][:110]}  {len(raw)//1024} KB")
                return 200, json.loads(raw.decode("utf-8-sig"))
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return 404, None
                if e.code == 401:
                    body = e.read().decode("utf-8", "replace")
                    if self.LIVE_LOCK_TEXT in body.lower():
                        locked_since = locked_since or time.monotonic()
                        if time.monotonic() - locked_since > self.LIVE_LOCK_MAX:
                            raise RuntimeError(f"OpenF1 has been locked for a live session for over {self.LIVE_LOCK_MAX // 60} min; try again later")
                        print(f"  [{self.name}] F1 session is live, OpenF1 is locked until it ends. "
                              f"Checking again in {self.LIVE_LOCK_POLL // 60} min ({time.strftime('%H:%M')})", flush=True)
                        time.sleep(self.LIVE_LOCK_POLL)
                        continue  # doesn't count as a failed attempt
                    raise
                attempt += 1
                if e.code == 429 or e.code >= 500:
                    wait = int(e.headers.get("Retry-After") or 0) or min(60 * (attempt + 1), 300)
                    print(f"  [{self.name}] HTTP {e.code}, retrying in {wait}s")
                    time.sleep(wait)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError) as e:
                attempt += 1
                wait = 10 * attempt
                print(f"  [{self.name}] {e}, retrying in {wait}s")
                time.sleep(wait)
        raise RuntimeError(f"giving up on {url}")
