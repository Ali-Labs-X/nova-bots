# 为 Nova Bots 做贡献

[English](CONTRIBUTING.md) | 中文

谢谢你的帮助。本文说明团队如何协作、如何搭建插件开发环境、如何测试改动，以及每项改动必须遵守的规则。插件能做什么、用户如何安装，见 [README.zh.md](README.zh.md)。

## 最重要的规则

1. **基于运行时开发，绝不修改运行时。** 机器人功能是一个插件：只使用有文档的插件 API（服务、插件客户端入口、profile 补丁）。不要修改智能体运行时，也不要依赖它安装目录里的文件。运行时缺少某项能力时，先在这里开 issue，修复可能属于上游。
2. **机器人的工作跑在运行时会话里。** 机器人保持自己的身份，工作则在会话中执行：自己的对话一个、每个群一个、上下文满了再开一个。每一轮都走正常的智能体循环、工具和模型路由。不要引入第二套运行时。
3. **任何地方都不要放真实密钥。** 不要提交 API key、token、cookie、home 目录、日志或含个人数据的截图。测试和测试台使用脚本化的 mock 模型，不需要密钥。
4. **只使用原创材料。** 不要复制其他产品或网站上的代码、文字、图标、logo 或图形。与 Apache 2.0 兼容的代码是唯一例外：注明来源，并把声明写进 `NOTICE`。
5. **每项改动都要测试。** 每次改动都运行单元测试和客户端检查（见[测试改动](#测试改动)）。

## 协作方式

团队里的任何人都可以做任何类型的工作：分诊、修 bug、做功能、界面、文档。只有部分决定属于维护者：产品方向、已定设计的变更、这些规则、发布和架构。需要这类决定的 issue 和 pull request 会带 `maintainer` 标签；在开始前等待维护者回复。

Nova Bots 的定位见 [docs/vision.zh.md](docs/vision.zh.md)；已确定的设计在 [docs/plans/](docs/plans/)，界面标准在 [docs/design/ui-standard.md](docs/design/ui-standard.md)。不确定某个行为是 bug 还是设计如此时，先读这些文档，再在 issue 里提问。

### 分支

| 分支 | 用途 | 谁合并 |
|---|---|---|
| `dev` | 集成分支。所有修复和功能先到这里 | 每次 CI 通过后，任何协作者 |
| `main` | 只放已发布代码。维护者发布时把 `dev` 合入，或合入 hotfix | 维护者 |
| `fix/<issue>-<name>`、`feat/<issue>-<name>`、`docs/<name>`、`chore/<name>` | 你的工作分支，从最新的 `dev` 开始 | — |

- 分支名不要以 `dev/` 开头。`dev` 分支存在时 Git 无法创建 `dev/<name>`。
- 同步分支用 `git merge dev`（hotfix 分支用 `git merge main`）。不要 rebase 已推送的分支，不要 force-push。
- pull request 的目标是 `dev`，不是 `main`；只有发布和 hotfix 进 `main`。

### Issue

1. **分诊。** 给每个新 issue 加类型、优先级和领域标签（见[标签](#标签)）。优先级只能有一个。
   - 安装或使用问题：转为 discussion。
   - 信息不足：加 `needs-info`，并说明缺少什么。注明 14 天无回复就关闭。
   - 原因在运行时或其他插件：加 `upstream`，并链接到正确的位置。
   - 与已有 issue 重复：加 `duplicate`，链接原 issue 并关闭。
2. **认领。** 开始前把 issue 分配给自己，并写下“我来处理”，避免两个人做同一件事。不要抢已有 assignee 的 issue；先在 issue 里询问。
3. **功能。** 新想法先在 Discussions（Ideas）提出。维护者同意后，转成带 `enhancement` 标签的 issue。动手前先在 issue 里写实现计划。大型功能要在同一个 pull request 里加 `docs/plans/<date>-<topic>.md` 设计说明。
4. **有依据地关闭。** 关闭 issue 时，链接修复它的 pull request 或 commit、它重复的 issue，或说明不修的原因。用 issue 本身的语言写评论。

### 标签

| 类别 | 标签 |
|---|---|
| 类型 | `bug` · `enhancement` · `documentation` |
| 优先级 | `P0` 崩溃、数据丢失或无法使用 · `P1` 影响日常使用 · `P2` 普通 bug 或功能 · `P3` 建议或边缘情况 |
| 领域 | `area/host` 服务端（`index.js`、`src/host/`） · `area/client` 界面（`src/client/`） · `area/group` 群聊、@、机器人互通 · `area/memory` 记忆、对话分段、上下文 · `area/browser` 机器人浏览器、读页、网页搜索 · `area/build` CI、发布、脚本、测试台 · `area/docs` |
| 流程 | `maintainer` 等待维护者 · `needs-info` 等待报告者 · `upstream` 原因在运行时或其他插件 · `duplicate` · `auto-found` 自动测试发现 |

跨多个领域或不属于任何领域的 issue 不加领域标签。

### Pull request

1. 目标分支为 `dev`，并填写模板。用 `Fixes #<number>` 链接 issue；修 bug 的 PR 必须写明修的是哪个 bug。
2. 在模板的 **Changelog** 字段写一句用户能感知的变化，或写“无”。不要编辑 `CHANGELOG.md`：维护者在发布时根据这些句子整理。
3. CI 通过后自己用 **Create a merge commit** 合并，然后删除分支。不强制评审；需要时在 PR 里请同事。
4. 合入 `dev` 的修复不会自动关闭 issue：`Fixes #<number>` 只对默认分支生效。issue 会保持打开到发布，表示“已在 `dev` 修复，尚未发布”。

一个 pull request 只解决一个 issue。大改动拆成多个 PR。

### 合并冲突

- **`ds-bot/client.js`**：不要手工解决。在 `ds-bot/src/client/` 里解决冲突，运行 `npm run build`，提交新的 `client.js`。
- **`CHANGELOG.md`**：PR 不应修改它，因此不应冲突。若冲突，两边都保留。

### 发布（维护者）

1. 在面向 `dev` 的 PR 里设置 `ds-bot/package.json` 的版本，并根据已合并 PR 的 Changelog 句子写 `CHANGELOG.md`。
2. 开一个 `dev` → `main` 的 PR，标题为 `release: vX.Y.Z`。描述里列出该版本的全部 `Fixes #<number>`，合并时这些 issue 会关闭。
3. 合并前在真实机器上运行[发布检查清单](docs/dev/release-checklist.md)，并把结果贴到 PR。用 merge commit 合并，打 `vX.Y.Z` 标签并发布。
4. hotfix 从 `main` 开 `fix/hot-<name>`，PR 目标为 `main`，发布补丁版本，再把 `main` 合回 `dev`。

## 搭建环境

需要：

- Node.js `22.19` 或更高版本。
- Git。
- 仅测试台需要：pnpm `11`，以及与本插件测试版本一致的智能体运行时 checkout。

```sh
git clone <your-nova-bots-repository> Nova-Bots
cd Nova-Bots/ds-bot

# 插件自己的构建工具（只有 esbuild）。
npm ci

# 单元测试和 linter 需要的运行时包，从 npm 安装到 dev/harness/。
npm run harness
```

运行时包是 peer dependency：真实安装时由 profile 提供。`ds-bot/.npmrc` 阻止 npm 把它们装进插件目录。

## 目录

| 路径 | 内容 |
|---|---|
| `ds-bot/index.js`、`ds-bot/src/host/` | 服务端：机器人名册与存储、工具、轮次与投递、群聊、对话分段与搜索索引、图片、机器人浏览器桥、`api/bot` 通道 |
| `ds-bot/src/client/` | 浏览器端：侧栏、对话、面板与对话框、主题、角色、机器人浏览器面板 |
| `ds-bot/client.js` | 由 `scripts/build-client.mjs` 从 `src/client/` 生成。它被提交进仓库，Git 安装无需构建 |
| `ds-bot/web-search.js` | `auto` 网页搜索提供者，不依赖机器人团队代码 |
| `ds-bot/cordis.patch.yml` | 插件带来的 profile 补丁 |
| `ds-bot/test/` | 单元测试与 fixture |
| `ds-bot/dev/` | 测试用运行时包（`harness/`）、mock 模型、测试台、冒烟测试、角色生成器、Linux 桌面脚本，以及两个真实模型工具：steward 评估和日志透传 |

## 测试改动

在 `ds-bot/` 中运行：

```sh
npm run build                          # src/client → client.js
npm test                               # 单元测试；client.js 过期也会失败
node scripts/build-client.mjs --check  # client.js 与 src/client 一致
npm run lint                           # oxlint
```

CI 在 Linux 和 Windows 上对每个 PR 运行同样三项检查，并扫描受版本控制的文件中的密钥、token、个人路径、邮箱和必须留在本地的材料。

改动服务端（`index.js`、`src/host/`）时还要跑冒烟测试。它启动 mock 模型和链接了当前 checkout 的 Web 运行时，走一遍主要流程（机器人、群聊、对话分段、压缩、设置）。`CONTEXT_WINDOW` 和 `CHECK_RATIO` 让 mock 模型拥有很小的窗口，几条长回复就会到达检查线：

```sh
CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh smoke 3096 8796 reset && node dev/smoke.mjs smoke 3096
dev/bench.sh smoke 3096 8796 stop
```

手动试用插件时，启动测试台并打开它打印的地址：

```sh
dev/bench.sh dev 3081 8771 reset    # mock 模型 + Web 运行时；数据在 ../.dsh-test-dev
```

mock 模型只回答固定命令，所以测试台不消耗 token。命令列在 `dev/mock-llm.mjs` 顶部。测试台数据留在插件目录旁的 `.dsh-test-<name>/`，不会碰你自己的数据。

改动上下文 steward 或其提示词（`src/host/steward.js`）时，还要在真实模型上检查。`dev/steward-eval.mjs` 在固定对话结尾上运行它的决策，`dev/llm-tap.mjs` 记录真实测试台的每次调用。两者都会消耗 token，用法写在文件顶部。

改动机器人浏览器时，在桌面运行时里检查。Linux 上 `dev/desktop-linux/` 的脚本用 Xvfb 启动桌面运行时；每个脚本顶部都有用法。

## 编写改动

- 一个改动只做一件事。
- 不要手工编辑 `client.js`。改 `src/client/`，运行 `npm run build`，两个文件一起提交。
- `src/client/` 里的颜色取自 `--bt-*` 变量，圆角取自 4、6、8、10、12、16、18、20、22、999px 和 50%，弹簧动画取自 `motion.js`。单元测试会检查。测试之前写下的位置记录在 `test/style-debt.json`，这个列表只会变短。删掉一条后运行 `node scripts/style-debt.mjs --write` 更新。
- 跟随周围代码的风格。只有代码本身说不清原因时才写注释。
- 提交信息用英文。主题行用祈使句、简短（“Keep group replies visible”），正文说明原因。
- 提交作者是做出改动的人。AI 工具参与时，不要把它设为作者或加 `Co-authored-by`。
- 不要编辑 [CHANGELOG.md](CHANGELOG.md)。把用户可见的变化写进 PR 模板的 Changelog 字段。

## 报告问题

最方便的方式是在 Nova Bots 里打开 **设置 → 反馈**，写下发生了什么；配置了 issue 跟踪器时，选择 **Report on GitHub**。它会带着 Nova Bots 版本、系统、模型和最近错误打开一个新 issue。**Copy** 把同样的文本放进剪贴板，**Download** 保存完整错误日志（`<home>/bot/logs/diagnostics.jsonl`）。

手动开 issue 时请包含：

- Nova Bots 版本和安装方式。
- 操作系统和运行方式（Docker 或插件安装）。
- 你做了什么、期望什么、实际发生了什么，以及完整错误文本。
- 整个窗口的截图，包含对话和错误。
- 复现步骤。

Nova Bots 会从诊断信息里移除 API key、token、保存的密钥和 home 目录。发布前请先读一遍，并清理截图里的个人数据。

安全问题不要开公开 issue，使用仓库 **Security** 页的 **Report a vulnerability**。

issue 只用于 bug。问题、想法和功能请求放在 Discussions。维护者接受的想法会转成 issue。

## 许可证

Nova Bots 使用 [Apache License 2.0](LICENSE)。提交贡献即表示你同意按同一许可证授权，如许可证第 5 节所述。
