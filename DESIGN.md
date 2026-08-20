# 象棋智教（Xiangqi-Claw）技术方案文档

> 版本：v0.4（AI 教练对话式重构 + 引擎验证体系）
> 更新：2026-08-20
> 仓库：`StevenYuan666/Xiangqi-Claw`（已克隆至本机 `/root/Xiangqi-Claw`）

---

## 1. 项目概述

**象棋智教** 是一个中国象棋智能教学平台：通过 **Pikafish 引擎**实时分析局面、给出评分与多变化线，并通过 **DeepSeek 大模型（AI 教练）** 以自然语言讲解每一步的好坏，帮助初学者理解棋理、快速提升棋力。

本项目是源码开放在 GitHub 的个人项目（无 OSI 许可证，README 声明"仅供学习与个人使用"），本地已完成部署、接入 DeepSeek、新增人机对战、电脑难度四档、自动存档等增强。

---

## 2. 技术栈

| 层 | 技术 | 版本/说明 |
|---|---|---|
| 前端 | React | 19.x（函数组件 + Hooks） |
| 前端 | TypeScript | ~5.9 |
| 前端 | Vite | 7.x（开发服务器，`host: true` 监听全网卡，代理 `/api` `/ws`） |
| 前端 | 样式 | 手写 CSS（无 UI 框架），SVG 棋盘 |
| 后端 | Python | 3.9+（本机 3.9.5） |
| 后端 | FastAPI / Uvicorn | 0.128 / 0.39（异步，`--host 0.0.0.0`） |
| 后端 | openai SDK | 2.x（走 DeepSeek OpenAI 兼容协议） |
| 后端 | SQLite（aiosqlite） | 残局题数据 |
| 引擎 | Pikafish | C++ UCI 引擎（本机 `ARCH=x86-64` 重编） |
| LLM | DeepSeek | `deepseek-chat`（当前路由至 deepseek-v4-flash），`https://api.deepseek.com` |
| 通信 | WebSocket | 实时引擎分析流（回传 fen 与中文记谱） |
| 持久化 | localStorage | 对局自动存档/恢复 |

---

## 3. 系统架构

```
┌──────────────────────────── 浏览器 ────────────────────────────┐
│  React 前端 (Vite :5173，host: true)                           │
│  ├─ lib/xiangqi.ts   规则引擎（走法/将军/绝杀/困毙）            │
│  ├─ lib/fen.ts       FEN 解析、UCI ↔ 坐标转换                  │
│  ├─ lib/notation.ts  UCI → 中文记谱（本地兜底转换）            │
│  ├─ hooks/useGame.ts 游戏状态（历史/悔棋/复位/存档/终局）      │
│  ├─ hooks/useEngine.ts WS 连接（自动重连）＋info/result 状态   │
│  ├─ components/*     棋盘/分析面板/AI教练/走棋记录/编辑器等    │
│  └─ App.tsx          组装 + 人机对战/难度/存档/防卡死调度       │
└──────────────┬─────────────────────────────┬───────────────────┘
               │ WS /ws/analysis（实时）      │ REST /api/*（同步）
┌──────────────▼─────────────────────────────▼───────────────────┐
│  FastAPI 后端 (Uvicorn :8000, --host 0.0.0.0)                   │
│  ├─ routers/  game / analysis / puzzle / review                │
│  ├─ services/ llm / move_parser / openai_client / puzzle /     │
│  │            notation（后端权威中文记谱）                       │
│  └─ engine/   manager（进程+锁+残留清理） / uci / analysis      │
│                        │ UCI 协议（stdin/stdout）               │
│              ┌─────────▼─────────┐                              │
│              │   Pikafish 引擎    │   α-β 剪枝 + NNUE 评估      │
│              └───────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
        DeepSeek API（AI 教练 / 自然语言走法解析）
```

