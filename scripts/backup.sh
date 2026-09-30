#!/bin/sh
# バックアップを取る。サーバを止めずに実行できる。
#   ./scripts/backup.sh [出力先のディレクトリ]
set -eu
cd "$(dirname "$0")/.."
dest="${1:-backups}"
mkdir -p "$dest"
file="$dest/wifi-planner-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose exec -T app node dist/backup.js > "$file"
echo "バックアップを作りました: $file"
