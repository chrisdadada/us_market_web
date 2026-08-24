#!/usr/bin/env python3
"""Verify the public page keeps its intended HTML, asset cache, and compression policy."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import re
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


FINGERPRINTED_ASSET = re.compile(r"-[A-Za-z0-9_-]{8,}\.(?:css|js)$")


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.assets.append(values["src"] or "")
        elif tag == "link" and values.get("rel") == "stylesheet" and values.get("href"):
            self.assets.append(values["href"] or "")


def request(url: str, *, method: str = "GET", compressed: bool = False):
    headers = {"User-Agent": "dongbimao-delivery-check/1.0"}
    if compressed:
        headers["Accept-Encoding"] = "br, gzip"
    return urlopen(Request(url, headers=headers, method=method), timeout=15)


def cache_max_age(value: str) -> int | None:
    match = re.search(r"(?:^|,)\s*max-age=(\d+)", value.lower())
    return int(match.group(1)) if match else None


def check_delivery(base_url: str, release: str = "") -> list[str]:
    base_url = base_url.rstrip("/") + "/"
    parts = urlsplit(base_url)
    query = urlencode({"delivery_check": release}) if release else ""
    html_url = urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))

    with request(html_url) as response:
        html_cache = response.headers.get("Cache-Control", "")
        html = response.read().decode("utf-8")
    if "no-store" not in html_cache.lower():
        raise RuntimeError(f"HTML must use no-store; received: {html_cache or 'missing'}")

    parser = AssetParser()
    parser.feed(html)
    assets = []
    for value in parser.assets:
        url = urljoin(base_url, value)
        asset_parts = urlsplit(url)
        if asset_parts.netloc == parts.netloc and FINGERPRINTED_ASSET.search(asset_parts.path):
            assets.append(url)
    assets = sorted(set(assets))
    if not assets:
        raise RuntimeError("No fingerprinted JS or CSS assets found in the public HTML")

    results = []
    for asset_url in assets:
        with request(asset_url, method="HEAD", compressed=True) as response:
            cache = response.headers.get("Cache-Control", "")
            encoding = response.headers.get("Content-Encoding", "").lower()
        max_age = cache_max_age(cache)
        if "public" not in cache.lower() or max_age is None or max_age < 3600:
            raise RuntimeError(f"Asset cache policy is too short for {asset_url}: {cache or 'missing'}")
        if encoding not in {"br", "gzip"}:
            raise RuntimeError(f"Asset compression is missing for {asset_url}: {encoding or 'missing'}")
        results.append(f"{urlsplit(asset_url).path} cache={max_age}s encoding={encoding}")
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--release", default="")
    args = parser.parse_args()
    for result in check_delivery(args.base_url, args.release):
        print(result)


if __name__ == "__main__":
    main()
