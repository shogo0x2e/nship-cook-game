# Production release

`production` への所有者による push だけを `.github/workflows/production.yml` が処理します。
PR・fork・他ブランチ・手動 dispatch は対象外です。GitHub-hosted Ubuntu runner で
Node26.13.1のテスト、ビルド、家庭アカウントとアバターのE2E、Docker起動・画像素材の配信を検証し、コミット別の公開GitHub Releaseに
`image.tar.gz` と SHA-256付き `release.json` を置きます。旧6桁コード版は
`family-account-v1` のAPI検証を通らないため、この経路でリリースできません。

公開repoには self-hosted runner を登録しません。本番VMの固定スクリプトが、所有者の
`production` push workflowの成功、コミット・タグ・イメージID・ハッシュを確認して取り込みます。
VMでリポジトリのシェルスクリプトやPRを実行せず、GitHubトークンも配置しません。
VM側のスクリプトとsystemd設定は、別のhomelab-infra repoで管理します。

## Runtime contract

- コンテナ: linux/amd64、Node26.13.1、UID/GID1000:1000、root filesystem read-only。
- `HOST=0.0.0.0`、`PORT=8787`、`NODE_ENV=production`。
- `DATA_DIR=/data`。SQLiteは `/data/cookgame.sqlite`、ファイル0600。
- ホスト `/opt/cookgame/data`（1000:1000・0700）を `/data` にbind mount。
- `APP_REVISION` はリリースの完全なGitコミットSHA。
- `ALLOWED_ORIGINS=https://cookgame.shogo0x2e.com`。TLSは既存の専用Tunnel経路を利用。
- コンテナポートはVMのloopbackだけに公開。SSH・Cloudflareトークン・DBはイメージに含めない。
- `/api/version` は `{revision: APP_REVISION, authentication: 'family-account-v1'}`。

## Release a verified commit

アカウント実装とこのブランチを統合し、検証したコミットから `production` を作成／更新します。
旧コードだけでproductionを作成しないでください。初回以外はfast-forwardで更新します。

```sh
# 統合・検証済みのブランチで
git switch production  # 初回は git switch -c production <検証済みSHA>
git merge --ff-only <検証済みSHA>
git push -u origin production
gh run list --workflow production.yml --branch production
```

workflowの最終結果がsuccessになり、対応するReleaseが完成してからVMに適用します。
VM側は準備時にtimerを無効のまま設置します。アカウント版の検証が完了し本番反映するときに、管理SSHから:

```sh
sudo /usr/local/sbin/cookgame-release check   # 検証だけ。稼働アプリは変更しない
sudo systemctl start cookgame-release.service
sudo systemctl enable --now cookgame-release.timer
```

timerは以後5分ごとに新しいproductionコミットを確認します。これは更新確認用で、
公開を止める期限や14日後の停止設定ではありません。同一SHAは再デプロイしません。
失敗したworkflowや作成途中のReleaseは取り込まず、次の確認へ持ち越します。
同じSHAのReleaseを書き換えず、修正は新しいコミットで公開してください。

## Persistence and rollback

イメージを取得・検証してからアプリを一旦停止し、SQLiteを含むデータディレクトリと
Compose／環境設定を `/opt/cookgame/backups/<時刻>-<旧SHA>/` へ退避します。
新イメージ起動・アカウントAPI検証に失敗したら、更新前のデータとイメージへ自動復元します。
DBマイグレーション失敗時も、失敗後のデータは退避してから旧スナップショットを戻します。

管理者が明示的に戻すときは、自動更新を先に止めてから実行します。

```sh
sudo systemctl disable --now cookgame-release.timer
sudo /usr/local/sbin/cookgame-release rollback <スナップショット名>
# 初期21b72b2へ戻すときだけ: rollback initial
```

`initial` には初期イメージと設定・ソースbundleを保持します。初期版へ戻しても、後から作成した
アカウントDBは削除しません。アカウント版同士のrollbackはスナップショット時点のデータに戻るため、
それ以降の変更は別の退避データに残ります。自動のイメージ／バックアップ削除は行いません。
空き容量が2GiB未満なら新規リリースを拒否します。同じVM内の退避はホスト故障へのバックアップには
ならないため、家庭アカウントを継続利用する場合はDBの別ホストへの保管も必要です。

本番の画面・HTTPSとアカウントの端末間共有は、適用後に別途確認してください。
