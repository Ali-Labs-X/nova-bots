# 在网页里选电脑上的任意文件夹

- 日期：2026-11-24
- 代码：`ops/mountd.mjs`、`portal/host-folders.mjs`、`ds-bot/src/client/folder-picker.js`

## 为什么

Bot 在容器里，选择器只看得到已经挂载的文件夹。以前要在终端里挂载再重启。

## 已定的行为

- `nova-mountd` 以用户身份在本机运行，只听一个只有该用户能打开的 unix socket，只由 portal 来问。不用 root。
- 接口都在 `/api/v1/host/`：`GET folders`、`GET mounts`、`GET mounts/status`、`POST requests`、`GET requests/<id>`、`GET|POST approve/<id>`、`DELETE mounts`。只有本机引擎的主人（`legacy` 租户）能用；改动要同源的 `Origin`。
- 应用页面由 Bot 的容器提供，所以页面里画的确认不算用户同意。批准在 portal 自己的窗口里，用密码：COOP 断开与应用窗口的联系，CSP 不许嵌入，限次数，记审计。
- 已经看得到的文件夹不用批准。新文件夹按原路径挂载，可选只读；容器重建约半分钟，失败就撤回。
- 先解析链接再判断。系统目录、Nova Bots 的数据和包含它们的目录不能挂。主目录和放密钥的目录可以挂，窗口里会警告。
- 断开只需同源和登录，Bot 会重启。

## 已知限制

- 每次挂载会打断正在干活的 Bot。
- 恶意页面仍可能画一个假的密码框骗用户；批准窗口的地址栏是唯一的凭据。
- 挂载的文件夹里的密钥 Bot 读得到。
