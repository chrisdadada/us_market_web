#!/usr/bin/env python3
from __future__ import annotations

import argparse
import tarfile
from pathlib import PurePosixPath


ALLOWED_TOP_LEVEL = {
    "RELEASE",
    "admin-web-dist",
    "admin-web.sha256",
    "main-web-dist",
    "main-web.sha256",
    "preserve_product_runtime_tables.py",
    "server",
    "server.sha256",
    "static-assets",
    "static-assets.sha256",
}
REQUIRED_FILES = {
    "release/RELEASE",
    "release/admin-web-dist/index.html",
    "release/admin-web.sha256",
    "release/main-web-dist/index.html",
    "release/main-web.sha256",
    "release/preserve_product_runtime_tables.py",
    "release/server/auth_api.py",
    "release/server/funding_scanner.py",
    "release/server/open_portfolio.py",
    "release/server.sha256",
    "release/static-assets/dongbimao-logo.jpg",
    "release/static-assets/dongbimao-logo.png",
    "release/static-assets.sha256",
}
BLOCKED_PARTS = {"data", "uploads"}


def validate_archive(path: str, expected_commit: str) -> None:
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        names = {member.name.rstrip("/") for member in members}

        for member in members:
            item = PurePosixPath(member.name)
            parts = item.parts
            if item.is_absolute() or ".." in parts or not parts or parts[0] != "release":
                raise ValueError(f"unsafe archive path: {member.name}")
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError(f"unsupported archive member: {member.name}")
            if len(parts) > 1 and parts[1] not in ALLOWED_TOP_LEVEL:
                raise ValueError(f"unexpected release member: {member.name}")
            lowered = {part.lower() for part in parts}
            if lowered & BLOCKED_PARTS or any(part.startswith(".env") for part in lowered):
                raise ValueError(f"runtime data is not allowed in a code release: {member.name}")
            if member.isfile() and any(part.endswith(".db") or ".db-" in part for part in lowered):
                raise ValueError(f"database file is not allowed in a code release: {member.name}")

        missing = sorted(REQUIRED_FILES - names)
        if missing:
            raise ValueError(f"release archive is incomplete: {missing}")

        release_file = archive.extractfile("release/RELEASE")
        if release_file is None:
            raise ValueError("release metadata is missing")
        metadata = dict(
            line.split("=", 1)
            for line in release_file.read().decode("utf-8").splitlines()
            if "=" in line
        )
        if metadata.get("commit") != expected_commit:
            raise ValueError("release commit does not match the approved commit")
        if metadata.get("checks") != "passed":
            raise ValueError("release checks are not marked as passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("expected_commit")
    args = parser.parse_args()
    validate_archive(args.archive, args.expected_commit)
    print(f"Release archive verified: {args.expected_commit}")


if __name__ == "__main__":
    main()
