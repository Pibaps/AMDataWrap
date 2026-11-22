# AMDataWrap V5 — Sécurité Applicative & Checklist OWASP

> **Statut** : Dossier d'architecture V5.

## 1. Cartographie OWASP Top 10 (2021 / 2025) & ASVS L2

| Risque OWASP | État V4.5 (Local) | Exigence V5 (Hébergé Multi-Tenant) |
|---|---|---|
| **A01 Broken Access Control** | Hook `user_id` en place | Vérification systématique `profile.user_id == session.user_id` sur toutes les routes + RLS SQL |
| **A02 Cryptographic Failures** | HTTPS proxies | TLS 1.3 strict, HSTS (`max-age=31536000`), chiffrement au repos des exports RGPD |
| **A03 Injection (SQL/CSV/XSS)** | Requêtes paramétrées SQLite/DuckDB | Idem + neutralisation CSV injection (`=`, `+`, `-`, `@` préfixés par `'`) dans `/api/history/export.csv` |
| **A04 Insecure Design** | Quotas upload 512 Mo | Rate limiting par IP/utilisateur + sandboxing parsing ZIP/XLSX |
| **A05 Security Misconfiguration** | `.env` centralisé (`config.py`) | `AMDW_ENV=production` interdit `CORS=["*"]`, désactive `/docs` & `/openapi.json` publics |
| **A07 Auth Failures** | Mono-utilisateur local | WebAuthn/OIDC, rotation de session, protection CSRF sur cookies `SameSite=Lax` |
| **A08 Integrity Failures** | Checksum SHA-256 imports | Validation stricte schéma `amdw-backup-v1`, signature CI des artefacts |
| **A10 SSRF** | `security.py` allowlist + IP publique | Idem + egress firewall dédié + blocage redirections HTTP (`follow_redirects=False` vérifié) |

## 2. Durcissement des Proxies & Uploads
1. **SSRF (`backend/app/security.py`)** :
   - Conserver la double vérification DNS → `is_public_ip()` avant connexion et désactiver les redirections non validées.
   - Ajouter un cache TTL DNS court ou résoudre via socket pinned pour éliminer tout DNS rebinding TOCTOU.
2. **ZIP Bombs & Archives malveillantes** :
   - En V5 multi-tenant, décompresser dans un worker isolé avec limite stricte de ratio de compression (< 20:1), taille décompressée max (500 Mo) et timeout CPU (30 s).
   - Parser `openpyxl` en `read_only=True` avec limite de lignes (ex: 500 000).

## 3. En-têtes HTTP & Rate Limiting
- **CSP stricte** :
  ```http
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' https://audio-ssl.itunes.apple.com; frame-src https://www.youtube-nocookie.com; connect-src 'self' wss:;
  ```
- **Rate Limiting (Redis / Upstash ou in-memory token bucket)** :
  - `/api/v4/import*` : 5 req / 10 min / utilisateur.
  - `/api/artwork-proxy` : 120 req / min / IP (protégé par cache CDN Cloudflare).
  - `/api/v4/playback/resolve` : 30 req / min / utilisateur.

## 4. Chaîne d'approvisionnement & Secrets
- Secrets stockés exclusivement via variables d'environnement plateforme (Fly Secrets / Cloudflare Secrets), jamais dans `.env` commité.
- CI GitHub Actions : `pip-audit` (Python) + `npm audit --audit-level=high` (Node) + Dependabot hebdomadaire.
