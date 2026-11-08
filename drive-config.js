// Google Drive 同期の設定(リポジトリで共有。クライアントIDは秘密情報ではない)
// Google Cloud Console で「ウェブ アプリケーション」の OAuth クライアントIDを作成し、下に貼る。
//   承認済みのリダイレクト URI: https://ffjjmiikoghongpjbdcchhgclecokekm.chromiumapp.org/
//   スコープ: https://www.googleapis.com/auth/drive.appdata (Drive API を有効化)
// 拡張機能ID(ffjjmiikoghongpjbdcchhgclecokekm)は manifest.json の "key" で固定しているため全PC共通。
const DRIVE_CLIENT_ID = '553603750505-dl24a331609bfjvd38n378703b5plk9e.apps.googleusercontent.com';
