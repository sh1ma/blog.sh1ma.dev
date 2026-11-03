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

初回公開時は EmDash のセットアップで記事データを取り込み、管理者アカウントと passkey を作成する。`EMDASH_ENCRYPTION_KEY` は cf CLI の Worker Secret に保存し、D1 バックアップとは別に保管する。公開中の `blog.sh1ma.dev` を切り替える前に、全記事 URL、RSS、サイトマップと管理画面を確認する。