**关键点**：
- 前端自带完整中国象棋规则引擎，负责走法合法性校验、将军/绝杀判定；
- 「棋力」完全由 Pikafish 承担（博弈树搜索 + 神经网络局面评估），前后端只做协议封装与展示；
- 引擎为**单进程**，所有分析请求（REST + WS）通过 `asyncio.Lock` 串行化，每次分析前先 `stop + isready` 清理残留（防污染）。

---

## 4. 核心功能

### 4.1 交互式棋盘
- **点到点走棋**：点击棋子「抬起」（放大 8% + 上移 + 阴影，伪 3D）→ 点击目标格落子（滑动动画）
- 点击另一己方棋子直接**切换选中**（原棋子落下、新棋子抬起，同时动画）
- 走子动画**队列化**（不吞动画）+ **按距离定速**（每格约 140ms，视觉速度恒定）
- 天天象棋风格走子标记：起子格白点+圆环、落子格白色细光环（动画结束同步亮起）
- 推荐箭头**覆盖棋子上层**（吃子/杀棋时可见）+ 起点棋子绿色细环（与落子白环同款）
- 翻转棋盘、走棋历史（可点击回退任意局面）、新局

### 4.2 引擎分析（当前局面）
- WebSocket 实时流：评分（分）、**红黑双方实时胜率条**、深度、最佳着法（中文）、最佳变化线、节点/速度
- 局面变更自动触发分析；**结果带 `fen` 与后端权威中文记谱回传**（`best_move_cn`/`pv_cn`），从根本上避免局面漂移导致的坐标显示错乱
- **人机对战模式下只分析「你执手」的回合**：电脑回合不触发分析（省资源 + 避免推荐显示电脑方走法），面板显示「电脑思考中…」
- 终局后显示「对局结束」，不再展示/触发分析

### 4.3 AI 教练（对话式 + 引擎验证体系，本地重构）

**交互**：棋盘下方对话面板（`components/CoachPanel`）。输入你对当前局面的想法/提问 → AI 结合**引擎实时分析**回答。支持快捷提问、多轮追问；换局面时**保留历史对话**并插入灰色分隔提示，但发给 AI 的上下文**只含当前局面以来的对话**（防旧局面混淆）。

**回答可信度分层（核心设计）**——`POST /api/coach` 按问题类型路由：

| 层 | 问题类型 | 处理路径 | LLM 参与 |
|---|---|---|---|
| 1 | 快捷问题（谁优势/怎么走/局面如何） | 后端实时引擎分析（depth 14）→ 模板回答（标注优势方与轮走方） | 无 |
| 2 | 具体走法（"马七进八如何"） | 规则解析器中文记谱→UCI → 引擎对比该走法 vs 最佳（分数差+判定：接近最佳/好棋/可以更好/略亏/漏招） | 仅最后解读"为什么" |
| 3 | 抽象想法（"想兑子""快点出车"） | LLM 结合棋盘生成 1-2 个候选走法 → 引擎逐个验证分数 → 汇总 + 最佳建议 | 生成候选 + 解读 |
| 4 | 兜底（纯讨论） | LLM 直接回答，被引擎数据硬约束（棋盘描述+分数+最佳+变化线，禁止编造） | 是 |

**引擎验证数据流**：
- 走法验证：`parse_standard_notation`（规则解析，零 LLM）把中文记谱转 UCI → `apply_uci` 推演局面 → 引擎分析该走法后分数（走棋方视角）vs 最佳走法分数 → 差距与判定
- 分数/判定/变化线等数据**全部后端实时获取**，不依赖前端分析面板开关状态（面板关了提问照常实时分析）
- **引擎验证结果最后交 LLM 解读**（`explain_engine_verdict`）：数据权威不可更改，LLM 只解释"这步棋行不行、为什么"，**必须先回答学生问的那步棋**（最佳走法只做一两句对比，防止跑题）

