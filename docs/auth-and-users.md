# 用户表与登录 / 注册（数据库存储结构）· 设计与答辩口径

> 进入网站的第一屏是登录界面：可以**一键进入演示账号**，或使用账号密码**登录**，
> 也可以**就地注册新账号**。用户身份决定掌握度与做题记录的归属（按 `user_id` 隔离）。
>
> 存储分两层：演示环境用浏览器本地用户表（`localStorage: kmu:users:v1`，可离线演示），
> 结构与 `server/schema.sql` 的 `users` 表一一对应，接后端时按同一形状迁移。

## 1. 用户表结构（`server/schema.sql`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `demo-001` 或 `u-<时间戳>-<随机>` |
| `username` | TEXT | 展示用户名（保留大小写） |
| `username_lower` | TEXT UNIQUE | 唯一键：不区分大小写（防止 Demo/demo 重复注册） |
| `display_name` | TEXT | 右上角昵称 |
| `role` | TEXT | `demo` / `user` / `admin` |
| `status` | TEXT | `active` / `disabled` |
| `password_hash` | TEXT | PBKDF2-SHA256（120,000 次迭代）Base64；演示账号为 NULL |
| `salt` | TEXT | 16 字节随机盐 Base64 |
| `iterations` | INTEGER | 迭代次数随行存储，便于将来升级 |
| `created_at` / `last_login_at` | TEXT | ISO 时间戳 |

同文件附 `sessions`（服务端会话）与 `learning_records`（做题记录）表结构；
演示版记录按 `kmu:records:<user_id>` 存 localStorage，字段与记录表一致。

## 2. 安全实现（前端演示版，`src/data/userStore.js`）

- **密码永不明文**：Web Crypto PBKDF2-SHA256，120k 迭代 + 16 字节随机盐；
  只存 `passwordHash`（Base64）与 `salt`；校验收敛为常量时间比较。
- **统一失败文案**：登录失败一律「账号或密码不正确」，不暴露“用户是否存在”。
- **唯一性**：`usernameLower` 大小写归一后查重；服务端迁移时由 UNIQUE 约束兜底。
- **对外最小暴露**：模块只返回 safeUser（不含哈希/盐）；用户表原始行仅在 localStorage 内部。
- **演示账号**：种子行 `role='demo'`、无密码，只能通过「直接进入演示账号」按钮进入。

## 3. 登录流程

```
打开网站
 ├─ 首次进入：加载知识库（本地 JSON）→ 登录界面（场景作为背景）
 ├─ 直接进入演示账号 → loadAccount('demo-001')：种子掌握度 + 演示记录
 ├─ 登录：查表(用户名归一) → PBKDF2 校验 → 更新 last_login_at
 │        → loadAccount(user.id)：该用户自己的记录重放
 └─ 注册：校验（3–20 位用户名 / ≥6 位密码 / 确认一致 / 唯一性）
          → 生成盐与哈希 → 写入用户表 → 自动登录（全新星图，未学状态）
退出登录 → 关闭面板/抽屉 → 回登录界面（记录保留，下次登录恢复）
```

刷新页面同样回到登录界面（不做静默自动登录）；登录页会预填上次用户名（`kmu:session:v1`）。

## 4. 接后端（迁移路径）

1. 建表：执行 `server/schema.sql`（users / sessions / learning_records）。
2. 提供接口（契约建议）：
   - `POST /api/auth/register { username, password, displayName } → { user }`
   - `POST /api/auth/login { username, password } → { user, token }`
   - `POST /api/auth/logout`；`GET /api/auth/me`
   - 服务端同样使用 PBKDF2/Argon2 加盐哈希（参数写入 `iterations` 列）。
3. 前端替换点：`src/data/userStore.js` 的 `registerUser / loginUser / getLastUser`
   改为调用上述接口；`recordStore` 的读写迁到 `learning_records` 表。
   App 的登录界面、账号区、记录隔离逻辑均无需改动。

## 5. 运行时验证（`scripts/verify.mjs`）

- 进入网站即登录界面（演示入口 + 用户名/密码表单 + 注册切换）；
- 注册校验：短密码提示、两次密码不一致提示、重复用户名提示；
- 注册成功 → 进入星系，右上角显示昵称；用户表新增一行且结构完整
  （`role=user`、`status=active`、`passwordHash` 非明文且长度 >20、`salt` 存在、`iterations≥100000`、`createdAt`）；
- 新注册用户 → 全星系未学、无做题记录（与演示账号隔离）；
- 退出登录 → 回登录界面；错误密码 → 提示且不进入；正确密码 → 恢复该用户记录；
- 一键进入演示账号 → 种子状态恢复。
- 刷新后的所有后续流程均通过登录页重新进入演示账号（验证登录界面的真实入口作用）。

## 6. 答辩口径

- **问：密码怎么存的？** 不明文。PBKDF2-SHA256 加盐（120k 迭代），表中只有摘要与盐；
  演示版在本地浏览器（离线可演示），SQL 表结构已备好，接后端无需改前端流程。
- **问：为什么不做自动登录？** 需求是“进入网站就是登录界面”；刷新会回到登录页并预填上次用户名，
  演示账号一键进入，体验成本很低。
- **问：注册用户会看到别人的数据吗？** 不会。掌握度与做题记录按 `user_id` 分键存储/重放，
  验证脚本覆盖“新用户全未学 + 演示账号记录零污染”。

## 7. 演示账号专属能力：模拟做题结果

- 控制台「模拟做题结果」**仅 `role='demo'` 的演示账号可见**；注册账号的入口不渲染，
  主按钮退化为「回到俯瞰」。
- 处理器本身还有角色守卫与并发守卫：非演示账号调用直接忽略；串行模拟进行中重复点击忽略；
  模拟期间若退出/切换账号则中止队列——演示数据不会写进其他账号。
- 模拟作答走与真实做题**完全相同的提交链路**（判题 → 规则结算 → 写记录 → 3D 联动），
  因此可用于展示"提交即变色"；产生的演示数据可用「重置记录」一键清除回种子态。
- 验证脚本覆盖：演示账号有入口且点击后记录增长、记录归属 `demo-001`、星球掌握度与 store 同步；
  注册账号无该入口。
