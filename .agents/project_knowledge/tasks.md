# Current and Active Project Tasks

Coordination registry for tasks and progress between agents and the user.
Before starting work, every agent MUST review the active task list and, if necessary, log subtasks with their authorship.

---

## Team Task Management Rules
1. **Authorship and Timestamp Logging:** Every task and subtask is logged in the format:
   `- [ ] [agent-id @ YYYY-MM-DD HH:MM] Task description`
2. **Delegation (Out-of-Scope Handoff):** If a subtask exceeds the current agent's boundaries, it is logged in "Delegated Subtasks" with the target role (`agent-<role>`).
3. **Step Completion:** Upon completing a task, change the status to `- [x]` and optionally append a 1-line summary result.
4. **Sanctity of Other Agents' Notes:** Agents are prohibited from deleting or modifying entries written by others. Editing is restricted to own entries (status, details). Upon finding an error in another agent's note, present the conflict description with arguments to the user.

---

## Active Objective
- **Task:** Meta-Project Environment Synchronization & Invariant Hardening
- **Initiator:** User
- **Start Date:** 2026-11-10

---

## Execution Plan and Checklist
- [x] [agent-meta-guardian @ 2026-11-10 01:33] Step 1: Sync procedural skills from meta-project repository
- [x] [agent-meta-guardian @ 2026-11-10 01:34] Step 2: Implement Default Deny invariant in boundaries.md and register [theme] category in record-observation
- [x] [agent-meta-guardian @ 2026-11-10 01:35] Step 3: Implement Pre-Flight Flow Tracing in architecture.md and update weak_spots.md
- [x] [agent-meta-guardian @ 2026-11-10 01:36] Step 4: Update AGENTS.md with Circuit Breaker, Pre-Flight Flow Tracing, and Default Deny North Stars
- [x] [agent-meta-guardian @ 2026-11-10 01:37] Step 5: Update all role system prompts (.agents/team/*/system_prompt.md) with Circuit Breaker and Target State Audit
- [x] [agent-meta-guardian @ 2026-11-10 01:54] Step 6: Deploy and register agent-intake-dispatcher role for intake & routing
- [x] [agent-general-worker @ 2026-11-10 03:15] DEV-1: Graceful Shutdown сервера (stopScheduler, SIGTERM/SIGINT, test/gracefulShutdown.test.ts) — проверено тестом test/gracefulShutdown.test.ts
- [x] [agent-general-worker @ 2026-11-10 03:20] DEV-2: Внедрение статического линтера и форматтера Biome (biome.json, package.json) — проверено npm run lint (0 ошибок)
- [x] [agent-general-worker @ 2026-11-10 03:30] DEV-3: Настройка Pre-commit Git-хуков (simple-git-hooks, lint-staged) — проверено блокировкой коммита с ошибкой парсинга
- [x] [agent-devops-infra @ 2026-11-10 09:58] INFRA-1: Сборка и тесты Linux-клиента в CI (.github/workflows/ci.yml: compile-native-linux-client на ubuntu-latest) — проверено валидацией YAML и структурой шагов
- [x] [agent-devops-infra @ 2026-11-10 09:58] INFRA-2: CI-барьер рассинхрона шаблонов (Template Drift Check в verify джобе) — проверено npm run sync:templates и git diff --exit-code
- [x] [agent-devops-infra @ 2026-11-10 09:58] INFRA-3: Автоматизация мониторинга уязвимостей (Dependabot weekly npm/actions + Gitleaks в .github/workflows/security.yml) — проверено валидацией YAML и npm audit
- [x] [agent-security-auditor @ 2026-11-10 10:37] SEC-1: Валидация атомарности завершения и чистоты хранилища (Graceful Shutdown & writeJsonAtomic) — проверено синхронным контрактом, инспекцией каталога data/ и полным сьютом тестов (689 passed)

---

## Delegated Subtasks and Blockers
- *(No active blockers)*
