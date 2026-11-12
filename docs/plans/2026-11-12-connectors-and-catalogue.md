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

### 密钥

- 值只由用户输入，存在 `bot/secrets.json`，只出现在发往该服务的 MCP 请求头里，请求头在内存里生成，不写进运行时的 profile。
- 连接器**不把密钥加进任何 Bot 的 shell**；用户可以在 Secrets 页面上自己放开。
- 连接器不新增、不删除、不改别人的密钥名；密钥名来自定义。
- 每个连接器的凭据只存在于一个地方——团队密钥库——只用于一个地方：该连接器自己端点的请求头，挂在内存里现构造。它不进 Nova profile，不进任何 Bot 的 shell，不出现在工具结果或模型请求里，也不到别的连接器的端点。

### 连接流程

- 表单按 `fields` 渲染，通用代码一套；没有字段的服务不需要表单。
- 连接时先跑 `probe`（如果有）：拿凭据问一次服务，取 `accountPath` 指到的字段作为账号名。账号名**显示前过滤**：限制长度、去掉控制字符，不允许它伪装成别的账号。
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
- 没核实过的条目**不列**（许可证、发布者、版本 / 日期、本地还是托管、准确的凭据方式，缺一项就不列）。

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

## 不做什么

- 不做外部市场，不从别人的注册表拉定义；注册表在本仓库里，一个服务一条经过审核的定义。
- 第一批不做 OAuth，不做需要浏览器的同意流程。
- 不把第三方服务 vendored 进仓库；它们是单独进程。
- 不让 Bot 看到或输入凭据的值；新连接的凭据默认不进 Bot 的 shell，除非用户在密钥页面自己放开。
- 不做按名字模糊匹配的自动安装；每个服务是注册表里审核过的一条定义。
- 不在目录里写没读过的价格。

## 已知限制

- 目录里的免费额度和价格是 2026-11-12 读到的快照，会过时。每条定义带 `verifiedOn`，超过半年标「需复核」。
- Gmail 那一行是真的，但属于第三期。
- 引擎镜像缺 `sqlite3`、`psql`、`soffice`、`pandoc`、`tesseract`，本地 stdio 服务暂时只有纯 JS / 纯 Python 的能跑。
- 工具名空间 `mcp__<id>__` 与能力同名时那个能力注册不到工具（运行时把冲突那台服务的工具整批撤掉）。
- 探针账号名今天不过滤就显示。
- 目录的中文和英文是两份文字，改一边要改另一边。
- 改动前后的测试基线：1439 个测试 / 1437 通过 / 0 失败 / 2 跳过，连接器相关 7 条断言。

## 变更

- 2026-11-12：初稿。连接器从写死的 GitHub 块改成数据驱动的定义，按 Bot 授权；定下目录的表格、详情页、写法规则和许可证规则。
