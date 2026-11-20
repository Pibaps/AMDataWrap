# Adversarial Verification Report — Challenger 2 (Profiles CRUD, Cross-Platform Dedup & Capabilities)

**Milestone:** M1 — Iteration 1 Parallel Verification Wave  
**Role:** Challenger 2 (Profiles CRUD, Cross-Platform Dedup & Capabilities Stress-Tester)  
**Target Scope:** `backend/app/profiles.py`, `backend/app/filters.py`, `backend/app/analytics/overview.py`, `backend/app/analytics/behavior.py`, `backend/app/analytics/duckdb_engine.py`  
**Verdict:** **`PASS`** (Zero Critical / Zero High issues; 2 Medium & 2 Low non-blocking hardening recommendations documented below with exact repros)

---

## 1. Execution & Hygiene Verification

- All empirical probes were executed via `backend/.venv/bin/python` inside isolated `mktemp -d` directories (`/tmp/m1_probe_2_*`) against isolated SQLite/Parquet files.
- All temporary directories were completely deleted (`rm -rf`) and verified absent (`NO_TEMP_DIRS_LEFT`).
- Repository state verified untouched via `git status --short` (only worker M1 files + this exclusive `handoff.md`).

---

## 2. Empirical Probe Results Matrix

### 2.1 Profile Lifecycle & Validation Attacks (`POST / GET / DELETE /api/v4/profiles*`)

