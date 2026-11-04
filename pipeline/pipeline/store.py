"""Writing exports. Plain JSON, or gzip when the path ends in .gz."""

from __future__ import annotations

import gzip
import json
from pathlib import Path


def write_json(path: Path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(tmp, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    tmp.replace(path)


def read_json(path: Path):
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        return json.load(f)
