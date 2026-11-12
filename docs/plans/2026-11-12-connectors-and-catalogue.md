# 连接器与连接器目录

- 日期：2026-11-12
- 相关：本功能尚未开 Issue；[浏览器、联网搜索、密钥和连接器](2026-10-08-browser-and-secrets.md)（连接器一节要改写，待 Jahanzaib 确认）、[Bot 运行配置](2026-10-10-bot-runtime.md)

## 为什么

- 现在 Connectors 页只有 GitHub 一行，因为连接器在代码里就是一块写死的 GitHub：`ds-bot/src/host/connectors.js` 里的 id 是 `github`、密钥是 `GITHUB_TOKEN`、地址是 `https://api.githubcopilot.com/mcp/`、身份探针打 `api.github.com/user`、挂载带 `Authorization` 和 `X-MCP-Toolsets`、`known(id)` 对别的 id 直接抛错、`connectorsView()` 只回一个元素的数组。客户端同样是 GitHub 专用：`ds-bot/src/client/connectors.js` 只有一枚图标、一句说明、一个 PAT 链接、一个 `t('GitHub token')` 输入框。
- 用户要的不是「多接一个服务」，是**看得见的库**：能连什么、要不要账号、要不要卡、免费额度到哪、能不能自托管。写死一个服务的时候，这个库不存在。
- 所以定两件事：连接器变成**数据驱动的定义**，按 Bot 授权，像能力一样；库里放一份**诚实的目录**，每行写清楚凭据、费用、许可证和版本。

## 已定的行为

### 连接器定义（数据模型）

一个服务 = 一条定义，放在我们仓库里审核过的目录中（不放在用户的数据里）。字段：

- `id`：小写加连字符，唯一，最多 32 字符，不能和能力同名（工具名空间 `mcp__<id>__` 会撞）。
- `name`：显示名。`about`：一行说明。`icon`：图标，取不到时用首字母。
- `secretName`：这个连接器用的密钥名，按 `SECRET_NAME` 校验（`secrets.js:13`），命名规则 `<SERVICE>_<THING>`（如 `GITLAB_TOKEN`、`SLACK_TOKEN`、`PG_PASSWORD`）。**一个连接器一个密钥。**
- `url`：MCP 端点。`headers`：请求头，值写 `$NOVA_SECRET_<名字>` 这样的**引用**，不写值。`extraHeaders`：服务自己的额外请求头。
- `probe`：可选的连通性/身份探测 `{ url, headers, accountPath }`。没有 `probe` 就只看挂载本身的结果。
- `fields`：连接表单要问的字段 `[{ key, label, secret }]`，`secret: true` 的字段用遮罩输入。
- `authKind`：`none | token | oauth | account`。`category`：目录里的类别。
- `licence`、`selfHostable`、`freeTier`、`paid`、`version`、`verifiedOn`：目录那一页要用的字段；`docsUrl`、`docsLabel`：去哪儿拿凭据。

### 挂载：按 Bot 授权

- 连接器像能力一样**按 Bot 挂载**：密钥按 Bot 解析（和 `capabilities.js:267-284` 同一套），密钥保持 `scope: []`，**没有授权的 Bot 看不到这些工具**。
- 这**改变今天 GitHub 的行为**（今天是全团队可见），需要维护者明确同意后才算生效。
- 每个连接器的工具名是 `mcp__<id>__<工具>`；每个 Bot 各自挂载，互不影响。
- 挂载有 15 秒上限和 stalled 集合（照 `capabilities.js:352`、`:404-419`），并限制每个 Bot 的服务器数量。
- 远程 MCP 的地址或请求头变了以后要**重新批准**才能再挂载，语义和改了配置的 stdio 服务一样，用现有的配置哈希机制（`capabilities.js:309-310`）加批准状态实现，不另造机制。用户改过地址的远程 MCP 会退回「待批准」。

### 密钥

