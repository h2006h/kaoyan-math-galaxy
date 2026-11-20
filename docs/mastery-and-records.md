# 掌握度规则与做题记录设计

> 配套代码：`public/data/mastery_rules.json`（全部参数）· `src/data/masteryEngine.js`（纯函数规则引擎）· `src/data/recordStore.js`（持久化）· `src/data/dataService.js`（提交入口）

## 1. 可解释规则（无黑箱）

章节与考点共用同一套加减分，全部参数集中在 `mastery_rules.json`，答辩前调参只改这个 JSON：

| 参数 | 值 | 含义 |
|---|---|---|
| `baseScore` | 5 | 每题基础分 |
| `difficultyCoeff` | 1.0 / 1.5 / 2.0 | 难度 1/2/3 档系数 |
| `streakLength` / `streakBonus` | 3 / +5 | 同一考点连对 3 题，额外 +5（稳定掌握） |
| `initialScore` | 50 | 首次作答起算分；**无记录保持 null = 未学**，不显示 50 的中亮 |
| `minScore` / `maxScore` | 0 / 100 | 分数截断 |
| `thresholds` | ≥80 已掌握 / ≤30 薄弱 | 其余学习中；null 未学。3D 状态映射从同一配置读取 |
| `questionsPerRound` | 3 | 每轮抽题数（难度升序） |

结算口径：

- 做对 `+5×系数`，做错 `−5×系数`；一题关联多个考点时各考点同加同减（这道题会了，覆盖的每个考点都受益）。
- **章节分只按对错加减基础分**；连对奖励只加给考点——章节反映整体对错，考点奖励稳定掌握。
- 每次提交在答题解析区展示完整明细：`本题 +7.5（基础5×难度1.5）`、各考点与章节的 `before → after`、连对奖励徽标。规则对评委完全透明。

## 2. 做题记录表结构

后端落地 DDL（当前演示环境用 localStorage 等价实现，键 `kmu:records:{userId}`）：

```sql
CREATE TABLE quiz_record (
  id            VARCHAR(32)  PRIMARY KEY,
  user_id       VARCHAR(32)  NOT NULL,            -- 演示账号 demo-001 / 注册用户 u-xxx
  question_id   VARCHAR(32)  NOT NULL,
  chapter_id    VARCHAR(32)  NOT NULL,
  point_ids     JSON         NOT NULL,            -- 关联考点 id 列表
  correct       BOOLEAN      NOT NULL,
  difficulty    TINYINT      NOT NULL,            -- 1/2/3
  chapter_delta DECIMAL(5,1) NOT NULL,            -- 本次分数变化：章节
  point_deltas  JSON         NOT NULL,            -- 本次分数变化：各考点（含连对奖励）
  created_at    BIGINT       NOT NULL,            -- 毫秒时间戳
  INDEX idx_user_time (user_id, created_at),
  INDEX idx_user_question (user_id, question_id)
);
```

写入逻辑（`recordStore.appendRecord`，唯一入口）：提交 → 规则引擎算出各项 delta → 组装记录（含 userId、时间戳、分数变化）→ 追加到该 user_id 的记录流。**演示账号与注册用户走同一函数，仅 userId 不同**；账号体系见 `docs/auth-and-users.md`（登录/注册入口在进入网站的第一屏）：新用户整星系未学，做题后记录只落在自己的键下，切回演示账号状态原样恢复。

接后端时把 `loadRecords / appendRecord / clearRecords` 三个函数换成 `GET/POST/DELETE /api/users/:id/records`，调用方零改动。

## 3. 跨会话连对判定

连对数**不存内存状态**，而是从持久化记录流重放推导（`replayAccount`）：按时间升序遍历该账号记录，对同一考点 对→+1、错→清零。因此：

- 刷新页面、关掉浏览器明天再练，连对进度不丢；
- 换设备登录同一账号，只要记录同步到后端，重放结果一致；
- 中间做了其他考点的题**不打断**本考点连对（连对按"同一考点的做题历史"判定，口径简单可解释）；
- 重置记录 = 清空记录流，重放后连对自然归零，无需单独维护计数器。

## 4. 答辩口径（一句话）

> 掌握度采用"章节级积分制"：以章节为单位从 50 分起算，做对按题目难度加 5~10 分、做错扣同值，同一考点连对 3 题额外 +5 分奖励稳定掌握，80 分以上点亮为已掌握、30 分以下标记为薄弱——规则只含加减法和两条阈值，评委和考生都能一眼看懂自己的掌握度是怎么来的。

设计依据备询（不主动展开）：

- **为什么章节级**：考研复习以章节为单位推进，章节分直接回答"这章能不能上考场"；考点分用同一规则细化到星球，两者口径一致。
- **为什么这样加减分**：难度系数让难题权重更高，符合考试分值分布；对错同值避免"刷简单题赚分"；连对奖励区分"蒙对一次"与"稳定掌握"。
- **为什么阈值 80/30**：80 对应考研数学单章得分率的安全线，30 以下意味着基础题都频繁出错，需要回炉；中间态一律"学习中"，不给用户虚假的安全感。