**关键设计**：
- LLM **手动触发**（点发送才调用），省 token；快捷问题零 LLM 零成本
- 各层都携带**走棋历史**（中文记谱）+ 棋盘棋子位置文本（FEN → 棋子坐标列表，LLM 能"看懂"棋盘）
- 局面评估类问题（"当前局面如何"）不进入候选走法验证（LLM 提取器有约束，评估类输出 none）
- 多轮对话：`messages` 仅传当前局面的问答；后端第三层前强制刷新引擎数据
- 引擎崩溃自动恢复（见 6.1/4.9）

### 4.4 人机对战（本地新增）
- 下拉框三态：关闭 / 电脑执红（先手）/ 电脑执黑（后手）
- **切换执方自动重新开局，并自动翻转棋盘——玩家棋子始终在下方**（电脑执红→你执黑→翻转；电脑执黑/关闭→红方在下方默认）
- 轮到电脑时自动调用 `/api/analysis` 同步取得走法并落子，走法按**难度参数**（深度 + Multi-PV 概率选招）
- 防抖设计：`computerBusy`（防并发）、`positionRef` fen 比对（防局面变化误落）、`computerSideRef`（防关闭后误落）
- **防卡死**：请求 15s 超时 + 失败自动重试 3 次 + 引擎走法被前端判非法时从前端合法走法兜底 + 彻底失败显示错误提示而非无限转圈
- **终局兜底**：电脑无棋可走（将死/困毙）时判定终局并显示胜负，不再报错
- 「电脑思考中…」提示；电脑落子高亮 `lastMove`；推荐箭头按 `result.fen === 当前 fen` 匹配显示

### 4.5 电脑难度四档（本地新增）
| 难度 | 深度 | 候选走法 | 选招策略 |
|---|---|---|---|
| 入门 | 6 | 前 3 个 | 40% 最佳 / 35% 次佳 / 25% 第三 |
| 普通 | 10 | 前 3 个 | 70% 最佳 / 25% 次佳 / 5% 第三 |
| 困难 | 12 | 前 3 个 | 90% 最佳 / 10% 次佳 |
| 大师 | 18 | 仅最佳 | 100% 最佳（默认，保持原强行为） |

- 切换难度不重置对局，从电脑下一手生效；
- 分析面板（WS，深度固定 18）始终显示**客观最佳**、与难度无关（教学用途，便于对比「电脑走了什么 vs 最佳是什么」）。

### 4.6 棋局编辑与残局
- 任意局面编辑、FEN 导入/导出、清空/复位
- 后端提供残局题接口（`/api/puzzle/*`）

### 4.7 自动存档/恢复（本地新增）
- 每走一步把「走棋序列 + 起始局面 + 执方 + 难度 + 棋盘朝向」写入 `localStorage`（键 `xiangqi-claw-save`）；
- 页面刷新后自动恢复棋局与全部设置，继续下；
- 点「新局」或切换执方自动清空存档；
- 若刷新时正值电脑回合（如之前卡住），恢复后自动重试走棋，配合防卡死逻辑自愈。

### 4.8 走棋记录（人机对战整回合步进）
- 人机对战模式下「上一步/下一步」**按整回合步进**：上一步 = 撤掉「电脑应手 + 你上一手」（悔棋语义），下一步对称前进；
- 落点自动吸附到「轮到人类」的局面（按执方判断奇偶）；
- 非人机对战保持单步导航；点击单个着法仍可自由跳转任意一步。

### 4.9 稳定性增强（本地新增）
- 前端 `ErrorBoundary`：渲染异常显示错误页 + 重新加载，杜绝黑屏；
- WS 自动重连（2s 间隔），重连后自动重新分析当前局面；
- 引擎无子可动返回 `(none)`/`0000` 时不再崩溃；
- **引擎残留清理**：每次分析前 `stop + isready` 丢弃上次可能残留的 `bestmove`（见 6.1）。

---

## 5. 模块设计

### 5.1 前端 `frontend/src/`

