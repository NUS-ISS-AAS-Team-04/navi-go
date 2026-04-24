# 8. 评估与测试总结

本节基于当前 `tests/` 与脚本配置，给出 NaviGo 的测试与评估总结。

## 8.1 测试分层

```
tests/
├── unit/
│   ├── agents/
│   ├── security/
│   └── tools/
├── integration/
│   ├── api.chat-endpoint.test.ts
│   ├── api.frontend-route.test.ts
│   ├── api.plan-endpoint.test.ts
│   └── graph.plan-flow.test.ts
├── redteam/
│   └── guardrails.redteam.test.ts
├── evals/
│   └── travel-planner.eval.ts
└── helpers/
    └── fake-model.ts
```

### 单元测试

- `tests/unit/agents/budget.agent.test.ts`
- `tests/unit/agents/itinerary.agent.test.ts`
- `tests/unit/agents/risk-guard.agent.test.ts`
- `tests/unit/agents/form-completer.agent.test.ts`
- `tests/unit/agents/requirement-parser.agent.test.ts`
- `tests/unit/security/guardrails.test.ts`
- `tests/unit/tools/http.test.ts`

目标：验证单模块逻辑正确性与错误路径。

### 集成测试

- `tests/integration/graph.plan-flow.test.ts`
- `tests/integration/api.plan-endpoint.test.ts`
- `tests/integration/api.frontend-route.test.ts`
- `tests/integration/api.chat-endpoint.test.ts`

目标：验证完整图流程、API 路由（含聊天与恢复）、静态资源与状态持久化读取行为。

### 红队测试

- `tests/redteam/guardrails.redteam.test.ts`

目标：验证护栏对已知攻击向量（注入、越狱、homoglyph、零宽字符、间接注入、上下文操纵）的检测能力，并记录盲区。

### 评估

- `tests/evals/travel-planner.eval.ts`

目标：验证“最终计划完整性”基线；该用例对 `LANGSMITH_API_KEY` 做环境门控。

## 8.2 关键覆盖点（按模块）

| 模块 | 已有验证点（来自测试代码） |
|---|---|
| `requirement-parser.agent.ts` | 自然语言字段提取、缺失字段过滤 |
| `form-completer.agent.ts` | 完整表单组装、待澄清问题生成 |
| `risk-guard.agent.ts` | 注入命中与非命中分支、LLM 扫描与规则扫描合并、风险标记写入 |
| `itinerary.agent.ts` | LLM 行程生成、往返航班集成、天气风险传导、未知城市锚点 fallback |
| `budget.agent.ts` | 超预算/预算内分支及风险标记 |
| `guardrails.ts` | prompt injection / unsafe output 检测、零宽字符与 homoglyph 归一化 |
| `tools/common/http.ts` | query 组装、超时中断与错误映射 |
| `graph/builder.ts` + `routes.ts` | 全链路执行、按状态推进节点、聊天恢复、线程恢复 |
| API 路由 | `POST /plan`、`POST /plan/chat`、`POST /plan/chat/resume`、`GET /plan/:threadId` 行为与状态读取 |

## 8.3 测试策略特点

### 1) 可重复性强

测试大量使用：

- `FakeStructuredChatModel`
- `createInMemoryCheckpointer()`
- itinerary 依赖注入（stubbed flight/weather）

因此单元与集成测试不依赖真实外部 API，结果稳定。

### 2) 边界约束一致

测试夹具普遍通过 schema（如 `UserRequestSchema.parse(...)`）构造，保证与生产输入契约一致。

### 3) 状态机验证优先

集成测试关注的是状态图执行结果（`finalPlan`、snapshot、thread 恢复、chat resume），而不是内部实现细节，适合保障重构安全。

### 4) 红队信息性记录

`tests/redteam/guardrails.redteam.test.ts` 对已知盲区（如变体动词、复数形式）仅做信息性日志，不阻断构建，避免假阳性影响开发节奏，同时保留安全审计线索。

## 8.4 当前评估（Eval）机制

`tests/evals/travel-planner.eval.ts` 的基线评分由四项组成：

- 有 summary
- itinerary 非空
- packingList 非空
- budget 存在

通过条件：`completenessScore >= 4`。

这属于“结构完整性”评估，适合作为最低质量门槛。

## 8.5 仍可增强的评估维度

以下为建议项（当前仓库未完整实现）：

1. **相关性评估**：目的地/行程与用户兴趣匹配度
2. **预算准确性评估**：估算模型与样本真实开销偏差
3. **安全鲁棒性评估**：注入变体语料回归集（超越当前 red-team 的定性记录）
4. **多场景回归**：亲子、多人、高风险天气、无航班、往返航班异常等边界场景
5. **性能评估**：分节点耗时与外部 API 失败率趋势
6. **聊天体验评估**：澄清问题质量、多轮对话完成率

## 8.6 执行命令汇总

```bash
npm run test:unit
npm run test:integration
npm run test:eval
npm run test
npm run acceptance
```

Red-team 测试（需要 `OPENAI_API_KEY` 以运行 LLM 生成变体，静态对抗样本无需）：

```bash
npx vitest run tests/redteam/
```

其中 `acceptance` 会在满足环境变量时追加 live CLI 场景验证。

## 8.7 结论

基于现有测试代码可确认：

- 核心规划链路（graph + API，含聊天模式）已有自动化覆盖
- 关键安全环节（注入检测、unsafe output 检测、红队对抗测试）已有单元/集成/红队测试覆盖
- 外部依赖调用的超时与错误映射已有单元测试覆盖
- Prompt 安全静态分析与模型配置审计已纳入 LLMSecOps 流水线

同时，当前 eval 仍以结构完整性为主，若用于更高可靠性场景，建议补齐语义质量、安全鲁棒性量化评分与性能回归三类评估。
