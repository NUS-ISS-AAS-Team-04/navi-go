# 5. AI 安全风险台账

以下风险台账基于当前仓库实现与 CI/CD 配置（`.github/workflows/ci.yml`、`cd.yml`、`llmsecops.yml`）整理。

## 5.1 风险矩阵（定性）

| 风险ID | 风险项 | 可能性 | 影响 | 当前残余风险 |
|---|---|---|---|---|
| R-01 | Prompt Injection / 越权指令注入 | 中 | 高 | 中-低 |
| R-02 | 不安全输出（unsafe content） | 低-中 | 高 | 低 |
| R-03 | LLM 结构化输出偏差/幻觉 | 中 | 中 | 低 |
| R-04 | 外部依赖与供应链风险 | 中 | 高 | 中 |
| R-05 | 密钥泄漏与凭据误用 | 低-中 | 高 | 中-低 |
| R-06 | 上游 API 异常导致可用性下降 | 中 | 中 | 中 |
| R-07 | 数据最小化不足（thread state 持久化） | 中 | 中 | 中 |
| R-08 | 对抗样本绕过静态规则 | 中 | 高 | 中 |

## 5.2 风险明细与控制

### R-01 Prompt Injection / 越权注入

**攻击面**
- 用户输入 `userRequest.requestText` 和 `naturalLanguage`

**现有控制**
- `detectPromptInjection(...)`（`src/security/guardrails.ts`）对常见注入语句做 regex 检测，支持零宽字符和 homoglyph 归一化。
- `risk_guard` 使用 LLM 语义扫描（`RiskGuardSchema`）检测变体攻击。
- 命中后写入 `BLOCKED_PROMPT_INJECTION` 前缀标记。
- `routeFromRiskGuard(...)` 将流程导向 `plan_synthesizer` 的安全拒答路径。

**验证证据**
- `tests/unit/agents/risk-guard.agent.test.ts`
- `tests/redteam/guardrails.redteam.test.ts`（红队对抗测试）

**残余风险**
- 对编码、语义改写、多语混淆、间接注入（通过结构化数据/注释内嵌指令）的覆盖仍有限。

---

### R-02 不安全输出

**攻击面**
- 最终计划摘要文本

**现有控制**
- `detectUnsafeOutput(...)`（`src/security/guardrails.ts`）
- `plan_synthesizer` 在生成 summary 后再次扫描并追加 `safetyFlags`
- `risk_guard` 的 LLM 语义层也会扫描最终输出

**验证证据**
- `tests/unit/security/guardrails.test.ts`
- `tests/redteam/guardrails.redteam.test.ts`

**残余风险**
- 规则库可维护性与覆盖面依赖人工更新；LLM 语义层可能遗漏伪装成旅行建议的有害内容。

---

### R-03 LLM 输出偏差/幻觉

**攻击面**
- 偏好抽取、目的地建议、行程生成、预算估算

**现有控制**
- `withStructuredOutput(...)` + Zod schema 约束所有 LLM agent 输出结构。
- IATA/City code 格式约束。
- 用户显式兴趣项可覆盖模型抽取结果。
- 用户显式目的地（hint + code）有 fallback 合并逻辑。
- 外部工具（Duffel、Open-Meteo）为行程和预算提供 grounding 数据。

**验证证据**
- `tests/integration/*.test.ts`（FakeStructuredChatModel 驱动）
- `tests/evals/travel-planner.eval.ts`（完整性评估）

**残余风险**
- 结构合法不等于语义一定正确；LLM 可能生成不存在的目的地、不存在的航班或脱离实际的预算。

---

### R-04 供应链风险

**攻击面**
- npm 依赖、容器镜像、构建产物