| 模块 | 职责 |
|---|---|
| `lib/xiangqi.ts` | 走法生成（车马炮象士将士兵、飞将、象眼、马腿、炮架）、合法性校验、将死/困毙判定 |
| `lib/fen.ts` | FEN ↔ Position、UCI ↔ 坐标（file a-i、rank 0-9）、走子应用 |
| `lib/notation.ts` | UCI → 中文记谱（含非法输入校验，防御性返回原文，本地兜底） |
| `hooks/useGame.ts` | 局面状态、走棋历史、`goToMove`、`reset`、`loadMoves`、`endGame` |
| `hooks/useEngine.ts` | WS 连接管理（自动重连）、分析请求、`info`/`result` 状态（含 `fen`/`best_move_cn`/`pv_cn`） |
| `components/Board` | SVG 棋盘渲染、点到点走棋（抬起动画）、合法落点、走子动画队列、推荐箭头/走子标记 |
| `components/AnalysisPanel` | 评分/三方胜率条（浅层分数）/PV（红黑着色）/最佳着法（局面校验） |
| `components/CoachPanel` | AI 教练对话（多轮、局面分隔、快捷提问） |
| `components/BoardEffect` | 吃/将军/绝杀 SVG 特效图（抠白底 PNG + 弹入动画） |
| `components/VsComputerDialog` | 人机对战设置弹窗（难度+执方，确认才开局） |
| `components/MoveHistory` | 走棋记录与跳转（人机对战整回合步进） |
| `components/BoardEditor` | 局面编辑器 |
| `components/ErrorBoundary` | 全局错误兜底 |
| `App.tsx` | 状态组装、人机对战/难度/自动存档/防卡死/终局兜底调度 |
| `vite.config.ts` | `host: true`（监听全网卡，局域网可访问） |

### 5.2 后端 `backend/`

| 模块 | 职责 |
|---|---|
| `main.py` | FastAPI 入口，`load_dotenv()` 加载 `.env`，CORS，lifespan 启停引擎 |
| `engine/manager.py` | Pikafish 子进程管理：启动握手、`asyncio.Lock` 串行化、**`_flush_pending` 残留清理**、REST 同步分析、WS 流式分析 |
| `engine/uci.py` | UCI 命令构造（position/go/stop/isready/setoption/quit…） |
| `engine/analysis.py` | 解析 `info`（depth/score/mate/wdl/pv/nodes/nps）与 `bestmove` |
| `services/openai_client.py` | DeepSeek 客户端单例（base_url/model 可环境变量覆盖） |
| `services/llm.py` | AI 教学解析、走法质量分类、整局复盘总结 |
| `services/move_parser.py` | 标准中文记谱解析；自然语言兜底走 LLM |
| `services/notation.py` | **后端权威中文记谱转换**（UCI→中文、PV 逐手推进） |
| `services/puzzle.py` | 残局题库（aiosqlite） |
| `routers/game.py` | 初始局面、走法解析 |
| `routers/analysis.py` | 同步分析（multipv）、AI 教学（余额不足友好报错）、WS 实时分析（回传 fen + 中文） |
| `routers/puzzle.py` | 残局接口 |
| `routers/review.py` | 复盘接口（前端暂未接入） |

---

## 6. 关键技术方案

### 6.1 引擎通信（UCI 协议）
- 单 Pikafish 子进程，`asyncio.create_subprocess_exec` 启动；
- 启动握手：发 `uci` 等 `uciok`，发 `isready` 等 `readyok`；
- 参数：`UCI_ShowWDL=true`、`Threads=2`、`Hash=64`；
- 分析：`position fen {fen}` → `go depth N` → 逐行解析 `info` → 遇 `bestmove` 结束；
- 所有分析（REST `analyse` 与 WS `analyse_stream`）经同一把 `asyncio.Lock`，保证引擎 stdin/stdout 不交叉；
- **残留清理（关键修复）**：每次分析前执行 `_flush_pending()`（发 `stop` + `isready` 并丢弃到 `readyok`）。若上一次分析被中断（WS 断开/超时），引擎可能仍在搜索，残留的 `bestmove` 会被下一次调用误读为本次结果——表现为「黑方局面返回红方走法」等错误方走法。此修复已实测：REST/WS 红黑双方连续分析均返回正确方走法。

