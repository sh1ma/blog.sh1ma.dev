"""Create and verify the content-only D1 batch for the first EmDash rollout.

Run after `pnpm build:seed`. The output is local and must be applied only to an
empty EmDash D1 database whose schema was initialized by this same build.
"""

import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "seed" / "seed.json"
OUTPUT = ROOT / ".emdash" / "d1-import"
CONTENT_TABLES = ("revisions", "ec_posts", "_emdash_revision_prune_queue")
FTS_TABLES = {
    "_emdash_fts_posts",
    "_emdash_fts_posts_content",
    "_emdash_fts_posts_data",
    "_emdash_fts_posts_docsize",
    "_emdash_fts_posts_idx",
}
MAX_SQL_BYTES = 100_000


def seed_database(path: Path, include_content: bool) -> None:
    command = [
        "pnpm", "exec", "emdash", "seed", str(SEED),
        "--database", str(path),
    ]
    if not include_content:
        command.append("--no-content")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)


def table_schemas(connection: sqlite3.Connection) -> dict[str, str]:
    return {
        name: sql
        for name, sql in connection.execute(
            "SELECT name, sql FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def row_count(connection: sqlite3.Connection, table: str) -> int:
    return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]


def insert_statements(connection: sqlite3.Connection, table: str) -> list[str]:
    columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
    names = ", ".join(f'"{column}"' for column in columns)
    order = "entry_id, revision_id" if table.endswith("prune_queue") else "id"
    statements = []
    for row in connection.execute(f'SELECT * FROM "{table}" ORDER BY {order}'):
        if any(isinstance(value, str) and "\x00" in value for value in row):
            raise ValueError(f"NUL byte in {table}")
        literals = ", ".join(
            connection.execute("SELECT quote(?)", (value,)).fetchone()[0]
            for value in row
        )
        statement = f'INSERT INTO "{table}" ({names}) VALUES ({literals});'
        if len(statement.encode("utf-8")) > MAX_SQL_BYTES:
            raise ValueError(f"D1 statement limit exceeded in {table}")
        statements.append(statement)
    return statements


def main() -> None:
    expected = len(json.loads(SEED.read_text())["content"]["posts"])
    with tempfile.TemporaryDirectory(prefix="blog-emdash-d1-") as directory:
        temporary = Path(directory)
        structure_path = temporary / "structure.sqlite"
        full_path = temporary / "full.sqlite"
        seed_database(structure_path, include_content=False)
        seed_database(full_path, include_content=True)

        structure = sqlite3.connect(structure_path)
        full = sqlite3.connect(full_path)
        if table_schemas(structure) != table_schemas(full):
            raise ValueError("EmDash schemas differ between structure and full seed")

        changed = {
            table for table in table_schemas(full)
            if row_count(structure, table) != row_count(full, table)
        }
        if changed != set(CONTENT_TABLES) | FTS_TABLES:
            raise ValueError(f"Unexpected EmDash content tables: {sorted(changed)}")
        for table in CONTENT_TABLES:
            if row_count(structure, table) != 0 or row_count(full, table) != expected:
                raise ValueError(f"Unexpected row count in {table}")

        statements = [
            statement
            for table in CONTENT_TABLES
            for statement in insert_statements(full, table)
        ]
        # SQLite checks the same FK and FTS trigger behavior before any remote write.
        probe = sqlite3.connect(temporary / "probe.sqlite")
        structure.backup(probe)
        probe.execute("PRAGMA foreign_keys = ON")
        with probe:
            for statement in statements:
                probe.execute(statement)
        if list(probe.execute("PRAGMA foreign_key_check")):
            raise ValueError("Imported rows violate foreign keys")
        for table in CONTENT_TABLES:
            order = "entry_id, revision_id" if table.endswith("prune_queue") else "id"
            source_rows = list(full.execute(f'SELECT * FROM "{table}" ORDER BY {order}'))
            target_rows = list(probe.execute(f'SELECT * FROM "{table}" ORDER BY {order}'))
            if source_rows != target_rows:
                raise ValueError(f"Import differs from EmDash seed in {table}")
        if row_count(probe, "_emdash_fts_posts") != expected:
            raise ValueError("FTS index did not populate")

        OUTPUT.mkdir(parents=True, exist_ok=True)
        batch_path = OUTPUT / "posts.batch.json"
        batch_path.write_text(
            json.dumps([{"sql": statement} for statement in statements], ensure_ascii=False)
            + "\n"
        )
        print(f"Verified {expected} posts, {len(statements)} SQL statements")
        print(f"D1 batch: {batch_path}")
        print(f"Largest statement: {max(len(s.encode()) for s in statements)} bytes")


if __name__ == "__main__":
    main()
