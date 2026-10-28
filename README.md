# Azarasi SMP Website

既存のデザインを維持したまま、Minecraftサーバーのオンライン状態、稼働時間、停止時間、稼働率、直近の状態グラフを表示するNode.jsサイトです。

## サイトのステータス表示

トップページの「サーバーステータス」で、Minecraft Javaサーバー `mc.azarasi.f5.si:25664/TCP` をRender上のNode.jsサーバーからServer List Pingします。

- オンライン／オフライン表示
- 現在のプレイヤー数
- 現在の稼働時間
- 現在の停止時間
- Renderが監視できた時間に対する稼働率
- 直近120回分のオンライン／オフライン履歴グラフ

ステータスは15秒ごとに更新します。稼働時間と停止時間はRenderサービスの再起動・スリープでリセットされます。長期間の正確な監視履歴を残すには、外部監視サービスまたは永続データベースが必要です。

トップページ下部の「Renderからのポート確認」では、次の3ポートを個別に確認します。

- `24640/UDP`: SMP本体のSimple Voice Chat
- `1100/UDP`: ロビー用Simple Voice Chat
- `19520/UDP`: Bedrock。Bedrock Server List Pingで確認

APIは`GET /api/status`と`GET /api/ports`です。サイトは15秒ごとに再取得します。Simple Voice ChatのUDPポートは一般的なTCPのような接続確立を返す仕組みではないため、RenderからUDPプローブを送信できた場合に「送信OK」と表示します。UDPの「送信OK」は、アプリケーションが応答したことではなく、Render側から送信処理まで成功したことを示します。

## Minecraftホスト側のポート

次のポートはMinecraftサーバーと同じLAN内のホストでUPnP再開放します。`port-reopen.sh`に含めています。

- `24640/UDP`: SMP本体のSimple Voice Chat
- `1100/UDP`: ロビー用Simple Voice Chat
- `19520/UDP`: Bedrock
- `25664/TCP`: Minecraft Javaサーバー本体とステータス取得対象

HTTP用の`5184/TCP`は使用しないため、サイト・UPnPスクリプトから削除しました。Render側にはUPnP処理を追加していません。`port-reopen.sh`はMinecraftサーバーと同じLAN内のホストでのみ実行してください。

## Renderへのデプロイ

1. このフォルダをGitHubリポジトリへpushします。
2. Renderで **New > Web Service** を選び、リポジトリを接続します。
3. Build Commandは `npm ci`、Start Commandは `npm start` にします。
4. `render.yaml`を使う場合はBlueprintとして読み込みます。
5. `ADMIN_PASSWORD`と、Discord通知を使う場合は`DISCORD_TOKEN`をRenderのSecretとして設定します。

Renderの公開Web ServiceはHTTP用のポートを1つだけ公開します。Minecraft本体は現在のホストで`25664/TCP`を待ち受け、Renderサイトはその状態を取得します。

## 環境変数

`PORT`はRenderが自動設定するため、通常は変更不要です。必要に応じて次を設定できます。

```text
MC_HOST=mc.azarasi.f5.si
MC_PORT=25664
MC_TIMEOUT_MS=5000
ADMIN_PASSWORD=任意の管理者パスワード
DISCORD_TOKEN=任意（Discord通知を使う場合）
CONTACT_CHANNEL_ID=1334457867012669440
```

ブログ・お問い合わせのJSONファイルはRenderの再デプロイで永続保存されない場合があります。長期運用する場合は、RenderのPersistent Diskまたは外部データベースへの移行を検討してください。
