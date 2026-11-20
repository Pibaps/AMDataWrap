# Dispatch — Milestone M2D (Phase 1: 0€ Playback Resolver & Manifest V3 Browser Extension)

- **Sub-Orchestrator ID:** `ac7138bb721aa1e5e70d202d15656ff5`
- **Parent Orchestrator ID:** `799cd2e0a4e262e978fe0fc571a501c9`
- **Working Directory:** `/home/antigravity/Pibaps/AMDataWrap`
- **State Folder:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m2d`
- **Workspace Mode:** `inherit` (strictly enforced for all subagents)
- **Status:** INITIALIZED → Iteration 1 (Step a: Explorers)

## Mandatory Reads (Verbatim for Every Subagent)
1. `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/ORIGINAL_REQUEST.md`
2. `/home/antigravity/Pibaps/AMDataWrap/PROJECT.md`
3. `/home/antigravity/Pibaps/AMDataWrap/docs/plans/PLAN_V4_FINAL.md`
4. `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1/handoff.md`
5. `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/survey_spec_miner_docs/handoff.md`

## Canonical Verification Commands
- Backend M2D tests: `backend/.venv/bin/pytest -v backend/tests/test_playback_v4.py`
- Extension JS syntax check: `node --check extensions/amdatawrap-bridge/background.js extensions/amdatawrap-bridge/popup.js extensions/amdatawrap-bridge/connectors/*.js`
- Full backend suite (Primary Reviewer): `backend/.venv/bin/pytest -v backend/tests/test_properties.py backend/tests/test_openapi_fuzz.py backend/tests/test_profiles_v4.py backend/tests/test_playback_v4.py`
