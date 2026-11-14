# TubeFolio2 開発ルール(どのPCで修正する場合も必ず守る)

## Google Drive 同期は必須
- 設定・登録データは、すべて Google Drive(appDataFolder の `tubefolio2.json`)に保存し、他のPCと共有する。対象のキーは [store.js](store.js) の `TF.SYNC_KEYS` の1か所だけで決める(`sync.js`・JSON書き出し/読み込みもこれを使う)。同期しないものの理由も、`store.js` のコメントにある。
- **新しい storage キーを足したら、必ず `TF.SYNC_KEYS` に加える**。対象外にするなら、`store.js` のコメントに理由を書く。
- 方式: キーごとに最後に変えた時刻(`syncMeta.k`)で新しい方を採る。hist / playedTags / plSeen は中身どうしを合わせる(`MERGE`)。2回目からは項目ごと(フォルダ・チャンネル・設定の項目)に3者統合する(`merge3`。前回の内容 `syncBase` はこの端末だけ)。初回はDriveを優先。詳細は `sync.js`。
- localStorage に新しい見た目の設定を足したら、[ui-sync.js](ui-sync.js) の `OK` に加える。
- 保存・取得の処理を変えたら、同期(変更の検知→rev更新→Driveへ送信 / 起動時・5分ごと・手動の取り込み)が壊れていないか確認する。
- `manifest.json` の `key` を消さない(拡張機能ID `ffjjmiikoghongpjbdcchhgclecokekm` を固定。OAuthのリダイレクトURIが紐づく)。

## ブラウザへの登録(Vivaldi / Chrome)
- 開発用フォルダではなく、コピー先の **`C:\Claude\TubeFolio2-ext`** を「パッケージ化されていない拡張機能」として登録する(古い登録ID `mkaj…` が開発用フォルダのパスに残り、再起動で消えたため)。
- 変更したら `deploy-ext.cmd` を実行し(`.git` と `CLAUDE.md` はコピーしない)、`vivaldi://extensions` で「再読み込み」。
- 別のPCで再起動後に消える場合も、別フォルダにコピーして登録し直す。

## 共有
- 変更は git でコミットして GitHub(tamamune/TubeFolio2)に push する。作業を始める前に `git pull`。

## 画面を作るときの決まり(ダーク / ライト両対応)
- 新しいページ・パネル・メニュー・バーは、**ダークとライトの両方で読める**ように作る。
- 色は直接書かず CSS変数(`--bg` `--fg` `--sub` `--line` `--chip` など)で持つ。ガラス調は `--g-*` で、両方の値を用意する。
- 切り替えの基準: YouTube上に出すもの(`content.css`)は `html[dark]` の有無(ライト用は `html:not([dark])`)。拡張機能のページ(`manager.*` / `page.*`)は `prefers-color-scheme`(YouTubeに埋め込むときは `theme.js` が `data-theme` を付ける)。
- `select` / `option` / 入力欄には背景色と文字色を明示する。無効・ホバー・選択中も両モードで確認。画像・アイコンは白一色・黒一色を避ける。
- 変更後は `deploy-ext.cmd` で反映し、両モードで見てからコミットする。

## スマホ(Vivaldi for Android)
- `manifest.json` に静的な declarativeNetRequest の `rule_resources` を書かない(`_metadata` ができ、次の読み込みが失敗する)。ルールは `background.js` の `updateSessionRules` で登録する。
- 名前が `_` で始まるファイル・フォルダを置かない(`_metadata` が残っていたら消す)。
- スマホでは `www.youtube.com` への通信が `m.youtube.com` に回るので、`background.js` のセッションルール(id 3)でパソコンとして名乗る。

## 登録チャンネルの同期(`TF.syncChannels`)
- YouTubeで登録している → 残す。
- 登録していないが、フォルダに入っている → 残す。`channels[キー].unsub = 1` を付け、管理画面で「🚫 未登録」と表示。
- どちらでもない → 一覧から消す。
