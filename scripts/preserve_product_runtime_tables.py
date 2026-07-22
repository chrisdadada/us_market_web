#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


CONTENT_TABLE = "market_opinion_items"
RUNTIME_TABLES = ("open_portfolio_trades", "open_portfolio_symbol_rules")
PROTECTED_TABLES = (CONTENT_TABLE, *RUNTIME_TABLES)


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def table_exists(conn: sqlite3.Connection, schema: str, name: str) -> bool:
    return conn.execute(
        f"SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone() is not None


def table_info(conn: sqlite3.Connection, schema: str, name: str) -> list[tuple]:
    return conn.execute(f"PRAGMA {schema}.table_info({quote(name)})").fetchall()


def sequence_value(conn: sqlite3.Connection, schema: str, name: str) -> int | None:
    if not table_exists(conn, schema, "sqlite_sequence"):
        return None
    row = conn.execute(
        f"SELECT seq FROM {schema}.sqlite_sequence WHERE name = ?", (name,)
    ).fetchone()
    return row[0] if row else None


def object_sql(conn: sqlite3.Connection, schema: str, name: str) -> list[tuple[str, str, str]]:
    return conn.execute(
        f"""
        SELECT type, name, sql
        FROM {schema}.sqlite_master
        WHERE (name = ? OR tbl_name = ?) AND type IN ('table', 'index', 'trigger') AND sql IS NOT NULL
        ORDER BY type, name
        """,
        (name, name),
    ).fetchall()


def row_fingerprint(
    conn: sqlite3.Connection,
    schema: str,
    name: str,
    columns: list[str] | None = None,
) -> tuple[int, str]:
    info = table_info(conn, schema, name)
    available = [row[1] for row in info]
    selected = columns or available
    if not selected or not set(selected).issubset(available):
        raise RuntimeError(f"{schema}.{name} protected columns do not match")
    primary_key = [row[1] for row in sorted(info, key=lambda row: row[5]) if row[5]]
    order_by = primary_key or selected
    selected_sql = ", ".join(quote(column) for column in selected)
    order_sql = ", ".join(quote(column) for column in order_by)
    rows = conn.execute(
        f"SELECT {selected_sql} FROM {schema}.{quote(name)} ORDER BY {order_sql}"
    ).fetchall()
    digest = hashlib.sha256()
    for row in rows:
        payload = json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return len(rows), digest.hexdigest()


def copy_content_table(conn: sqlite3.Connection) -> None:
    if not table_exists(conn, "old", CONTENT_TABLE):
        return
    if not table_exists(conn, "main", CONTENT_TABLE):
        raise RuntimeError(f"incoming DB is missing {CONTENT_TABLE}")
    columns = [row[1] for row in table_info(conn, "old", CONTENT_TABLE)]
    expected = row_fingerprint(conn, "old", CONTENT_TABLE, columns)
    column_sql = ", ".join(quote(column) for column in columns)
    conn.execute(f"DELETE FROM main.{quote(CONTENT_TABLE)}")
    conn.execute(
        f"INSERT INTO main.{quote(CONTENT_TABLE)} ({column_sql}) "
        f"SELECT {column_sql} FROM old.{quote(CONTENT_TABLE)}"
    )
    if row_fingerprint(conn, "main", CONTENT_TABLE, columns) != expected:
        raise RuntimeError(f"{CONTENT_TABLE} preservation fingerprint mismatch")


def copy_runtime_table(conn: sqlite3.Connection, name: str) -> None:
    schema_objects = object_sql(conn, "old", name)
    table_sql = next((sql for kind, _, sql in schema_objects if kind == "table"), None)
    if not table_sql:
        raise RuntimeError(f"existing DB is missing schema for {name}")
    expected_info = table_info(conn, "old", name)
    columns = [row[1] for row in expected_info]
    expected_rows = row_fingerprint(conn, "old", name, columns)
    expected_sequence = sequence_value(conn, "old", name)

    conn.execute(f"DROP TABLE IF EXISTS main.{quote(name)}")
    conn.execute(table_sql)
    column_sql = ", ".join(quote(column) for column in columns)
    conn.execute(
        f"INSERT INTO main.{quote(name)} ({column_sql}) "
        f"SELECT {column_sql} FROM old.{quote(name)}"
    )
    if expected_sequence is not None:
        conn.execute("DELETE FROM main.sqlite_sequence WHERE name = ?", (name,))
        conn.execute("INSERT INTO main.sqlite_sequence(name, seq) VALUES (?, ?)", (name, expected_sequence))
    for kind, _, sql in schema_objects:
        if kind != "table":
            conn.execute(sql)

    if table_info(conn, "main", name) != expected_info:
        raise RuntimeError(f"{name} schema preservation mismatch")
    if object_sql(conn, "main", name) != schema_objects:
        raise RuntimeError(f"{name} index or trigger preservation mismatch")
    if sequence_value(conn, "main", name) != expected_sequence:
        raise RuntimeError(f"{name} sequence preservation mismatch")
    if row_fingerprint(conn, "main", name, columns) != expected_rows:
        raise RuntimeError(f"{name} data preservation fingerprint mismatch")


def merge(incoming: Path, existing: Path) -> None:
    with sqlite3.connect(incoming) as conn:
        conn.execute("ATTACH DATABASE ? AS old", (str(existing),))
        copy_content_table(conn)
        existing_runtime = [name for name in RUNTIME_TABLES if table_exists(conn, "old", name)]
        if existing_runtime and len(existing_runtime) != len(RUNTIME_TABLES):
            raise RuntimeError("existing Open portfolio runtime tables are incomplete")
        for name in existing_runtime:
            copy_runtime_table(conn, name)
        result = conn.execute("PRAGMA main.integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"merged product DB integrity check failed: {result}")
        conn.commit()
        conn.execute("DETACH DATABASE old")


def verify(before: Path, after: Path) -> None:
    with sqlite3.connect(f"file:{before}?mode=ro", uri=True) as left, sqlite3.connect(
        f"file:{after}?mode=ro", uri=True
    ) as right:
        for name in PROTECTED_TABLES:
            left_exists = table_exists(left, "main", name)
            right_exists = table_exists(right, "main", name)
            if left_exists != right_exists:
                raise RuntimeError(f"{name} existence changed")
            if not left_exists:
                continue
            left_info = table_info(left, "main", name)
            columns = [row[1] for row in left_info]
            if name in RUNTIME_TABLES:
                if table_info(right, "main", name) != left_info:
                    raise RuntimeError(f"{name} schema changed")
                if object_sql(right, "main", name) != object_sql(left, "main", name):
                    raise RuntimeError(f"{name} index or trigger changed")
                if sequence_value(right, "main", name) != sequence_value(left, "main", name):
                    raise RuntimeError(f"{name} sequence changed")
            expected = row_fingerprint(left, "main", name, columns)
            actual = row_fingerprint(right, "main", name, columns)
            if actual != expected:
                raise RuntimeError(f"{name} content fingerprint changed")
            print(f"Protected table preserved: {name} rows={actual[0]} sha256={actual[1]}")
        result = right.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"deployed product DB integrity check failed: {result}")


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"product DB integrity check failed: {result}")
        for statement in conn.iterdump():
            payload = statement.encode("utf-8")
            digest.update(len(payload).to_bytes(8, "big"))
            digest.update(payload)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    merge_parser = subparsers.add_parser("merge")
    merge_parser.add_argument("--incoming", type=Path, required=True)
    merge_parser.add_argument("--existing", type=Path, required=True)
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--before", type=Path, required=True)
    verify_parser.add_argument("--after", type=Path, required=True)
    fingerprint_parser = subparsers.add_parser("fingerprint")
    fingerprint_parser.add_argument("--db", type=Path, required=True)
    args = parser.parse_args()
    paths = {
        "merge": (args.incoming, args.existing),
        "verify": (args.before, args.after),
        "fingerprint": (args.db,),
    }[args.command]
    for path in paths:
        if not path.is_file():
            raise SystemExit(f"missing DB: {path}")
    if args.command == "merge":
        merge(args.incoming, args.existing)
    elif args.command == "verify":
        verify(args.before, args.after)
    else:
        print(fingerprint(args.db))


if __name__ == "__main__":
    main()