- 值只由用户输入，存在 `bot/secrets.json`，只出现在发往该服务的 MCP 请求头里，请求头在内存里生成，不写进运行时的 profile。
- 连接器**不把密钥加进任何 Bot 的 shell**；用户可以在 Secrets 页面上自己放开。
- 连接器不新增、不删除、不改别人的密钥名；密钥名来自定义。
- 每个连接器的凭据只存在于一个地方——团队密钥库——只用于一个地方：该连接器自己端点的请求头，挂在内存里现构造。它不进 Nova profile，不进任何 Bot 的 shell，不出现在工具结果或模型请求里，也不到别的连接器的端点。

### 连接流程

- 表单按 `fields` 渲染，通用代码一套；没有字段的服务不需要表单。
- 连接时先跑 `probe`（如果有）：拿凭据问一次服务，取 `accountPath` 指到的字段作为账号名。账号名**显示前过滤**：限制长度、去掉控制字符，不允许它伪装成别的账号。
- 账号名的合法形态：`/^[A-Za-z0-9._-]+$/`，最多 64 个字符，没有尖括号，没有控制字符。**整体不合法（全是符号，或过滤后为空）时拒绝这次连接**，错误信息点名是哪个服务；不显示空账号，也不挂载。
- 探测定不下服务不是通过的判据——最终以挂载成功为准；探测失败但服务能用时，报连接失败并说明探测这一步。
- 删除密钥 = 断开。

### 设置 → 连接器这一页

- **列出目录里的每一条**，连没连都列；状态是「未连接 / 连接中 / 已连接 / 连接失败」四种。
- 页面不重复许可证、价格和安装步骤——那些在 `docs/connectors.md` 里。
- **加一个服务不需要改客户端**：定义在服务端，图标取不到就用首字母，表单按 `fields` 渲染。

### 配置

- `rt.config.connectors` 是按 id 的**映射**（`{ github: false }` 继续有效）；`false` 表示这个连接器不装。

### 目录文档

- `docs/connectors.md`（英文）+ `docs/connectors/<服务>.md`：表格的列直接映射到上面定义的字段，**表和代码不会各走各的**。
- 表格九列：服务、类别、用途、凭据、可自托管、免费额度、付费、许可证、版本/日期。价格必带来源和日期，读不到就写 `unverified`。
- 需要卡或有付费账号的服务标 `needs a card`，且**不排在同类第一行**。
- 类别内顺序：免密钥本地 → 自托管 → 免费托管 → 付费。

### 目录的表头与字段的对应

表格列固定为九列，中英文表头一一对应，目录页和每行的详情页分开：

| 目录列 | 中文表头 | 定义字段 | 详情页 |
|---|---|---|---|
| Service | 服务 | name | url、icon |
| Category | 类别 | category | — |
| What it does | 用途 | about | — |
| Credential | 凭据 | authKind、secretName | fields、secretName 的存放方式 |
| Self-hostable | 可自托管 | selfHostable | 运行方式 |
| Free tier | 免费额度 | freeTier | — |
| Paid | 付费 | paid | 价格来源和读到的日期 |
| Licence | 许可证 | licence | — |
| Version / date | 版本 / 日期 | version、verifiedOn | — |

- 详情页另有：运行方式（内置技能 / 本地进程 stdio / 远端端点 streamable-http）、安装步骤、提供的工具、凭据怎么管、标注、价格来源、核对日期。
- 目录参考页是英文的（`docs/local-models.md` 是先例）；中文在 `README.md` / `README.zh.md` 和界面文案（`ds-bot/src/client/i18n.js` 的 `ZH`）里。

### 目录的写法规则

- 每行都要有许可证和版本 / 日期；没有就写「未核实」（unverified）。
- 价格没有出处和日期就不写；读不到写「未核实」，不估、不写「大约」。
- 名字和实际不符的要在行里标出来（名字陷阱）。
- 需要卡或有付费账号的标 `needs a card`，不排在同类第一行。
- 每一类里免费、能自托管的排在前面。
- 没核实过的条目可以作为「对照行」出现在目录参考页，但必须同时标「未核实」和一行「参考信息，未作为连接器提供」；它不拿连接器定义、不进注册表、不出现在应用的 Connectors 页。除此之外的每一行都核实过（许可证、发布者、版本 / 日期、本地还是托管、要哪种凭据、上次核对的日期都齐），才是真正的目录条目。