### 6.2 WebSocket 实时分析
- 请求：`{"fen": "...", "depth": 18}`；
- 响应：`info` 消息流（评分/深度/PV 渐进更新）→ 最终 `bestmove`（含 `lines`）；
- **`info`/`bestmove` 回传 `fen`、`pv_cn`、`best_move_cn`**：前端优先展示后端转好的中文，本地转换仅兜底——中文正确性由后端权威局面保证，与前端同步状态无关；
- 前端断线自动重连（2s），重连后触发当前局面重新分析。

### 6.3 人机对战（REST 同步走棋 + 难度感知）
- 选择电脑执方后，轮到电脑时前端 `POST /api/analysis`（参数由难度决定：深度 6/10/12/18、multipv 3/3/3/1）同步拿候选走法；
- `pickMove` 按难度概率从 `lines[0..2].pv[0]` 选招（大师取最佳）；
- 选同步 REST 而非复用 WS：结果与请求局面强绑定，规避异步时序竞争；
- 三重防抖（见 4.4）；落子后同步高亮 `lastMove`；
- **电脑回合跳过 WS 分析**（分析面板只在人类回合触发）——同时解决「推荐显示电脑方走法」和「引擎锁竞争导致电脑走棋翻倍延迟」两个问题；
- **防卡死链路**：15s AbortController 超时 → 失败/非法走法自动重试 3 次 → 引擎走法被前端判非法时用前端 `legalMoves()` 随机兜底 → 无棋可走判终局 → 彻底失败显示错误提示。

### 6.4 中文记谱转换
- 坐标约定：`file a-i`（左→右）、`rank 0-9`（**0=红方底线，9=黑方底线**），与引擎一致；
- 红方路数从右向左（`9-col`），黑方从左向右（`col+1`）；
- 直线子（车/炮/兵/将）进退记步数，屈折子（马/象/士）记落点路数；
- **双端实现**：
  - 后端 `services/notation.py`：权威转换，`uci_to_chinese`（单步）+ `pv_to_chinese`（逐手推进局面），WS 消息直接携带 `best_move_cn`/`pv_cn`；
  - 前端 `lib/notation.ts`：兜底转换（含正则校验，非法串返回原文不抛异常——黑屏根因修复点）。

### 6.5 规则引擎（`xiangqi.ts`）
- 10×9 棋盘，`row 0 = 黑方底线`，红子大写；
- `generateLegalMoves`：生成后逐走法验证"不送将"（含飞将直线对脸判定）；
- `isCheckmate` / `isStalemate`（困毙=负）；终局后停止引擎分析。

### 6.6 DeepSeek 接入
- OpenAI 兼容协议：`base_url=https://api.deepseek.com`，`model=deepseek-chat`（当前路由至 `deepseek-v4-flash`）；
- Key 存放 `.env`（已 gitignore），`main.py` 启动时 `load_dotenv()`；
- `LLM_MODEL` / `LLM_BASE_URL` 支持环境变量覆盖（如切换 `deepseek-reasoner`）；
- 错误处理：捕获 `APIStatusError`，余额不足返回友好提示"DeepSeek 账户余额不足，请充值后重试"。

### 6.7 稳定性与错误兜底
- **黑屏根因**：引擎对无子可动局面返回 `bestmove (none)`，旧版 `uciToChineseNotation` 未校验直接 `board[NaN][...]` 崩溃 → 全树卸载；
- 修复：① notation 入口校验；② AnalysisPanel 仅对合法 UCI 转换；③ 终局不再触发分析；④ 全局 `ErrorBoundary`。
- **引擎残留污染**（见 6.1）：`_flush_pending` 清理；经验：共享单进程长跑后必须防残留，否则会出现错误方走法。

