#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["boto3"]
# ///
"""Import shortlinks from a Supabase JSON export into DynamoDB.

Reads step-1 export files, writes items {pk:"LINK", sk:short, id, short,
link, created_at} with BatchWriteItem (25/batch, retries unprocessed).
Idempotent (plain puts), so it can run again at cutover.

Usage:
    uv run scripts/import-links.py --table Shortlinks [--dry-run] <export.json>...
"""

import argparse
import glob
import json
import sys
import time

import boto3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="*", help="Export JSON files or globs")
    parser.add_argument("--table", required=True, help="DynamoDB table name")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths: list[str] = []
    for pattern in args.inputs or []:
        matches = sorted(glob.glob(pattern))
        paths.extend(matches if matches else [pattern])

    rows: list[dict] = []
    for path in paths:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, dict):
            data = data.get("rows", data.get("data", []))
        rows.extend(data)

    print(f"rows read: {len(rows)}")

    skipped_empty = 0
    skipped_duplicate = 0
    seen: set[str] = set()
    items: list[dict] = []
    for row in rows:
        short = (row.get("short") or "").strip()
        link = row.get("link") or ""
        if not short:
            skipped_empty += 1
            continue
        if short in seen:
            skipped_duplicate += 1
            continue
        seen.add(short)
        items.append(
            {
                "pk": "LINK",
                "sk": short,
                "id": row.get("id") or short,
                "short": short,
                "link": link,
                "created_at": row.get("created_at") or "",
            }
        )

    print(f"rows to write: {len(items)}")
    print(f"skipped (empty short): {skipped_empty}")
    print(f"skipped (duplicate short): {skipped_duplicate}")

    if args.dry_run or not items:
        print("dry run: nothing written" if args.dry_run else "nothing to write")
        return 0

    client = boto3.client("dynamodb", region_name=args.region)
    written = 0
    request_items = [
        {"PutRequest": {"Item": {k: {"S": str(v)} for k, v in item.items()}}}
        for item in items
    ]
    for i in range(0, len(request_items), 25):
        batch = request_items[i : i + 25]
        unprocessed = {args.table: batch}
        for _ in range(10):
            response = client.batch_write_item(RequestItems=unprocessed)
            unprocessed = response.get("UnprocessedItems", {})
            if not unprocessed or not unprocessed.get(args.table):
                break
            time.sleep(1)
        done = len(batch) - len(unprocessed.get(args.table, []))
        written += done
        if unprocessed.get(args.table):
            print(
                f"WARNING: {len(unprocessed[args.table])} unprocessed items in batch",
                file=sys.stderr,
            )

    print(f"rows written: {written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
