# AMDataWrap V4 — État des Lieux (Travail Effectué)

> Dernière mise à jour : 2026-11-20 · Branche `main` (pushée sur `origin/main`)

---

## 1. Architecture Globale (`frontend-v4/`, port `5176`)

L'interface V4 (« Salon d'écoute ») repose sur :
- **React 19 + TypeScript + Vite 6 + Tailwind CSS v4** (`@tailwindcss/vite`)
- **Three.js `0.174.0`** (`WebGLRenderer`, `CSS3DRenderer`, `OrbitControls`, `RoomEnvironment` PMREM, `RoundedBoxGeometry`) + **GSAP `3.12.7`**
- **Zustand `5.0.3`** (`src/store/useV4Store.ts`) + horloge haute fréquence hors-React (`src/audio/playbackClock.ts`)
- **Code-splitting & Lazy Loading** (`src/App.tsx` + `vite.config.ts`) : bundle applicatif principal réduit à ~328 Ko (103 Ko gzip), avec chargement à la demande des 11 pages analytiques en micro-chunks (3 à 13 Ko).
- **Direction Artistique « Salon d'écoute / Liner Notes »** (`src/index.css`) : palette chaude mate (`#0f0c0a`, `#16110e`, `#ede2d2`, ambre `#e8873e`, laiton `#c9a86b`), typographie *Fraunces* + *Inter* + *JetBrains Mono*, **zéro `backdrop-filter: blur()`** au-dessus du WebGL.
- **Filtrage par défaut sur Apple Music** (`source_provider: "apple_music"`).

---

## 2. Salon d'Écoute 3D (`src/scene/PersistentStageCanvas.tsx` & `src/scene/textures.ts`)

- **Canvas 3D persistant** monté une seule fois à la racine (`App.tsx`) : la boucle `requestAnimationFrame` se met automatiquement en pause (`0% GPU/CPU`) dès que l'utilisateur quitte l'onglet `Salon 3D`.
- **Décor physique complet** :
  - Crédence en noyer massif, mur en plâtre chaud texturé, panneau acoustique à lattes (`InstancedMesh`), lampe d'architecte en laiton cliquable (allume/éteint le spot tungstène).
  - Chevalet en bois (*Now Playing*) à gauche affichant la pochette de l'album posé sur la platine.
- **Tourne-disque Direct-Drive détaillé (type Technics SL-1200 MK II)** :
  - 3 finitions commutables (*Technics Noir*, *Alu Brossé*, *Noyer Huilé*) avec sérigraphie du plateau.
  - Plateau alu avec points stroboscopiques, couvre-plateau en feutrine imprimée, vinyle 12" avec bandes de sillons proportionnelles aux durées des pistes, macaron central.
  - Bras en S (`TubeGeometry` sur `CatmullRomCurve3`), cardan, contrepoids gradué, porte-cellule avec broches colorées et pointe diamant qui suit le rayon réel du sillon pendant la lecture.
  - Capot antipoussière en acrylique fumé ouvert par le bas (`EdgesGeometry` + poignée chromée + charnières).
  - Boutons physiques cliquables (`START · STOP`, `33`, `45`, `POWER`, lampe cible) avec enfoncement animé, et **fader linéaire `VOLUME · GAIN 0–100%`** glissable en 3D.
- **Bac à vinyles 3D en chêne** :
  - 20 pochettes 3D feuilletables à la molette ou au clavier (`←` / `→`), plaque laiton cliquable pour changer le tri.
  - Présence physique exclusive : l'album posé sur la platine/chevalet est retiré du bac.
  - Sortie / rangement physique des pochettes en mode inspection (`INSPECT`), retournement Recto/Verso avec rétraction du disque.
- **Free Cam complète** : `OrbitControls` (orbite clic gauche, pan clic droit, zoom molette) + déplacement clavier `ZQSD`/`WASD` + `E`/`C`, et 5 angles rapides (`Salon`, `Platine`, `Bac`, `Pochette`, `Free Cam`).
- **Écran YouTube `CSS3DObject`** fixé sur la façade avant du châssis de la platine, avec masquage automatique lorsqu'on regarde l'arrière (`backfaceVisibility: hidden` + dot-product caméra).
- **Audio & Foley (`src/audio/vinylFoley.ts`, `src/components/HybridPlaybackDeck.tsx`)** :
  - Bruitages Web Audio distincts par interaction + grain vinyle analogique continu (`Grain LP`).
  - Synchronisation bidirectionnelle `window.YT.Player` ↔ slider inférieur ↔ bras 3D, enchaînement automatique des pistes et des faces.

---

## 3. Les 11 Onglets Analytiques (`src/views/pages/`)

Toutes les routes ont été réalignées sur les vrais endpoints du backend FastAPI (`src/api/client.ts` + `src/hooks/useApi.ts` avec cache mémoire `keepPreviousData`) :
- `OverviewPage.tsx` (`/api/analytics/overview`)
- `TopsPage.tsx` (`/api/analytics/tops/{artists,albums,tracks,genres}`)
- `ChronoPage.tsx` (`/api/analytics/chronobiology`) — bug React Hook #310 corrigé
- `PersonaPage.tsx` (`/api/analytics/persona`)
- `BehaviorPage.tsx` (`/api/analytics/behavior`)
- `SciencePage.tsx` (`/api/v3/analytics/science`, `eras`, `camelot`)
- `AtlasPage.tsx` (`/api/v3/analytics/atlas`)
- `GalaxyPage.tsx` (`/api/analytics/galaxy`, rendu à la demande sur Canvas 2D)
- `SearchPage.tsx` (`/api/v3/search`, FTS5 `unicode61`)
- `WrappedPage.tsx` (`/api/analytics/wrapped`)
- `HubPage.tsx` (`/api/v4/import`, `/api/v4/profiles`, `/api/v4/tracking/setup`)

---

## 4. Tests Validés

- `npm run build` (`tsc -b && vite build`) : passe sans erreur.
- Suite E2E Playwright (`frontend-v4/e2e/v4.spec.ts`) : validée sur Desktop `1440×900` (zéro erreur console, zéro HTTP ≥ 400, les 12 onglets s'affichent).