### 6.8 自动存档（localStorage）
- 恢复采用「先恢复后保存」：`restored` 状态标记恢复完成前不写档，避免首次渲染把旧存档覆盖掉；
- 新局/切执方清档；存档损坏自动忽略。

### 6.9 局域网访问
- 前端 `vite.config.ts` 设 `host: true`，后端启动参数 `--host 0.0.0.0`；
- 访问地址 `http://<服务器IP>:5173/`（本机 `192.168.48.131`）；
- WS 经 Vite 代理（`/ws` → `ws://localhost:8000`）正常转发，前端按 `window.location.host` 连接。

---

## 7. API 设计

| 方法 | 路径 | 说明 | 用途 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | 部署验证 |
| GET | `/api/game/starting-fen` | 初始 FEN | 前端开局 |
| POST | `/api/game/parse-move` | 中文/自然语言 → UCI | 文字走棋 |
| POST | `/api/analysis` | 同步引擎分析（支持 `depth`/`multipv`） | 分析/人机走棋 |
| POST | `/api/explain` | AI 教学解析（DeepSeek） | AI 教练 |
| WS | `/ws/analysis` | 实时分析流（回传 fen + 中文记谱） | 分析面板 |
| GET | `/api/puzzle/random`、`/{id}` | 残局题 | 残局练习 |
| POST | `/api/review/analyse` | 整局复盘（后端已有） | 复盘（前端未接） |

---

## 8. 部署方案

### 8.1 环境要求
- Python **3.9+**（`websockets>=14` 需要；Ubuntu 20.04 用 `apt install python3.9 python3.9-venv`）
- Node.js 18+ / npm
- C++ 编译器（g++/clang++，编译 Pikafish）
- DeepSeek API Key（AI 教练功能）

### 8.2 本地部署步骤
```bash
# 1. 克隆
git clone https://github.com/StevenYuan666/Xiangqi-Claw.git && cd Xiangqi-Claw

# 2. 编译引擎（仓库自带二进制与宿主 glibc 不兼容，必须重编）
cd Pikafish/src && make clean && make -j$(nproc) build ARCH=x86-64 && cd ../..

# 3. 后端（--host 0.0.0.0 供局域网访问）
python3.9 -m venv .venv && ./.venv/bin/pip install -r backend/requirements.txt
echo 'OPENAI_API_KEY=sk-xxx' > .env        # 或 export
./.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 4. 前端（vite.config.ts 已设 host: true，局域网可访问）
cd frontend && npm install && npm run dev   # http://<IP>:5173，代理 /api /ws
```

### 8.3 部署要点/踩坑记录
- 仓库内预编译 `pikafish` 二进制要求 GLIBC 2.33+/GLIBCXX 3.4.29（作者机器为较新发行版），Ubuntu 20.04（GLIBC 2.31）下必须重编；
- `ARCH=x86-64` 为最兼容选项；CPU 支持可换 `x86-64-modern`；
- 引擎运行期默认加载同目录 `pikafish.nnue`（仓库已带，53MB）；
- Key 放 `.env`（已 gitignore），重启即生效；
- 后台服务可能被会话环境回收（表现为 `cancelled`），需要时重新拉起：后端 `python -m uvicorn ...`，前端 `npm run dev`；
- Windows 访问：浏览器打开 `http://<服务器IP>:5173/`，注意同一局域网 + Windows 防火墙放行。

---

## 9. 已知问题与改进方向

