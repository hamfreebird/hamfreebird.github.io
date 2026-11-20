# freebird的自留地

一个现代化的暗色个人博客项目：**GitHub Pages 静态前端 + 零依赖 Node.js 后端**。

- 线上站点：<https://hamfreebird.github.io>
- 个人仓库：<https://github.com/hamfreebird/hamfreebird.github.io>
- 联系邮箱：freebirdflyinthesky@outlook.com

> 仓库**不包含任何博客文章内容**。文章、留言与订阅数据由后端保存在运行环境的 `data/blog.db` 中，不会随代码提交到 GitHub。仓库内的 `content/posts.json` 仅保存站点配置，其 `posts` 数组为空，用作未连接后端时的静态快照回退。

## 功能

**前端（GitHub Pages 托管）**

- 首页、文章页、归档页、关于页、后台管理页、404 页
- 暗色主题、响应式布局、系统级「减少动态效果」适配
- 主题动效：望远镜恒星衍射星芒、星系轨道同向差速运行、风流与极光背景、星尘闪烁、羽毛拖尾、页面转场、阅读进度条、滚动渐入与数字滚动
- 全局搜索、标签筛选、分页、留言、RSS、订阅入口
- 「free / bird」主题视觉贯穿品牌标识、文案、动效与交互反馈

**后端（Node.js 独立服务）**

- `node:http` + `node:sqlite`，**零第三方依赖**，Node.js ≥ 22.5 即可运行
- 管理员登录（scrypt 密码哈希 + HMAC 签名令牌）、修改密码
- 文章增删改查、草稿/发布切换、搜索、标签、阅读计数
- 后台完整编辑器：可视化 / HTML 源码双模式、格式工具栏、实时预览、字数与阅读时间统计、Slug 与摘要自动生成、本地草稿自动保存
- 文章列表支持搜索、状态筛选与分页；留言支持状态筛选、全选与批量通过 / 删除
- 留言提交、审核（通过 / 待审 / 删除）、IP 限流与简单内容过滤
- 站点设置、订阅者、统计、RSS 输出、JSON 数据备份与一键恢复
- 同源静态资源托管，因此本地一条命令即可运行完整全栈应用

## 本地运行

```bash
# Node.js >= 22.5
ADMIN_PASSWORD='your-strong-password' npm start
# 打开 http://localhost:8787
```

- 未设置 `ADMIN_PASSWORD` 时，首次启动会生成一个随机密码并打印在终端，请立即修改。
- 管理后台：<http://localhost:8787/admin.html>，默认用户名 `freebird`。
- 其他命令：`npm run check`（端到端自检，使用临时数据目录）、`npm run seed`（从 `content/posts.json` 补充种子文章）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 后端监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite 数据库与密钥目录（已加入 .gitignore） |
| `ADMIN_PASSWORD` | 首次启动随机生成 | 管理员初始密码 |
| `CORS_ORIGIN` | 空（仅同源） | 允许访问 API 的站点来源，多个用英文逗号分隔 |
| `SITE_URL` | 请求 Host | 生成 RSS 绝对链接时使用 |

## 部署到 GitHub Pages

1. 仓库已包含 `.github/workflows/pages.yml`，推送到 `master` 或 `main` 后会自动构建并部署静态站点。
2. 在仓库 **Settings → Pages → Build and deployment** 中，将 Source 设为 **GitHub Actions**。
3. 站点静态资源位于仓库根目录，工作流只会复制 `index.html` 等页面、`assets/` 与 `content/` 到 Pages；`server/` 与 `data/` 不会发布。

### 动态后端（已启用）

GitHub Pages 只能托管静态文件，动态能力由独立 Node 服务提供。当前已发布后端服务，前端 `assets/js/config.js` 已配置其地址与访问码：

- 线上站点访问后端时会自动带上访问码；本地 `localhost` 开发则走同源后端，不依赖线上服务。
- 后端已允许来自 `https://hamfreebird.github.io` 的跨域请求（CORS_ORIGIN）。
- 管理员账号 `freebird`，密码由部署环境的 `ADMIN_PASSWORD` 提供，不写入本仓库。本地开发同样可用 `ADMIN_PASSWORD=... npm start` 指定。
- 连接成功后，首页数据源标识显示「实时数据 · 后端已连接」，文章、留言与后台管理全部可用；若后端不可达，站点自动回退到静态快照并显示明确提示。
- 如需更换后端地址或访问码，只修改 `assets/js/config.js` 的 `API_BASE` 与 `API_SHARECODE` 后重新发布静态页面即可。

## 目录结构

```text
index.html / post.html / archive.html / about.html / admin.html / 404.html
assets/css/main.css          暗色主题与全部动效
assets/js/config.js          站点与后端地址配置
assets/js/api.js             前端 API 客户端（含静态回退）
assets/js/common.js          全站外壳、羽毛光标、搜索、转场
assets/js/{home,post,archive,about,admin}.js
assets/js/editor.js             后台文章编辑器（双模式、工具栏、预览）
content/posts.json           站点配置（posts 为空数组）
server/db.js                 SQLite 结构、认证与种子逻辑
server/api.js                REST API 路由
server/index.js              服务入口
server/static.js             静态资源托管
server/selftest.js           端到端自检
.github/workflows/pages.yml  GitHub Pages 部署
```

## 安全说明

- `data/` 与密钥文件不会进入版本库；请勿将数据库或密钥提交到公开仓库。
- 留言默认进入待审状态，需管理员审核后才公开显示。
- 前端只保存短时效签名令牌；如需更高安全等级，可进一步接入 HTTPS 与域名级 CORS 白名单。

---

freebird的自留地 · fly free · write true