**现有控制（CI/CD 已启用）**
- `npm audit --omit=dev`（CI / LLMSecOps）
- TruffleHog secret scan（CI）
- Semgrep security scan（CI / LLMSecOps）
- Trivy image scan（CI/CD）
- SBOM 生成与上传（CI/CD）
- Build provenance attestation（CD）
- AI dependency security scan（`scripts/ai-dependency-scan.ts`，LLMSecOps）
- Blocklist check for known compromised packages（LLMSecOps）

**验证证据**
- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`
- `.github/workflows/llmsecops.yml`

**残余风险**
- 依赖“已知漏洞”检测为主，零日风险仍存在。

---

### R-05 密钥泄漏与凭据误用

**攻击面**
- `OPENAI_API_KEY`、`DUFFEL_API_TOKEN`、`POSTGRES_URL`、`LANGSMITH_API_KEY`

**现有控制**
- 环境变量 schema 校验 + `require*` 访问器。
- Duffel token 仅通过请求头注入（`src/tools/common/duffel.ts`）。
- 工具层统一 `ToolError`，避免将敏感上下文直接暴露给调用方。
- TruffleHog 扫描仓库 secrets。
- `model-config-audit` 工作流扫描源码中的硬编码 API key 模式。

**残余风险**
- 调试日志/外部系统误配置仍可能造成泄漏。

---

### R-06 上游 API 异常与可用性

**攻击面**
- Duffel、Open-Meteo 网络抖动或限流

**现有控制**
- `requestJson(...)` 统一超时、重试、AbortController。
- HTTP 失败映射到 `ToolError` 分类。
- API 层对 `ToolError` 返回 502，避免吞错。
- Fastify rate limit（100 req/min）缓解滥用。

**验证证据**
- `tests/unit/tools/http.test.ts`
- `src/tools/common/http.ts`

**残余风险**
- 多上游同时异常时仍会影响端到端成功率。

---

### R-07 数据最小化不足

**风险说明**
- `PlannerState` 包含完整 `userRequest`，默认 checkpointer 为 Postgres 持久化。
- 因此线程状态可能包含用户标识信息（如 `userId`）。

**现有控制**
- 线程级隔离（`thread_id`）。
- 可通过部署策略控制数据库保留周期。

**建议控制**
- 生产环境引入 `userId` 映射/脱敏策略。
- 为 checkpoint 数据定义 TTL 或归档清理任务。

---

### R-08 对抗样本绕过静态规则

**风险说明**
- 攻击者可能使用零宽字符、homoglyph、间接注入（Markdown/HTML 注释内嵌指令）绕过 `detectPromptInjection` 的 regex 规则。

**现有控制**
- `normalizeForScan` 已归一化零宽字符和常见 homoglyph。
- `risk_guard` 的 LLM 语义层是主要防御；静态规则作为快速前置过滤。
- 红队测试（`tests/redteam/`）持续评估绕过率。

**验证证据**
- `tests/redteam/guardrails.redteam.test.ts`

**残余风险**
- LLM 语义层本身也可能被针对性越狱提示绕过；目前尚无对抗训练或专用分类器模型。

## 5.3 处置流程（建议）

1. **检测**：`safetyFlags` 命中高风险标记
2. **隔离**：按 `threadId` 追踪相关请求并停止重试
3. **取证**：读取 `GET /plan/:threadId` 快照 + decisionLog
4. **修复**：补充 guardrail 规则或策略
5. **回归**：新增对应单元/红队/集成测试，防止复发

## 5.4 后续增强建议

| 优先级 | 建议 |
|---|---|
| 高 | 为 prompt injection 增加专用轻量级分类器模型（规则 + LLM + 分类器三层） |
| 高 | 为 thread state 增加数据最小化与过期清理策略 |
| 中 | 对 `/plan` 增加认证层（按 user/thread） |
| 中 | 建立更大规模的安全回归用例集（注入语料、越权语料、越狱语料） |
| 中 | 将 red-team 检测率纳入 CI 质量看板 |
| 低 | 对风险命中事件输出统一审计事件流（便于 SIEM 对接） |