| # | 问题 | 状态/影响 | 建议 |
|---|---|---|---|
| 1 | 无 OSI 许可证（仅声明"学习与个人使用"） | 不能放心二次分发/商用 | 作者补 LICENSE |
| 2 | 分析面板只展示单条 PV | 多候选走法（multi-PV）后端支持但前端未接 | 前端 AnalysisPanel 扩展多线展示 |
| 3 | 复盘（`/api/review`）后端有、前端未接 | 整局复盘不可用 | 前端接入复盘页（CSS 已预留） |
| 4 | 无开局库（Pikafish 构建无 book 选项） | 纯引擎开局偶有非人类招法 | 外部开局库方案（PolyGlot 兼容或自建） |
| 5 | 文字输入自然语言兜底调用 LLM | 隐性 token 消耗 | 改为手动触发或关闭 |
| 6 | AI 教练依赖 DeepSeek 余额 | 余额不足时不可用（已友好报错） | 用户充值；或缓存讲解 |
| 7 | 走子解析 `前/后` 子区分 TODO | 同路双子时解析可能不准 | 补 `前/后` 消歧 |
| 8 | npm 依赖告警（9 高危） | 安全风险 | `npm audit fix` 评估 |
| 9 | 残局题（PuzzleMode）前端入口未见 | 功能不完整 | 确认并接线 |
| 10 | 引擎单进程长跑有残留污染风险 | 已用 `_flush_pending` 缓解 | 如需更强保障，可加「检测到异常结果自动重启引擎」 |

---

## 10. 变更记录（本机增强）

| 日期 | 变更 |
|---|---|
| 2026-08-19 | 部署：重编 Pikafish（glibc 兼容）、Python 3.9 venv、前后端启动 |
| 2026-08-19 | 新增人机对战（下拉选择电脑执方，REST 同步走棋，防抖+高亮） |
| 2026-08-19 | 接入 DeepSeek（base_url/model、`.env`、友好错误提示） |
| 2026-08-19 | 修复黑屏：notation 校验 + 终局停止分析 + ErrorBoundary |
| 2026-08-19 | WS 自动重连 + 重连后自动重新分析 |
| 2026-08-19 | WS 回传 `fen`，中文记谱按分析局面转换，推荐箭头按 fen 匹配守卫 |
| 2026-08-19 | ExplainPanel 换步清空解释；电脑落子高亮 lastMove |
| 2026-08-19 | 切换执方自动重新开局 + 自动翻转棋盘（玩家棋子始终在下方） |
| 2026-08-19 | 电脑难度四档（入门/普通/困难/大师，深度 + Multi-PV 概率选招） |
| 2026-08-19 | 分析面板红黑双方实时胜率条（WDL 换算，按 fen 切视角） |
| 2026-08-19 | 电脑回合不做分析（面板只在人类回合分析，兼修性能与推荐错位） |
| 2026-08-19 | 防卡死：15s 超时 + 重试 3 次 + 前端合法走法兜底 + 错误提示 |
| 2026-08-19 | 终局兜底：电脑无棋可走判胜负；终局面板显示「对局结束」 |
| 2026-08-19 | 自动存档/恢复（localStorage，刷新续局） |
| 2026-08-19 | 走棋记录人机对战整回合步进（上一步=悔棋语义） |
| 2026-08-19 | 后端权威中文记谱（`services/notation.py`，WS 回传 `best_move_cn`/`pv_cn`） |
| 2026-08-19 | 引擎残留清理 `_flush_pending`（stop+isready），修复错误方走法 |
| 2026-08-19 | 局域网访问：`vite.config.ts host:true` + 后端 `--host 0.0.0.0` |
| 2026-08-20 | 砍掉文字/语音走法输入（MoveInput/useVoice），棋盘改点到点 + 抬起动画 |
| 2026-08-20 | 走子动画队列化 + 按距离定速；天天象棋风格走子标记；推荐箭头覆盖棋子 + 起点绿环 |
| 2026-08-20 | 吃/将军/绝杀 SVG 特效图（抠白底 PNG，天天象棋风格弹入动画） |
| 2026-08-20 | AI 教练重构为对话式（CoachPanel 取代 ExplainPanel），多轮 + 快捷提问 |
| 2026-08-20 | AI 教练四层回答体系：快捷模板/走法引擎验证/LLM 候选验证/LLM 兜底（数据硬约束） |
| 2026-08-20 | 引擎验证结果交 LLM 解读（聚焦学生问的走法，数据权威不可改） |
| 2026-08-20 | 胜率改用浅层分数（depth≤6）+ lichess sigmoid（避开残局例和收敛失真） |
| 2026-08-20 | 引擎进程崩溃自动恢复（EngineDiedError + _ensure_alive + REST 重试一次） |
| 2026-08-20 | AI 教练各层携带走棋历史与棋盘棋子位置；引擎数据后端实时获取（不依赖面板开关） |
| 2026-08-20 | 对话保留历史 + 局面分隔提示（AI 上下文只带当前局面的问答） |

