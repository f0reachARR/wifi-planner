#!/bin/sh
# バックアップから復元する。今のデータは消えるので、先にバックアップを取っておくこと。
#   ./scripts/restore.sh backups/wifi-planner-YYYYmmdd-HHMMSS.tar.gz
set -eu
cd "$(dirname "$0")/.."
file="${1:?復元するバックアップのファイルを指定してください}"
[ -f "$file" ] || { echo "ファイルがありません: $file" >&2; exit 1; }
printf '今のデータを消して %s から復元します。よろしいですか？ [y/N] ' "$file"
read -r answer
[ "$answer" = "y" ] || { echo "中止しました"; exit 1; }
docker compose stop app
docker compose run --rm -T --no-deps --entrypoint sh app -c 'rm -rf /data/app.db /data/app.db-wal /data/app.db-shm /data/uploads && tar -xzf - -C /data' < "$file"
docker compose start app
echo "復元しました"
