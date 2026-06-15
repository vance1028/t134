# 中蜂蜂场养殖运营管理平台 - 后端 API

一个纯后端的 REST API 服务，用于管理中华蜜蜂（中蜂）养殖：蜂场、蜂箱/蜂群、检查记录、采收批次，含登录鉴权与基于角色的权限控制。
本项目作为「功能迭代」类评测题目的基础工程：Node + Express + SQLite（better-sqlite3），结构清晰、留有充分扩展点。

## 技术栈

- Node.js (≥ 18) + Express 4
- 数据库：SQLite（`better-sqlite3`，同步 API，UTF-8 存储，免外部服务）
- 认证：JWT（`jsonwebtoken`）+ scrypt 密码哈希（Node 内置 crypto，无原生依赖）
- 测试：Node 内置 `node:test` + `supertest`

## 快速开始

```bash
npm install
npm run seed     # 可选：预先写入种子数据到 data/app.db
npm start        # 启动，默认空库会自动播种
```

- API 监听 `http://localhost:7138`（可用环境变量 `PORT` 覆盖）
- 首次启动检测到空库会自动写入种子数据（设 `SEED_ON_START=false` 可禁用）

### 测试

```bash
npm test
```

测试使用内存库（`DB_FILE=:memory:`），每个用例前重置并重新播种，互不影响。

## 种子账号

| 用户名 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| admin | admin123 | admin | 系统管理员，全部权限（含删除、管用户） |
| keeper | keeper123 | operator | 养蜂员，可建/改蜂场蜂箱、登记检查与采收 |
| viewer | viewer123 | viewer | 观察员，只读查询 |

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `7138` | API 监听端口 |
| `DB_FILE` | `data/app.db` | SQLite 文件路径；设为 `:memory:` 用内存库 |
| `JWT_SECRET` | `apiary-admin-dev-secret` | JWT 签名密钥 |
| `TOKEN_TTL` | `8h` | 令牌有效期 |
| `SEED_ON_START` | - | 设为 `false` 可禁用空库自动播种 |

## 数据模型

- **users 用户**：`id, username(唯一), password_hash, name, role(admin/operator/viewer), active`
- **apiaries 蜂场**：`id, code(唯一), name, location, district, keeper, status(active/dormant)`
- **hives 蜂箱/蜂群**：`id, code(唯一), apiary_id(FK), queen_year(蜂王年份), frame_count(脾数), strength(weak/medium/strong), status(active/queenless/dead/merged), installed_at`
- **inspections 检查记录**：`id, hive_id(FK), inspector_id(FK), inspect_date, has_queen(有无王), brood_frames(子脾), honey_frames(蜜脾), disease(none/varroa/foulbrood…), note`
- **harvests 采收批次**：`id, batch_no(唯一), apiary_id(FK), harvest_date, product(honey/royal_jelly/pollen/propolis), quantity_kg, note`

## API 一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 健康检查 |
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT |
| GET | `/api/auth/me` | 登录 | 当前用户信息 |
| GET | `/api/users` | admin | 用户列表 |
| POST | `/api/users` | admin | 新建用户 |
| PUT | `/api/users/:id` | admin | 更新用户 |
| DELETE | `/api/users/:id` | admin | 删除用户 |
| GET | `/api/apiaries` | 登录 | 蜂场列表（`district`/`status`/`keyword`） |
| GET | `/api/apiaries/:id` | 登录 | 蜂场详情 |
| GET | `/api/apiaries/:id/hives` | 登录 | 某蜂场的蜂箱列表 |
| POST | `/api/apiaries` | admin/operator | 新建蜂场 |
| PUT | `/api/apiaries/:id` | admin/operator | 更新蜂场 |
| DELETE | `/api/apiaries/:id` | admin | 删除蜂场 |
| GET | `/api/hives` | 登录 | 蜂箱列表（`apiaryId`/`status`/`keyword`） |
| GET | `/api/hives/:id` | 登录 | 蜂箱详情 |
| POST | `/api/hives` | admin/operator | 新建蜂箱 |
| PUT | `/api/hives/:id` | admin/operator | 更新蜂箱 |
| DELETE | `/api/hives/:id` | admin | 删除蜂箱 |
| GET | `/api/hives/:id/inspections` | 登录 | 某蜂箱的检查记录 |
| POST | `/api/hives/:id/inspections` | admin/operator | 登记检查记录 |
| GET | `/api/harvests` | 登录 | 采收批次（`apiaryId`/`product`） |
| POST | `/api/harvests` | admin/operator | 登记采收批次 |

## 响应约定

- 成功：`{ "data": ... }`
- 失败：`{ "error": { "message": "..." } }`，配合 HTTP 状态码（400/401/403/404/409/500）

## 认证方式

登录拿到 token 后，后续请求在请求头带 `Authorization: Bearer <token>`。
