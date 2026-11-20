# Dispatch Log

## 2026-11-20T14:58:15Z
From: 7695a5ebeb1f4656fedcefa1d94e1595 (Sentinel)

Tu es le Project Orchestrator pour l'implémentation complète d'AMDataWrap V4 dans le dépôt `/home/antigravity/Pibaps/AMDataWrap`.

## Paramètres de session
- **Working directory (racine du projet)** : `/home/antigravity/Pibaps/AMDataWrap`
- **State folder (ton dossier d'état exclusif)** : `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/orchestrator_v4`
- **Requête utilisateur complète** : `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/ORIGINAL_REQUEST.md`
- **Plan maître à suivre strictement** : `/home/antigravity/Pibaps/AMDataWrap/docs/plans/PLAN_V4_FINAL.md` (avec `docs/README.md` et le dossier `docs/` en référence technique si besoin).

## Contraintes strictes
1. Lis d'abord `ORIGINAL_REQUEST.md` et `docs/plans/PLAN_V4_FINAL.md`.
2. Respecte strictement l'ordre séquentiel des phases : **Phase 1 -> Phase 2 -> Phase 3** (ne pas démarrer la phase suivante tant que les fondations et validations de la phase en cours ne sont pas prêtes).
3. Parallélise intelligemment les chantiers indépendants au sein de chaque phase (ex : en Phase 1, parseurs RGPD/Takeout, multi-profils/capacités, réconciliation ISRC/vinyles, tracking continuum/webhooks, moteur playback & extension MV3 ; en Phase 2, socle `frontend-v4`, scène 3D Bac à Vinyles & Tourne-Disque, Galaxie 3D V4, vues analytiques ; en Phase 3, optimisations paliers graphiques Mobile/WebGPU, LAN/QR Code, validation complète & Playwright Desktop + Mobile) tout en gardant un budget raisonnable.
4. **Ne casse rien d'existant** : V1 (`frontend/`), V2 (`frontend-v2/`), V3 (`frontend-v3/`) et les tests backend existants doivent continuer de fonctionner.
5. **Environnement VM Linux** : pas de `sudo`/`apt` ; utilise `uv` / `python3 -m venv` / `npm` en espace utilisateur.
6. **Mode workspace** : utilise UNIQUEMENT `Workspace: "inherit"` pour tous tes sous-agents (ne jamais utiliser `branch` ou `share`).
7. Maintiens à jour `BRIEFING.md` et `progress.md` dans ton state folder `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/orchestrator_v4` pour le suivi du Sentinel.
8. Quand toutes les phases et toute la checklist de validation (section 5 de `PLAN_V4_FINAL.md`) sont terminées et vérifiées, envoie ton rapport de complétion final (avec les résultats de tests et chemins d'artefacts) au Sentinel. Note qu'un Victory Auditor indépendant vérifiera tout avant confirmation finale.
