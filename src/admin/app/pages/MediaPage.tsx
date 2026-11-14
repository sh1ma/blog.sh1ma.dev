import { classicUrl } from "../../routes"
import { MediaLibrary } from "../components/MediaLibrary"
import { useDocumentTitle } from "../router"

export function MediaPage() {
  useDocumentTitle("メディア")
  return (
    <div className="bwa-page">
      <h1 className="bwa-page__title">メディア</h1>
      <p className="mb-6 text-muted">
        画像をクリックすると詳細 (alt の編集・URL
        のコピー・使われている記事・削除) を開きます。 フォルダなどは
        <a className="mx-1 text-accent" href={classicUrl.media}>
          EmDash のメディア画面
        </a>
        で。
      </p>
      <MediaLibrary mode="page" />
    </div>
  )
}
