# VCT 2026 晋级计算器

这是一个面向 AMER、EMEA、PACIFIC、CN 的 VCT 2026 Champions 晋级概率平台原型。

当前实现包含：

- Next.js 16 App Router + React 19 + MUI 7 + Tailwind CSS 4；
- Vercel Node.js Runtime 目标架构，Neon Postgres + Drizzle schema；
- 50/50 未完赛系列赛的 BigInt 精确情景枚举；
- Stage 2 直接晋级、冠军积分晋级、Kickoff / Stage 1 / Stage 2 前四名及 Masters 前六名历史积分、同分比较顺序和基础聚类接口；
- 中英文公开页面、赛区概览、ECharts 概率图、方法说明页；
- 淘汰赛结果支持可选填逐地图回合比分，常规赛小组阶段只记录队伍最终胜负；
- 管理后台使用 MUI：常规赛小组阶段按队伍录入最终战绩（如 5-0、4-1、3-2），Swiss 同样按队伍录入战绩，淘汰赛为可编辑对阵图；
- 后台精确计算直接读取当前草稿的队伍、Stage 2 完整淘汰赛配置和已录入赛果，沿胜者 / 败者引用推演至 Stage 2 总决赛，并显示队伍晋级概率、晋级方式和聚合情景；入口或小组战绩未配置完整时会明确提示；
- 后台点击“发布精确结果到公开页面”会重新计算四个赛区，并将完整结果写入发布快照；发布前必须先保存草稿，公开页随后读取最新快照；
- 发布快照同时保存真实 VCT / Challengers / CN 国家杯队伍资料、已确认冠军积分、Stage 2 对阵和情景聚类；公开赛区页提供总览、对阵图、精确情景、队伍焦点和聚类分析标签；旧快照缺少这些字段时仍可回退到预览队伍；
- 草稿允许保存未完成赛果，点击“保存草稿”后写入版本；重新打开后台会恢复最新草稿；
- 淘汰赛图中可在赛果录入区域手动指定每个赛事的第一轮对阵，变更对阵会清除该场旧赛果；
- Kickoff 三败淘汰的 12 个种子入口必须在赛程配置页手动选择，队伍列表顺序不作为种子顺位；
- 修复前保存的旧版 Kickoff 草稿可在赛程配置页显式迁移，旧版后续轮次已有赛果时会阻止自动迁移；
- 2026 Masters Santiago / London 建模为不属于任何赛区的全球赛事：四赛区自动各分配 3 个名额，Swiss 队伍最终战绩由管理员录入，淘汰赛首轮 4 场的半区和对阵由管理员手动确定，随后按胜者 / 败者引用进入 8 队双败淘汰；
- 支持配置小组分组、淘汰赛起始轮次、队伍名称/简称/地区及压缩 Logo；Logo 暂随草稿 JSON 保存；
- Stage 1 / Stage 2 的赛区淘汰赛按官方区域差异生成：Stage 1 的 AMER、EMEA、PACIFIC 使用两队从败者组首轮、两队从胜者组半决赛开始的 8 队双败变体，CN 使用 8 队全部从胜者组四分之一决赛开始的标准双败淘汰；
- Stage 2 的 AMER、EMEA、PACIFIC 会先生成 12 队、18 场的 Play-in；管理员需配置主淘汰赛 4 个直通位，并可配置 Play-in 第 1–2 名、第 3–4 名分别进入 Alpha/Omega 的顺序，未配置时两种顺序各按 50% 计算。CN 使用 10 队、14 场的 Play-in 加 8 队主淘汰赛，Play-in 入口和主淘汰赛首轮 8 个位置由管理员手动配置，不制作同排名决胜赛；
- 后台将 VCT 队伍与 Stage 2 的 Challengers / CN 国家杯队伍分开维护；前三个国际赛区使用 4 个 Challengers 入口，CN 使用 2 个国家杯入口，均自动接入对应 Play-in 首轮；
- 旧版 Stage 1 / Stage 2 空白淘汰赛草稿加载时会自动补齐当前结构并保留已配置队伍；已有赛果的旧结构不会自动重排，缺失的 Stage 2 Play-in 场次会补回；
- LSCube_OAuth PKCE 登录回调、邮箱 allowlist、数据库会话模型；
- 草稿 revision、分析结果分块上传、发布校验和缓存标签失效接口。

当前仓库尚未连接生产 Neon 或 OAuth 环境，因此页面使用明确标记的“预览数据”；这不是实际赛事结果。连接环境后，`src/lib/data/public.ts` 会优先读取最新发布快照。

## 开发环境

- Node.js 22 LTS 或更高版本；
- pnpm 11.4.0；
- 本地 Neon 开发分支（或其他 PostgreSQL 兼容连接串）。

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm run dev
```

常用检查：

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

数据库 schema：

```powershell
pnpm run db:generate
pnpm run db:migrate
```

## 环境变量

参见 [.env.example](./.env.example)。生产环境至少需要：

- `DATABASE_URL`：Neon 连接串；
- `LSCUBE_OIDC_ISSUER`、`LSCUBE_OIDC_CLIENT_ID`、`LSCUBE_OIDC_CLIENT_SECRET`；
- `SESSION_SECRET`；
- `VCT_EDITOR_EMAILS`：逗号分隔的已验证管理员邮箱；
- `NEXT_PUBLIC_APP_URL`：生产站点地址。

OAuth 回调地址为 `${NEXT_PUBLIC_APP_URL}/api/auth/callback`。PR Preview 不开放后台登录；本地和生产环境分别登记精确回调地址。

## 规则来源

- [Riot Games VCT 2026 Handbook](https://valorantesports.com/en-US/season/115571062868511862/handbook)
- [Liquipedia VCT 2026 Championship Points](https://liquipedia.net/valorant/VCT/2026/Championship_Points)

当前晋级排序只执行前五级同分判定：Stage 2、Masters 2、Stage 1、Masters 1、Kickoff 最终名次。规则版本和引擎版本会随发布快照保存。
