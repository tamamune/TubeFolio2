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

## ページ・画面を作るときの決まり(ダークモード / ライトモード)
- 新しいページ・パネル・メニュー・バーなど、画面に出るものは、**必ずダークモードとライトモードの両方で読める・見分けられる**ように作る。片方だけで作らない。
- 色は文字列(`#fff` など)を直接書かず、CSS変数(`--bg` `--fg` `--sub` `--line` `--chip` など)で持つ。ガラス調のバー・メニューは `--g-*` の変数で持ち、ダーク/ライトの値を両方用意する。
- 切り替えの基準:
  - YouTube のページ上に出すもの(`content.css`): `html[dark]` が付いている = ダーク、付いていない = ライト。ライト用の上書きは `html:not([dark])` で書く。
  - 拡張機能のページ(`manager.*` / `page.*`): OS の設定(`prefers-color-scheme`)に従う。YouTube に埋め込むときは `theme.js` が `data-theme="dark|light"` を付ける。
- `<select>` の一覧(`option`)、入力欄、ボタンの無効状態、ホバー、選択中の表示も、両方のモードで文字と背景のコントラストを確認する。`select` と `option` には、背景色と文字色を明示する(未指定だと、片方のモードで読めなくなる)。
- 画像・アイコンは、背景色に関係なく見えるものを使う(白一色・黒一色の絵は避ける)。
- 変更後は、`deploy-ext.cmd` で反映し、両方のモードで見た目を確認してからコミットする。
