# blog

sh1ma のブログ ([blog.sh1ma.dev](https://blog.sh1ma.dev))。公開画面は Astro、記事管理は [EmDash](https://github.com/emdash-cms/emdash)、実行環境は Cloudflare Workers + D1 + R2。

## ローカル開発

```sh
pnpm install
pnpm exec emdash secrets generate --write .dev.vars
pnpm dev
```

`http://localhost:4321/_emdash/admin/` の初回セットアップで記事データを含めると、`seed/seed.json` の日本語 24 件・英語 24 件が取り込まれる。既存の記事 URL は `/articles/:slug` と `/en/articles/:slug`。

`src/markdown/posts/` は移行元の記録として残している。`pnpm build:seed` はそこから初回セットアップ用 seed を再生成する。運用開始後の記事編集は EmDash の D1 データベースが正本で、seed の再生成や再デプロイは公開済み DB の記事を上書きしない。

既存 48 記事の OGP 画像は旧サイトの `/og/` から `scripts/import-legacy-ogp.mjs` で取得して `public/og/` に保持する。記事の `og:*` と `twitter:*` は現在の EmDash データから出す。新しい記事は `thumbnail` URL を OGP 画像に使い、未設定ならサイトのアイコンを使う。既存記事の画像は旧タイトル入りの静的 PNG なので、タイトルを変更した場合は画像も更新する。

## 検証

```sh
pnpm check
pnpm typecheck
pnpm build
pnpm exec cf deploy --prebuilt --dry-run --mode production
pnpm test:e2e
```

E2E はテスト専用のローカル SQLite に seed を入れ、Node アダプタで起動する。Cloudflare 向け本番ビルドは `pnpm build` で作る。

## 公開

Astro アダプタが `wrangler.jsonc` から生成する Worker 設定を cf CLI 用 Build Output に変換し、`cf deploy --prebuilt` で公開する。本番 Worker は `blog`、ステージングは `blog-staging`。D1 と R2 は環境ごとに別名で定義している。ステージングの自動デプロイと PR プレビューは、専用 CMS リソースの準備後に GitHub Variables の `EMDASH_STAGING_READY` / `EMDASH_PREVIEW_READY` を `true` にすると有効になる。

ステージングの `/_emdash/` は初回管理者を第三者に作られないよう `EMDASH_ADMIN_DISABLED=1` で 403 にしている。管理画面を使う段階では、先に認証によるアクセス制限を用意してからこの設定を外す。配備ワークフローは同じ D1 に未適用の EmDash migration がある場合、公開前の `emdash migrate --check` で止まる。

本番の既存 Worker を切り替える前に、同じ `blog` Worker の版 URL で新しい D1 を初期化し、記事を投入する。cf 認証と配備の承認を得てから、同じビルド成果物に対して順番に実行する。

```sh
pnpm build
pnpm exec cf workers versions create --prebuilt --mode production --preview-alias emdash-migrate
```

`https://emdash-migrate-blog.sh1ma.workers.dev/` を開いて D1 の初期化を開始する。版 URL の `/_emdash/` は Worker が 403 で拒否する。`cf d1 list --name blog-emdash` で新しい DB の ID を確認する。初回アクセスで 503 が返る場合は、同じビルドの `.emdash/migrations.json` を使い、EmDash の [core migration 手順](https://docs.emdashcms.com/deployment/core-migrations/) に従って未適用分を完了させる。`emdash migrate` には D1 への書き込み権限を持つ `CLOUDFLARE_API_TOKEN` が必要。ロックが残る場合は `--status` の適用件数とロック ID が動いていないことを確認してから引き継ぐ。

マイグレーション後に版 URL を再読して seed のスキーマを適用し、`ec_posts` が空であることを確認してから記事を投入する。

```sh
pnpm prepare:d1-import
export EMDASH_D1_ID="REPLACE_WITH_D1_UUID"
pnpm exec emdash migrate --check --account-id "$CLOUDFLARE_ACCOUNT_ID" --d1 "$EMDASH_D1_ID"
pnpm exec cf d1 query "$EMDASH_D1_ID" --sql 'SELECT COUNT(*) AS count FROM ec_posts'
pnpm exec cf d1 query "$EMDASH_D1_ID" --batch @.emdash/d1-import/posts.batch.json
pnpm exec cf d1 query "$EMDASH_D1_ID" --sql 'SELECT locale, COUNT(*) AS count FROM ec_posts GROUP BY locale'
pnpm verify:site https://emdash-migrate-blog.sh1ma.workers.dev
```

投入前は 0 件、投入後は `ja` と `en` が各 24 件であることを確認する。`prepare:d1-import` は現在の EmDash による空 DB と 48 記事入り DB を比較し、記事・リビジョンの SQL 144 文を生成してローカル DB に再適用してからファイルを出す。想定外のテーブル差分や外部キー違反があれば中断する。

版 URL 上で記事を確認してから、同じ成果物を本番に配備する。`EMDASH_ENCRYPTION_KEY` を含む保護された dotenv ファイルを `--secrets-file` に渡し、キーは D1 バックアップとは別に保管する。

```sh
pnpm exec cf deploy --prebuilt --mode production --secrets-file /path/to/protected-env-file
pnpm verify:site https://blog.sh1ma.dev
```

本番ドメインの `/_emdash/admin/` で管理者と passkey を作成する。記事は事前投入済みなので、セットアップ画面では **Include sample content を外す**。配備前のサイト・D1・R2 に変更が必要な段階では、公開中の Worker はそのままにする。
