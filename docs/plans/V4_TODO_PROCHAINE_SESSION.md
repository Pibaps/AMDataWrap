# AMDataWrap V4 — Travail à Faire (Prochaine Session)

> **Important pour la prochaine session :** Commencer par exécuter **`/grill-me`** avec l'utilisateur pour trancher les choix de design, d'UX et d'intégration avant de coder.

---

## 1. Tourne-disque & Interactions 3D (`Salon 3D`)

1. **Navigation piste suivante / précédente & retournement du disque avec vraies données :**
   - Pouvoir passer facilement d'un morceau à l'autre directement sur le tourne-disque (geste/contrôle intuitif en 3D).
   - Pouvoir retourner physiquement le disque sur le plateau pour accéder aux pistes de la **Face B / C / D**, en affichant et jouant les **vraies métadonnées et durées des pistes** de chaque face (vérifier le mapping backend `/api/v4/vinyl/{album_key}` et le macaron/sillons).
2. **Verrouillage physique sous le capot en verre fermé :**
   - Lorsque le capot en acrylique est **fermé** (`lidOpen === false`), il doit être **impossible d'accéder ou de cliquer sur les éléments situés sous le capot** (vinyle, bras de lecture, macaron, boutons internes sous capot) — comportement physique réaliste.
3. **Résolution des pochettes de vinyles :**
   - Améliorer nettement la netteté et la résolution des pochettes 3D (actuellement `256px` en WebP sur le bac et le chevalet, ce qui paraît flou en gros plan ou en inspection). Trouver le bon compromis netteté / VRAM (ex. `512px` ou `600px–1024px` uniquement pour la pochette inspectée + celle sur le chevalet, et `384px` avec `ImageBitmap` côté bac).

---

## 2. Intégration Lecture Audio (Apple Music & Alternatives à YouTube Music)

- Rendre **visible et compréhensible** l'intégration permettant d'écouter via **Apple Music** (ou d'autres plateformes que YouTube Music : MusicKit / Apple Music App / Extension MV3 bridge / Windows SMTC / Spotify / Deezer).
- Revoir l'architecture existante (`docs/feasibility/FEASIBILITY_APPLE_MUSIC_PLAYER.md`, `extensions/amdatawrap-bridge`, `backend/app/playback.py`) et décider via `/grill-me` comment exposer clairement ce choix de source d'écoute dans l'interface sans noyer l'utilisateur.

---

## 3. Simplification Grand Public & Pédagogie des Onglets Analytiques

1. **Refonte & simplification radicale de l'onglet « Archives » (`HubPage.tsx`) :**
   - Aujourd'hui beaucoup trop technique (jargon *ISRC ±180s*, *Extension MV3*, *Matrice de capacités*, *End Reasons*, *Webhooks*, *LAN QR* empilés).
   - Le rendre **accessible et limpide pour n'importe quel utilisateur** : parcours guidé simple (« Importer mes écoutes Apple Music », « Connecter mon écoute en direct »), termes clairs, options avancées repliées ou masquées.
2. **Expliquer les termes obscurs et boîtes techniques dans les pages de données :**
   - Vulgariser et ajouter des explications courtes et claires sur les intitulés incompréhensibles pour un non-initié (ex. dans **Science** : *Nombre d'Eddington*, *Indice de Gini*, *Courbe de Lorenz*, *Entropie de Shannon / bits / perplexité*, *Demi-vie*, *Transitions de Markov*, *PELT*, *Roue de Camelot* ; dans **Habitudes** : *Lift ×*, *Télémétrie du lecteur / Causes de fin de piste* ; dans **Portrait** : *Âge de cristallisation*, etc.).
3. **Réparer les boutons qui ne fonctionnent pas dans les onglets :**
   - Auditer et tester **chaque bouton d'action** dans les 11 onglets analytiques (notamment les boutons `Play` pour lire un titre depuis `OverviewPage`, `TopsPage`, `BehaviorPage`, `GalaxyPage`, `SearchPage`, `WrappedPage`, les actions de filtres, etc.) et vérifier qu'ils déclenchent bien la lecture effective (audio + affichage) et les transitions attendues.

---

## 4. Optimisation Extrême RAM / GPU (En attente du Gemini Deep Research)

- **Statut :** En attente des résultats du rapport **Gemini Deep Research** généré à partir du prompt rangé dans :
  `docs/prompts/GEMINI_DEEP_RESEARCH_OPTIMISATION_V4.md`
- **Objectif cible :**
  - Empreinte RAM navigateur **≤ 200 Mo** (au lieu de monter vers 1–2 Go).
  - Temps de chargement initial quasi instantané, zéro saccade, consommation GPU proche de 0 % au repos.
- **Pistes à intégrer dès réception du Deep Research :**
  - `ImageBitmap` + `imageBitmap.close()` après upload VRAM (libération de la RAM CPU des `CanvasTexture`).
  - `InstancedMesh` / `BatchedMesh` + Texture Atlas unique pour les pochettes du bac.
  - ShadowMap gelée (`autoUpdate = false`) et PMREM / shaders optimisés.
  - Lazy mount / unmount propre de l'iframe YouTube + `CSS3DRenderer` rendu uniquement quand la caméra bouge.
  - Pool Web Audio API réutilisable + optimisation mémoire backend DuckDB/Pillow + cache HTTP `Cache-Control: immutable` sur `/api/artwork-proxy`.