---

## 11. 学习要点（供 skill 提炼）

- **引擎侧**：UCI 协议 + 单进程 + 锁串行化 + 残留清理；共享长跑进程的残留 `bestmove` 是「错误方走法」的根因，必须在每次分析前 `stop+isready` 排空；引擎崩溃要有自动恢复（死亡检测 + 重启 + 重试一次）。
- **前端侧**：局面同步是中文记谱正确的关键——「用引擎分析时的 fen 转换」优于「用当前局面转换」；后端权威转换则彻底消除该问题。
- **AI 教练可信度**：LLM 不懂棋，回答的「数据核心」必须来自引擎（分数/判定/变化线）；LLM 只做意图理解和语言解读，且被硬约束（禁止编造分数/走法）。规则解析器（中文记谱→UCI）是零 LLM 高可信的关键一环。
- **残局胜率失真**：中国象棋「例和」残局会让深搜索分数收敛到 0（depth 6=-677 → depth 8=0），用浅层分数（depth≤6）算胜率可避开；Pikafish 的 WDL 参数是国际象棋移植的，不可直接用。
- **工程模式**：异步引擎调用的防卡死三件套（超时、重试、兜底）；React 长生命周期下的状态重置（换步清空、重连重置）；`restored` 标记防止「先保存后恢复」覆盖存档。
- **产品取舍**：教学场景下「面板永远显示客观最佳、电脑按难度走弱」；AI 讲解手动触发省 token；人机对战按整回合悔棋；对话历史保留 + 局面分隔，AI 上下文只带当前局面的问答。

---

## 12. 待做功能（待用户按实际需求决定）

### 12.1 对局复盘（智能复盘）
- **状态**：方案已定（2026-08-20），未实施
- **目标**：对局结束后逐手引擎分析，输出关键漏招/更优招法/本手讲解/整局总结
- **复用点**（核心零件已齐）：`_analyse_after_move` + `judge_score_loss`（走法判定）、`explain_engine_verdict`（讲解）、`generate_game_summary`（总结）、`/api/review` 路由骨架
- **页面布局**：Tab「对局/复盘」切换；复盘视图 = 棋盘（点击关键手跳转对应局面）+ 复盘面板（关键手列表 + 本手讲解 + 整局总结）
- **难点**：逐手分析耗时（40 手 × depth14 ≈ 40-80s）→ 方案：depth10 + 进度条/后台生成，或先只分析敏感手（吃子/将军/兑子）
- **交互**：讲解/总结**手动触发**（省 token，遵循 LLM 手动触发原则）

### 12.2 残局闯关
- **状态**：后端 `/api/puzzle/random` + 前端 `PuzzleMode` 组件均已就绪，**仅缺入口**（对应用天天象棋「残局闯关/题库训练」）
- 接入方式：侧栏或 Tab 加入口即可

### 12.3 其他积压
- 分析面板 multi-PV 前端展示（后端已支持，前端只显示单条 PV）
- 复盘/练习题前端路由若与 Tab 冲突需统一规划