### 许可证规则

- Redis（RSALv2/SSPL）、MongoDB server（SSPL）、n8n（fair-code）、Temporal Cloud 可以列成「用户自己跑的东西」，不能进本仓库（AGENTS.md 规则 3）。
- npm 上的 `markitdown` 0.0.4 不是微软的工具，它把 GFL 转成 HTML。这类名字陷阱要在行里标出来。

### 分期

- **第一期**：只做令牌型连接器（`authKind: token` 或 `account`）。OAuth（Gmail、Notion、Slack 应用）要浏览器同意页，等第三期。
- **第二期**：本地 stdio 连接器，**像本地能力一样需要批准，永不自动启动**；只做纯 JS / 纯 Python 的服务——引擎镜像里没有 `sqlite3`、`psql`、`soffice`、`pandoc`、`tesseract`。
- **第三期**：OAuth 连接器。

### 先行修的两处

- streamable-http 的能力：地址不是 `https:` 一律拒绝；不再默认 `approved: true`。
- 探测回来的账号名显示前过滤（见上）。

### 验收标准

下面每一条都是可测的判定，每条写明落在哪个测试文件里。基线（`fix/app-window-origin`，`13a2a407` 实测）：`npm test` = 1439 个用例 / 1437 通过 / 0 失败 / 2 跳过；`ds-bot/test/connectors.test.js` = 7 条断言。以后每个 PR 的总数变化都要在 PR 里说清楚。

**一、通用：每个连接器 id 都成立（`ds-bot/test/connectors-generic.test.js`）**

1. 列表按配置顺序列出每一条启用的连接器，一个 id 一行，不重复、不漏项。
2. 配置为 `false` 的连接器不出现；被移除的连接器从列表消失，并且它的挂载被解除。
3. 一个连接器只存自己那一个密钥（名字来自定义，按 `SECRET_NAME` 校验），挂载时用它自己的 url 和请求头。
4. 密钥只出现在该连接器自己服务的请求头里：发给别的服务的请求中没有它。
5. 密钥不出现在 roster、`state.json`、客户端 bundle、日志行和错误信息里；出现一次就判不通过。
6. 密钥不进任何 Bot 的 shell（scope 保持 `[]`）。
7. 探测按连接器自己定义来：自己的身份地址和自己的账号字段；探测不通时该行是失败状态、点名是哪个服务，且没有密钥、没有挂载。
8. 探针主机和 MCP 主机必须同一个可注册域，在加载时就拒绝。
9. 未知 id 照今天的样子被拒绝（对照 `ds-bot/test/connectors.test.js`）。
10. 断开和重试只动被点名的那一个连接器。
11. 挂载失败不留半个挂载，也不留密钥。
12. 任一端点缺 `https://` 检查就在发密钥之前拒绝。

**二、客户端页面（`ds-bot/test/connectors-client.test.js`）**

13. 每条连接器一行，顺序同配置；状态只有未连接 / 连接中 / 已连接 / 连接失败四种。
14. 表单按定义里的 `fields` 渲染：字段、标签、遮罩输入都来自定义，不是写死的。
15. 「去拿令牌」的链接来自定义，并停在厂商自己的域名上；一条 Gmail 的行不能指向 GitHub。
16. 失败行带 `role="alert"`；连接中的行只是等待提示，没有 `.bt-error`、没有 `role="alert"`。
17. 图标取不到时用首字母；加一个服务不需要重新生成客户端 bundle。

**三、不签核的红线**

18. 凭据出现在任何产物里、凭据发给了非本服务的主机、密钥进了 Bot 的 shell、挂载失败留下半个挂载或残留密钥、端点缺 `https://` 检查、目录里出现没核实过的条目（许可证、发布方、版本/日期、自托管还是托管、到底要哪种凭据）——`markitdown` 这种抢名字的要在上架前就拦下来。
19. 目录里的写操作（发邮件、删仓库、删表）没有走审批就不放行。
20. 测试总数变了但 PR 里没说清楚差异，不签核。

