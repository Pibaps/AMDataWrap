# Milestone M2C Dispatch Record

- **Milestone:** M2C — Phase 1: 0€ Real-Time Multi-OS Tracking, Web Scrobbler Webhook, ListenBrainz QR Setup & Live WebSockets
- **Sub-Orchestrator ID:** `f8057147849fb7eb3dfaca771ab87bc9`
- **Parent Orchestrator ID:** `799cd2e0a4e262e978fe0fc571a501c9`
- **Repository:** `/home/antigravity/Pibaps/AMDataWrap`
- **Exclusive State Folder:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m2c`
- **Workspace Policy:** `Workspace: "inherit"` ONLY (never `branch` or `share`)
- **VM Policy:** Linux user-space (`backend/.venv/bin/pytest`, `uv`, `python3`), NO `sudo` / `apt`

## Mandatory Reads (Verbatim Reference in Every Subagent Dispatch)
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/ORIGINAL_REQUEST.md`
- `/home/antigravity/Pibaps/AMDataWrap/PROJECT.md`
- `/home/antigravity/Pibaps/AMDataWrap/docs/plans/PLAN_V4_FINAL.md`
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1/handoff.md`
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/survey_spec_miner_docs/handoff.md`

## Canonical Verification Commands
- M2C target suite: `backend/.venv/bin/pytest -v backend/tests/test_tracking_v4.py`
- Primary Reviewer regression suite: `backend/.venv/bin/pytest -v backend/tests/test_properties.py backend/tests/test_openapi_fuzz.py backend/tests/test_profiles_v4.py backend/tests/test_tracking_v4.py` (or full `backend/.venv/bin/pytest -v`)
