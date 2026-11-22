# AMDataWrap V5 — Comptes Utilisateurs, Authentification & Isolation Multi-Tenant

> **Statut** : Dossier d'architecture V5 (non implémenté en V4.5, préparé via le hook `user_id`).

## 1. Migration depuis le hook V4.5 (`user_id`)
En V4.5, le schéma SQLite (`backend/app/db.py`) et les filtres (`backend/app/filters.py`) préparent déjà l'isolation multi-utilisateurs sans casser le mode mono-utilisateur local :
- `profiles.user_id INTEGER NOT NULL DEFAULT 1`
- `FilterParams.user_id: int = 1`
- `build_profile_id_clause(profile_id, user_id=...)`

### Chemin de migration V5
1. Créer la table `users` (`id`, `email`, `display_name`, `auth_provider`, `external_sub`, `role`, `storage_quota_mb`, `created_at`, `deleted_at`).
2. Migrer la base SQLite mono-utilisateur vers PostgreSQL (Neon/Supabase) ou LibSQL/Turso avec Row-Level Security (RLS) :
   ```sql
   ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
   CREATE POLICY profiles_owner ON profiles
     USING (user_id = current_setting('app.current_user_id')::int);
   ```
3. Rattacher les imports RGPD (`profile_sources`), caches de recherche et préférences UI (`locale`, `timeUnit`) au compte `user_id`.

## 2. Stratégie AuthN / AuthZ
- **Méthodes sans mot de passe recommandées** :
  - **Passkeys (WebAuthn)** + **OAuth2 / OIDC** (Apple Sign-In, Google, GitHub) pour éliminer le stockage de mots de passe.
  - Fallback **Magic Link** signé par HMAC-SHA256 à durée de vie courte (10 min).
- **Providers managés compatibles 0 €** : Supabase Auth (50k MAU gratuits), Clerk (10k MAU), ou **Lucia / Auth.js** auto-hébergé.
- **Jetons & Sessions** :
  - Cookies `HttpOnly; Secure; SameSite=Lax` pour le navigateur web (zéro JWT dans `localStorage`).
  - Tokens Bearer à portée limitée (`scrobble:write`) pour l'extension Chrome MV3 et les raccourcis iOS/Android.
- **RBAC minimal** : `user` (propriétaire de ses profils), `guest_demo` (lecture seule sur la bibliothèque de démo), `admin` (maintenance / métriques agrégées anonymes).

## 3. Conformité RGPD & Cycle de Vie des Données
- **Portabilité (Art. 20)** : Réutiliser l'export `.amdw.json.gz` introduit en V4.5 (`GET /api/v4/profiles/{id}/export`).
- **Droit à l'effacement (Art. 17)** : Endpoint `DELETE /api/v5/account` exécutant une suppression en cascade transactionnelle (`play_events`, `profile_sources`, `profiles`, `search_events`, `users`) + purge des objets R2/S3 associés sous 24 h.
- **Quotas par utilisateur (tier gratuit)** :
  - Max 500 000 `play_events` / utilisateur (~60 Mo compressés).
  - Max 3 profils actifs + 1 profil fusionné.
  - Cache pochettes partagé globalement par clé `(artist_group_key, album_group_key)` pour éviter toute duplication de stockage.