| Probe | Input / Action | Observed Result | Contract Status |
| :--- | :--- | :--- | :---: |
| Empty name | `{"name": ""}` | `HTTP 400` (`Le nom du profil doit contenir entre 1 et 120 caractères.`) | PASS |
| Whitespace-only name | `{"name": "   \t\n  "}` | `HTTP 400` | PASS |
| Null name | `{"name": null}` | `HTTP 422` (Pydantic validation) | PASS |
| Exact 120-char name | `{"name": "a"*120}` | `HTTP 201` | PASS |
| Padded 120-char name | `{"name": "  " + "b"*120 + "  "}` | `HTTP 201` (trimmed to 120) | PASS |
| 121-char name | `{"name": "a"*121}` | `HTTP 400` | PASS |
| Invalid `kind` | `{"name": "Test", "kind": "super"}` | `HTTP 400` | PASS |
| Merged empty list | `{"kind": "merged", "merged_profile_ids": []}` | `HTTP 400` | PASS |
| Merged duplicate IDs | `{"kind": "merged", "merged_profile_ids": [1, 1]}` | `HTTP 400` | PASS |
| Merged negative / zero IDs | `[1, -1]` and `[1, 0]` | `HTTP 400` | PASS |
| Merged nonexistent ID | `[1, 999]` | `HTTP 400` (`Profil(s) source introuvable(s) : [999]`) | PASS |
| Merged non-int ID | `["abc"]` | `HTTP 422` | PASS |
| Nested merged profile | `merged_profile_ids=[1, m23_id]` | `HTTP 400` (`Impossible de fusionner un profil déjà fusionné`) | PASS |
| Merged 1-member `[1]` | `{"kind": "merged", "merged_profile_ids": [1]}` | `HTTP 201` (explicitly allowed by implementation; see **Finding L1**) | NOTE (Low) |
| Standard + non-empty `merged_profile_ids` | `{"kind": "standard", "merged_profile_ids": [1]}` | `HTTP 201` with `merged_profile_ids: []` sanitized (see **Finding L2**) | NOTE (Low) |
| Delete default profile `id=1` | `DELETE /api/v4/profiles/1` | `HTTP 400` | PASS |
| Delete active merged profile | Activate `MAct`, `DELETE /api/v4/profiles/{MAct}` | `HTTP 200`, `active_profile_id == 1` | PASS |
| Delete 1 of 2 members (`P2` from `M23=[P2, P3]`) | `P2` had duplicate `"SharedHit"` (prio 100) beating `P3` (prio 95) + `P3` had `"OnlyP3"` | `HTTP 200`; `M23` updated to `members=[P3]`, `sources=1`, `total_plays=2` (**`P3`'s previously excluded `"SharedHit"` cleanly un-excluded!**), `recompute-merge` returns `{checked: 2, excluded: 0, kept: 2}`, `capabilities` returns `platforms=['spotify'], total_plays=2` | PASS |
| Delete LAST member (`P3` from `M23=[P3]`) | `DELETE /api/v4/profiles/{P3}` leaving `M23` with `[]` | `HTTP 200`; `GET /api/v4/profiles` (`total_plays=0, sources=[], merged_profile_ids=[]`), `POST /recompute-merge` (`{checked:0, excluded:0, kept:0}`), `GET /profile/capabilities?profile_id=M23` (all `False`/`0.0`/`[]`), activating `M23` + `GET /profile/capabilities` (omitted `profile_id`), and `build_where_clause(FilterParams(profile_id=M23))` (`COUNT=0`) ALL succeed with zero crashes | PASS |

### 2.2 Cross-Platform Deduplication Attacks (`recompute_merged_exclusions`)

| Probe | Setup | Observed Result | Contract Status |
| :--- | :--- | :--- | :---: |
| False-positive same title, different artist | `"Hello"` (`Adele`, P1, t=0, prio 100) vs `"Hello"` (`Lionel Richie`, P2, t=10, prio 95) | `fp_a_excl=False, fp_b_excl=False` (both kept) | PASS |
| ISRC format normalization | `"us-rc1-76-07839"` (P1) vs `"USRC17607839"` (P2) on differently-titled tracks, delta=50s | `isrc_a_excl=False, isrc_b_excl=True, reason="isrc"` | PASS |
| Short/invalid ISRC rejection | `"N/A"` and `"123"` on unrelated songs within 5s | Not deduplicated (`a_excl=False, b_excl=False`) | PASS |
| Bogus 8+ char placeholder ISRC | `"NOT_AVAILABLE"` vs `"NOT-AVAILABLE"`, and `"000000000000"` on unrelated songs within 5s | **Falsely deduplicated (`reason="isrc"`)** because `_normalize_isrc` only checks `len >= 8` instead of ISO 3901 12-char regex (see **Finding M1**) | MEDIUM |
| Short-artist substring false-positive | `"Intro"` (`"M"`, P1, t=0) vs `"Intro"` (`"Eminem"`, P2, t=10) | **Falsely deduplicated (`reason="similarity"`)** because `similarity_score("M", "Eminem") == 0.88 >= 0.85` (see **Finding M2**) | MEDIUM |
| Exact ±180s boundary — `isrc` | Deltas `179`, `180`, `181` | `179`: excluded (`isrc`); `180`: excluded (`isrc`); `181`: kept (`None`) | PASS |
| Exact ±180s boundary — `canonical_key` | Deltas `179`, `180`, `181` | `179`: excluded (`canonical_key`); `180`: excluded (`canonical_key`); `181`: kept (`None`) | PASS |
| Exact ±180s boundary — `similarity` | Deltas `179`, `180`, `181` | `179`: excluded (`similarity`); `180`: excluded (`similarity`); `181`: kept (`None`) | PASS |
| Reverse-priority chain | `A(t=0, prio=100, P1)` + `B(t=150, prio=60, P2)` + `C(t=300, prio=95, P3)` | `A_excl=False, B_excl=True, C_excl=False` (A and C kept, B excluded; A does NOT exclude C) | PASS |
| Same-profile rapid repeat | 3 plays of `"RapidLoop"` 60s apart in P1 inside merged `[P1, P2, P3]` | `excl=[False, False, False]` (all 3 kept) | PASS |
| NULL `source_priority` & NULL `canonical_track_key` | `apple_rgpd_zip` (NULL prio) vs `youtube_takeout` (NULL prio), delta=30s | Falls back to `V4_PROVIDER_PRIORITY` (100 vs 60) & `canonical_key_for`; `b` excluded with `reason="canonical_key"` | PASS |
| Scale & performance (2,000 events / 3 profiles) | 1,000 P1 + 500 P2 dupes (+25s) + 500 P3 unique | Run 1: **29.5 ms**, Run 2 (idempotent): **28.4 ms** (< 1,000 ms budget); `{checked: 2000, excluded: 500, kept: 1500}`; SQL `COUNT(*) = 1500` | PASS |

### 2.3 Capabilities Matrix & Analytics Isolation (`GET /api/v4/profile/capabilities`, `behavior.py`, `overview.py`, `duckdb_engine.py`)

| Probe | Input | Observed Output | Contract Status |
| :--- | :--- | :--- | :---: |
| Unfiltered merged `[Apple, Spotify(ext+acc), YTM]` | `profile_id=4` | `platforms=['apple_music','spotify','youtube_music']`, `total_plays=4`, `estimated_duration_pct=25.0`, all relevant flags `True` | PASS |
| Alias `?source_provider=spotify` | `profile_id=4&source_provider=spotify` | `platforms=['spotify']`, `source_providers=['spotify_account','spotify_extended']`, `total_plays=2`, `has_lyrics_events=False`, `has_search_events=False`, `has_incognito_flag=True`, `estimated_duration_pct=0.0` | PASS |
| Raw `?source_provider=spotify_extended` | `profile_id=4&source_provider=spotify_extended` | `total_plays=1`, `has_end_reasons=True`, `has_incognito_flag=True`, `has_shuffle_flag=True` | PASS |
| Raw `?source_provider=spotify_account` | `profile_id=4&source_provider=spotify_account` | `total_plays=1`, `has_end_reasons=False`, `has_incognito_flag=False`, `has_shuffle_flag=False` | PASS |
| Multi-alias `?source_provider=apple_music,youtube_music` | `profile_id=4&source_provider=apple_music,youtube_music` | `platforms=['apple_music','youtube_music']`, `total_plays=2`, `estimated_duration_pct=50.0`, `has_lyrics_events=True`, `has_search_events=True`, `has_incognito_flag=False` | PASS |
| Unknown `?source_provider=unknown_xyz` | `profile_id=4&source_provider=unknown_xyz` | `platforms=[]`, `total_plays=0`, `estimated_duration_pct=0.0`, all boolean flags `False`, zero div-by-zero | PASS |
| Case-insensitive / empty / whitespace commas | `APPLE_MUSIC`, `SPOTIFY`, `""`, `" , , "`, `"all"` | Normalized cleanly; empty/commas/`all` behave as unfiltered | PASS |
| Omitted `profile_id` lifecycle | Default -> activate `P2` -> delete `P2` | Returns `profile_id=1` -> `profile_id=2` -> falls back cleanly to `profile_id=1` | PASS |
| Missing explicit `profile_id=99999` | `profile_id=99999` | `HTTP 404` | PASS |
| `behavior.py`, `overview.py`, `duckdb_engine.py` | Profile 1 (Apple+lyrics+search), Profile 2 (Spotify), Merged `[1,2]`, Merged+`spotify` | Lyrics/searches strictly isolated (`P1=1`, `P2=0`, `Merged=1`, `Merged+spotify=0`, `Merged+apple_music=1`); `overview.get_filter_options()` scopes `providers` per profile; `export_parquet_snapshot()` exports V4 columns cleanly | PASS |

---

## 3. Non-Blocking Hardening Recommendations (Medium / Low — Do Not Block M1)

1. **[MEDIUM — M1] Tighten `_normalize_isrc()` to ISO 3901 format (`backend/app/profiles.py:117-121`):**
   - *Current behavior:* `_normalize_isrc()` strips non-alphanumeric chars and accepts any string with `len >= 8`.
   - *Repro:* Two unrelated tracks played 5s apart with `isrc="NOT_AVAILABLE"` vs `"NOT-AVAILABLE"` (or `"000000000000"`) falsely deduplicate with `reason="isrc"`.
   - *Recommended fix:* Enforce ISO 3901 regex `^[A-Z]{2}[A-Z0-9]{3}\d{7}$` (12 chars, country + registrant + year + designation) and reject all-zero designation codes.
2. **[MEDIUM — M2] Guard short-artist substring false-positives in `_events_match()` (`backend/app/profiles.py:238-243`):**
   - *Current behavior:* `_events_match()` calls `normalize.similarity_score(a.artist_name, b.artist_name) >= 0.85`, which returns `0.88` whenever `ka in kb or kb in ka`.
   - *Repro:* `"Intro"` by `"M"` (`-M-`) at `t=0` (P1) and `"Intro"` by `"Eminem"` at `t=10` (P2) falsely deduplicate (`"m" in "eminem"` → `0.88 >= 0.85`).
   - *Recommended fix:* Guard fuzzy artist matching so substring shortcut does not trigger on short artist keys (e.g., require `min(len(a.artist_gk), len(b.artist_gk)) >= 4` or token-level Jaccard for artist names).
3. **[LOW — L1] Creation of 1-member merged profile (`merged_profile_ids=[1]`):**
   - *Current behavior:* `POST /api/v4/profiles` allows `kind="merged"` with a single source ID (`[1]`), returning `201`. (Degrading to 1 or 0 members on member deletion is properly handled; optionally requiring `len >= 2` at creation time would be stricter if desired by the UI.)
4. **[LOW — L2] Non-empty `merged_profile_ids` on `kind="standard"`:**
   - *Current behavior:* `POST /api/v4/profiles` with `kind="standard"` and `merged_profile_ids=[1]` returns `201` and safely sanitizes stored `merged_profile_ids` to `[]` rather than returning `400`. No state corruption occurs.

---

## 4. Final Verdict

**VERDICT: `PASS`** — Every core M1 contract for Multi-Profile CRUD, profile deletion (down to 0-member merged profiles), cross-platform ISRC / `canonical_key_for` / fuzzy / ±180s deduplication, reverse-priority chains, same-profile rapid repeats, 2,000-event performance (29.5 ms), Dynamic Capabilities Matrix, and analytics/DuckDB isolation holds with **zero Critical and zero High issues**.
