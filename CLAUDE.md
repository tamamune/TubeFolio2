# TubeFolio2 開発ルール(どのPCで修正する場合も必ず守る)

## Google Drive 同期は必須
- 各PCで登録した TubeFolio2 の設定・登録データは、すべて Google Drive(appDataFolder の `tubefolio2.json`)に保存し、他のPCでも共有できる状態を保つこと。対象のキーは [store.js](store.js) の `TF.SYNC_KEYS` の1か所で決める([sync.js](sync.js) の `SYNC_KEYS`・JSONの書き出し/読み込みが、これを使う)。今の対象: groups / channels / settings / meta / activity / cmt / px / folderRates / sleepWin / chSet / later / laterRemoved / folderSeen / cchap / pickMode / notifyRules / notifyFolders / focus / ui / bookmarks / playedTags / trendHours / fOpen / hideMembers / setGrp / cmtNames / hist(視聴履歴) / plSeen(再生リストの登録日)。
- 同期の方式は「キーごとの統合」: キーごとに最後に変えた時刻(`syncMeta.k`)を持ち、キーごとに新しい方を採る(全体を丸ごと上書きしない)。hist / playedTags / plSeen は、中身どうしを合わせる(`sync.js` の `MERGE`)。その端末で初めて同期するときは、Drive の内容を優先する。
- 拡張機能のページと YouTube のページの localStorage に入れている見た目の設定(テーマ・開いていたタブ・折りたたみなど)は、[ui-sync.js](ui-sync.js) が `ui` に写して同期する。localStorage に新しい設定を足したら、`ui-sync.js` の `OK` に加える。
- 同期しないもの(理由): YouTube 自身が共有しているデータ(視聴履歴の本体・登録チャンネルの本体・再生リストの本体)、取り直せるキャッシュ(feedCache_* / spub / chTitles / chAvCache / wbCache / ghCache / recent / plTargetId / plTargetName / plLaterIds(「TubeFolio2 後で見る」に入っている動画IDの控え)/ 急上昇の trendsCache4・trendsCache24・t1_<日付> / localStorage の tfPlSums)、この端末だけの記録・動作中の状態(tgLog / syncStatus / syncMeta / driveTok / notified・notifyQueue(この端末で通知したかどうか)/ queue・tfQueue(連続再生の途中)/ tfView / lastCheckAt / checkLock / ブックマークのサムネ画像 bmt:…)。
- 新しく保存するデータ(storage のキー)を追加したら、必ず `store.js` の `TF.SYNC_KEYS` に加えて同期対象にすること。同期対象外にするなら理由を明記する。
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
