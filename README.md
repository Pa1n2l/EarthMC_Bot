# EarthMC Discord Bot (EBot)
EarthMC のデータ取得、崩壊予定の町リスト表示、各種通知機能を備えたDiscord Botです。

## 🌟 主な機能
- `/falling`: 崩壊予定（7日以内）の町を一覧表示
  - **キャッシュ機能**: 毎日 JST 19:00 の自動更新およびファイル保存（`falling_cache.json`）により、API制限（429エラー）を回避して高速レスポンスを実現
  - **ソート機能**: 残り時間順、住民数順、残高順、プロット数順などで並び替え
  - **国家絞り込み**: `nation` オプションによる特定国家の町フィルタリング
  - **ボタンページネーション**: ページ切り替え（`<<` `<` `>` `>>`）対応
- **タスク機能**: Vote Party 通知やウォッチャー機能などのバックグラウンドタスク

## 📝 Todo
- `/res` や、その他コマンドのオプトアウト対策

---

## 🛠️ 必須要件
- **Node.js** v18 以上
- **MySQL** / **MariaDB** データベース

---

## 🚀 導入手順
### 1. リポジトリのクローン & 依存関係のインストール
```bash
git clone https://github.com/Pa1n2l/EarthMC_Bot.git
cd EarthMC_Bot
npm install
```
### 2. 環境変数の設定
`.env.example` を `.env` と改名し、環境に合わせて接続情報を入力してください。
例:
```.env
TOKEN=YOUR_DISCORD_TOKEN_HERE
API=https://api.earthmc.net/v4/
PLAYERS_API_URL=https://api.earthmc.net/v4/players
TOWNS_API_URL=https://api.earthmc.net/v4/towns
NATIONS_API_URL=https://api.earthmc.net/v4/nations
MAP_BASE_URL=https://map.earthmc.net/

ADMIN_ID=1234567890987654321

DB_HOST=example.com
DB_PORT=3306
DB_USER=root
DB_PASS=password1234
DB_NAME=default
```

### 3. Botの起動
```bash
npm start
```