**四、测试怎么跑（不碰真实服务）**

21. 身份探测用 `ds-bot/test/fixtures/connector-stub/` 里的 `node:http` 桩，监听 `127.0.0.1`；MCP 挂载用现成的假 loader（`ds-bot/test/connectors.test.js:57-66`），不需要真的 MCP 服务器。共用助手：`ds-bot/test/connector-harness.js`。
22. 两条先行修的当前代码，各自有测试文件，QA 已写好并量过（红的，等 Security 的修复）：
   - `ds-bot/src/host/capabilities.js:114-121` —— streamable-http 的能力不再默认 `approved: true`，没批准不挂载；`http:` 地址一律拒绝。测试：`ds-bot/test/capability-remote-mcp.test.js`（3 条）。
   - `ds-bot/src/host/connectors.js:116` —— 探测回来的账号名显示前过滤（字符集 + 长度），只取自该连接器自己的探测。测试：`ds-bot/test/connector-account-sanitised.test.js`（3 条）。

两点说明：

1. 第 20 条要写进 PR 里的数字就是这个基线（1439 / 1437 / 0 / 2）。QA 测的时候是在共享 clone 的 `fix/app-window-origin`（`13a2a407`）上跑的，不是工作区里的改动。
2. 第 22 条那两处修好之后，现有的 `ds-bot/test/capabilities.test.js` 里有 **4 条**测试会红（它们今天假设远程 MCP 保存即批准）：`capabilities.test.js` 里的 `mounts agent-only MCP and skills…`、以及用 `mountUrlCapability` 助手的三条 HTTP MCP 测试。这四条要在同一个 PR 里改成「先批准再挂载」。QA 已实测：模拟修复后 `tests 20 / pass 16 / fail 4`，失败的正是这四条；模拟账号过滤后 `tests 10 / pass 10 / fail 0`。

## 不做什么

- 不做外部市场，不从别人的注册表拉定义；注册表在本仓库里，一个服务一条经过审核的定义。
- 第一批不做 OAuth，不做需要浏览器的同意流程。
- 不把第三方服务 vendored 进仓库；它们是单独进程。
- 不让 Bot 看到或输入凭据的值；新连接的凭据默认不进 Bot 的 shell，除非用户在密钥页面自己放开。
- 不做按名字模糊匹配的自动安装；每个服务是注册表里审核过的一条定义。
- 不在目录里写没读过的价格。

## 已知限制

- 这个设计改变今天 GitHub 连接器的行为（挂载从全团队变成按 Bot）。这是对已定设计（[浏览器、联网搜索、密钥和连接器](2026-10-08-browser-and-secrets.md) 的连接器一节）的改动，**要 Jahanzaib 明确同意后才生效**；那一篇的「变更」也只在这之后才加。
- 目录里的免费额度和价格是 2026-11-12 读到的快照，会过时。每条定义带 `verifiedOn`，超过半年标「需复核」。
- 目录里的条目在许可证核实之前不进注册表；未核实的条目只作为对照行存在。
- Gmail 那一行是真的，但属于第三期。
- 引擎镜像缺 `sqlite3`、`psql`、`soffice`、`pandoc`、`tesseract`，本地 stdio 服务暂时只有纯 JS / 纯 Python 的能跑。
- 工具名空间 `mcp__<id>__` 与能力同名时那个能力注册不到工具（运行时把冲突那台服务的工具整批撤掉）。
- 探针回来的账号名今天不过滤就显示，先行修复之后过滤（两处先行修复：远程 MCP 需要批准、账号名过滤）。
- 目录的中文和英文是两份文字，改一边要改另一边。
- 改动前后的测试基线：1439 个测试 / 1437 通过 / 0 失败 / 2 跳过，连接器相关 7 条断言。

## 变更

- 2026-11-12：初稿。连接器从写死的 GitHub 块改成数据驱动的定义，按 Bot 授权；定下目录的表格、详情页、写法规则和许可证规则。
