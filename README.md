# VCT 2026 晋级计算器

这是一个面向 AMER、EMEA、PACIFIC、CN 的 VCT 2026 Champions 晋级概率平台原型。

当前实现包含：

- Next.js 16 App Router + React 19 + MUI 7 + Tailwind CSS 4；
- Vercel Node.js Runtime 目标架构，Neon Postgres + Drizzle schema；
- 50/50 未完赛系列赛的 BigInt 精确情景枚举；
- Stage 2 直接晋级、冠军积分晋级、同分比较顺序和基础聚类接口；
- 中英文公开页面、赛区概览、ECharts 概率图、方法说明页；
- 全年赛事结果表格，支持逐地图回合比分录入；
- 管理后台使用 MUI：小组赛/Swiss 为列表，淘汰赛为可编辑对阵图；
- 草稿允许保存未完成赛果，点击“保存草稿”后写入版本；重新打开后台会恢复最新草稿；
- 淘汰赛图中可在赛果录入区域手动指定每个赛事的第一轮对阵，变更对阵会清除该场旧赛果；
- Kickoff 三败淘汰的 12 个种子入口必须在赛程配置页手动选择，队伍列表顺序不作为种子顺位；
- 修复前保存的旧版 Kickoff 草稿可在赛程配置页显式迁移，旧版后续轮次已有赛果时会阻止自动迁移；
- 2026 Masters Santiago / London 建模为全球 12 队、8 队 Swiss、8 队双败淘汰，不再按赛区重复生成；
- 支持配置小组分组、淘汰赛起始轮次、队伍名称/简称/地区及压缩 Logo；Logo 暂随草稿 JSON 保存；
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

规则版本和引擎版本会随发布快照保存。若官方同分规则无法唯一确定，发布会被阻止，管理员必须提供官方裁决说明。
