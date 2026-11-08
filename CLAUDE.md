# TubeFolio2 開発ルール(どのPCで修正する場合も必ず守る)

## Google Drive 同期は必須
- 取得したデータ・設定(`chrome.storage.local` の `groups` / `channels` / `settings` / `meta` / `activity`)は、必ず Google Drive(appDataFolder の `tubefolio2.json`)に保存し、他のPCでも共有できる状態を保つこと。実装は [sync.js](sync.js)、設定は [drive-config.js](drive-config.js)。
- 新しく保存するデータ(storage のキー)を追加したら、必ず `sync.js` の `SYNC_KEYS` に加えて同期対象にすること。同期対象外にするなら理由を明記する。
- 保存や取得の処理を変更しても、同期(ローカル変更の検知→rev更新→Driveへ送信 / 起動時・5分ごと・手動での取り込み)が壊れていないことを確認すること。
- 拡張機能IDは `manifest.json` の `key` で固定している(`ffjjmiikoghongpjbdcchhgclecokekm`)。`key` を消さない。OAuthのリダイレクトURIはこのIDに紐づく。

## ブラウザへの登録(Vivaldi / Chrome)
- ブラウザには、開発用フォルダ(`C:\Claude\TubeFolio2`)ではなく、コピー先の **`C:\Claude\TubeFolio2-ext`** を「パッケージ化されていない拡張機能」として登録する。
- 理由: `manifest.json` に `key` を追加する前の古い登録(ID `mkaj…`)が、開発用フォルダと同じパスでブラウザの設定に残っており、再起動のたびに拡張機能が読み込まれず消えていたため。別のパスから登録し直したところ、消えなくなった(2026-11-08確認)。
- 変更したら `deploy-ext.cmd` を実行して、コピー先へ反映する(`.git` と `CLAUDE.md` はコピーしない)。そのあと `vivaldi://extensions` で「再読み込み」を押す。
- 別のPCでも、再起動で消える場合は、同じ手順(別フォルダにコピーして登録し直す)を試す。

## 共有
- このルール自体を含め、変更は git でコミットして GitHub(tamamune/TubeFolio2)にpushし、全PCで共有する。作業を始める前に `git pull` する。
