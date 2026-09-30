# WiFi 配置計画

建物の図面に壁と AP を配置し、帯域ごとの電波強度を図面上で確かめる Web アプリケーションである。
複数の利用者が同じプロジェクトを同時に編集できる。

- 要件：[requirements.md](requirements.md)
- 設計：[docs/design.md](docs/design.md)
- 実装計画：[docs/plan.md](docs/plan.md)
- 運用の手順：[docs/operations.md](docs/operations.md)

## 起動

Docker Compose で起動する。
最初の管理者のパスワードを `.env` に書いてから起動する。

```sh
cp .env.example .env   # ADMIN_PASSWORD を書き換える
docker compose up -d
```

`http://localhost:3000` を開き、`.env` のユーザー名とパスワードでログインする。
最初の管理者は、ユーザーが一人もいないときだけ作られる。

## 開発

Node.js 24 以降と pnpm 10 を使う。

```sh
pnpm install
ADMIN_PASSWORD=dev-password pnpm dev   # サーバ（:3000）と Web（:5173）を起動する
```

Web の開発サーバは、`/api` と `/collab` をサーバに中継する。

| コマンド | 内容 |
| --- | --- |
| `pnpm test` | 単体テストと結合テスト |
| `pnpm e2e` | Playwright の E2E テスト（システムの Google Chrome を使う） |
| `pnpm typecheck` | 型チェック |
| `pnpm lint` | Biome による Lint と整形の確認 |
| `pnpm --filter @wifi-planner/propagation bench` | 伝搬計算のベンチマーク（NFR-1 の条件） |
| `pnpm --filter @wifi-planner/wall-extraction spike trace` | 合成図面での壁抽出の時間と再現率 |

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `apps/web` | React の Web アプリ（2D エディタ、疑似 3D ビュー、伝搬計算の Worker） |
| `apps/server` | Hono のサーバ（REST API、Yjs の同期、PDF のラスタ化と壁抽出の worker thread） |
| `packages/domain` | 文書のスキーマ、座標変換、チャネル表、材質、Y.Doc の操作 |
| `packages/propagation` | マルチウォールモデルの伝搬計算 |
| `packages/wall-extraction` | PDF のラスタ化と壁の自動抽出 |
| `packages/api-contract` | REST API の入出力の型 |
| `e2e` | E2E テスト |
