# AMDataWrap V5 — Architecture d'Hébergement 0 € / Low-Cost (PC & Mobile)

> **Objectif** : Déployer AMDataWrap en ligne pour PC et Mobile tout en maintenant un coût fixe à **0 €/mois** au démarrage, puis linéaire et prévisible à l'échelle.

## 1. Topologie Cible (Serverless Edge + Compute Léger)

```
[Client PC / Mobile PWA]
        │
        ├──► Cloudflare Pages (Static Vite SPA + Cache Pochettes Edge 0 €)
        │
        └──► Backend FastAPI (Fly.io / Render / Koyeb)
                ├── Métadonnées & Profils : Turso (LibSQL) ou Neon (Postgres Free)
                ├── Snapshots Analytiques : DuckDB sur Parquet stockés dans Cloudflare R2
                └── Cache Pochettes & Lyrics : Cloudflare R2 (10 Go gratuits, 0 € egress)
```

## 2. Choix des Briques 0 € / Free Tier
1. **Frontend SPA + Assets (`frontend-v4.1/dist`)** :
   - **Cloudflare Pages** : bande passante illimitée gratuite, HTTP/3, TLS auto, CDN mondial (idéal pour les chunks Vite et les assets PWA).
2. **Backend API Python (`backend/app`)** :
   - **Fly.io** (ou **Render / Koyeb**) : 1 VM `shared-cpu-1x` 512 Mo RAM (~0–3 €/mois) ou scale-to-zero sur Cloud Run (2M requêtes/mois gratuites).
   - Note DuckDB : limiter `PRAGMA memory_limit='256MB'` et `PRAGMA threads=2` pour tenir confortablement dans 512 Mo RAM.
3. **Base de données & Stockage** :
   - **Neon PostgreSQL Free** (0.5 Go, branching) ou **Turso LibSQL** (9 Go gratuits, compatible dialecte SQLite V4.5 avec migration quasi nulle !).
   - **Cloudflare R2** : 10 Go gratuits + **zéro frais de sortie (egress)** pour stocker les snapshots `.parquet` par utilisateur et le cache pochettes redimensionnées WebP.

## 3. Estimation des Coûts par Palier d'Utilisateurs (MAU)

| Palier | Frontend + CDN | Backend Compute | Base de données | Stockage R2 (Parquet + Covers) | Total estimé / mois |
|---|---|---|---|---|---|
| **1–50 MAU (Privé / Amis)** | 0 € (CF Pages) | 0 € (Cloud Run / Koyeb free) | 0 € (Turso / Neon free) | 0 € (< 2 Go R2) | **0 €** |
| **100 MAU** | 0 € | 0–3 € (1 VM 512 Mo) | 0 € | 0 € (~5 Go R2) | **0 – 3 €** |
| **1 000 MAU** | 0 € | ~7 € (1 Go RAM + worker) | 0–5 € (Turso Scaler / Neon) | ~1 € (~30 Go R2) | **8 – 13 €** |
| **10 000 MAU** | 0 € | ~25 € (2× VM 1 Go + Redis Upstash) | ~19 € (Postgres managé) | ~5 € (~250 Go R2) | **~49 €** |

## 4. Stratégie Mode Hybride (Offline-First)
- Conserver la possibilité pour les utilisateurs desktop de garder **AMDataWrap Local** (0 octet envoyé dans le cloud) et d'exporter/importer un profil via `.amdw.json.gz` vers la version hébergée uniquement s'ils souhaitent consulter leurs stats sur mobile.
