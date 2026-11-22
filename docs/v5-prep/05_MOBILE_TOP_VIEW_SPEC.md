# AMDataWrap V5 — Spécification Mobile Top-View Simplifiée (`< 768 px`)

> **Statut** : Spécification d'architecture V5 (ne pas coder la Top-View mobile en V4.5).

## 1. Constat & Objectif Performance Mobile
Sur smartphone (`viewport < 768 px`), la scène 3D complète de la pièce (`RoomRig` + `VinylCrateRig` + `TurntableRig` avec ombres dynamiques et CSS3D) sollicite inutilement le GPU mobile et la batterie.
La **Mobile Top-View V5** remplace la scène 3D complète par une **vue zénithale (Top-Down) 2D/2.5D ultra-légère** centrée sur le plateau du vinyle.

### Budgets Cibles Mobile (`< 768 px`)
- **RAM JS/DOM** : ≤ 60 Mo (zéro géométrie 3D de pièce ni textures PBR lourdes chargées).
- **GPU / Batterie** : 0 Hz à l'arrêt (`rafActive === false`) ; rotation du disque en CSS `transform: rotate(...)` ou Canvas 2D 30 fps uniquement pendant la lecture active.
- **Draw calls WebGL** : 0 (ou <= 4 si micro-shader optionnel désactivable).

## 2. Ergonomie & Gestes Tactiles
1. **Vue Zénithale du Plateau** :
   - Disque vinyle centré occupant ~72 % de la largeur écran, pochette circulaire au macaron central, bras de lecture articulé sur le côté droit.
   - **Gestes** :
     - *Tap* sur le disque : Play / Pause.
     - *Drag angulaire* sur le bras ou *scrub* circulaire : avance/recule dans le morceau.
     - *Swipe gauche / droite* : piste précédente / suivante.
     - *Swipe vers le haut* : ouvre le **Bottom Sheet** (File d'attente / Paroles synchronisées LRCLIB).
2. **Navigation Mobile Responsive** :
   - Remplacement de la barre de 12 onglets horizontale par une **Bottom Navigation Bar** à 4 entrées principales (*Platine*, *Synthèse*, *Classements*, *Explorer*) + menu *Plus* pour les vues analytiques avancées (Science, Atlas, Constellation, Wrapped, Archives).
   - **Drawers & Filtres** : `DetailDrawer` et `FilterDrawer` deviennent des **Bottom Sheets** (`max-h-[85vh]`, poignée de glissement en haut) respectant la zone de sécurité iOS (`env(safe-area-inset-bottom)`).
3. **Thème unique conservé** : même palette sombre *Salon d'écoute / Liner Notes* (`#0b0b10`, ambre `#f59e0b`, typographie serif + mono).
