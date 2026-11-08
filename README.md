# Façade solaire — Tracés

Analyse rapide des enjeux solaires et thermiques des façades d'un bâtiment existant ou projeté,
pour la phase offre : en une dizaine de minutes, une lecture argumentée de l'exposition de chaque
façade, des masques, des apports et des ordres de grandeur des besoins.

> **Ce n'est ni une simulation thermique dynamique (STD) ni un calcul réglementaire.**
> Les résultats sont des ordres de grandeur pour cadrer les enjeux. Ils ne remplacent ni une
> étude thermique, ni une étude d'éclairement, ni un calcul RE2020 / RT existant.

**En ligne : https://griso-engineer.github.io/facade-solaire/**

## Avancement

| Étape | Contenu | État |
|---|---|---|
| 1 | Carte, emprise (OSM ou dessin), voisins, façades numérotées, maquette 3D et course du soleil | fait |
| 2 | Climat horaire (Open-Meteo ERA5, secours Paris intégré), rayonnement sur façades (Perez) | fait |
| 3 | Masques des voisins (horizon par point de façade) | fait |
| 4 | Bilan thermique mensuel (ISO 13790 / 52016-1) et variantes de vitrage | fait |
| 5 | Lumière naturelle : VSC et facteur de lumière du jour moyen (BRE) | fait |
| 6 | Fiche offre A4 paysage | fait |

## Utilisation en 10 minutes

1. **Site** : chercher l'adresse, cliquer sur le bâtiment (ou dessiner l'emprise). Vérifier la hauteur,
   la fraction vitrée, et corriger les voisins en orange (hauteur supposée) qui comptent.
2. **Maquette 3D** : contrôler le volume et les façades ; choisir la vue, la date et l'heure qui serviront
   à la fiche.
3. **Exposition** : lire l'irradiation par façade, l'effet des masques et le diagramme de masque.
4. **Thermique** : choisir 2 à 4 vitrages, la variante de référence et, si besoin, une protection solaire.
5. **Lumière** : repérer les façades au VSC faible.
6. **Fiche offre** : relire les messages clés, puis « Imprimer / enregistrer en PDF » (paysage, sans
   marges, graphiques d'arrière-plan activés).

Le projet s'enregistre dans le navigateur ; « Exporter » / « Importer » l'échangent en JSON. Un lien
`…/facade-solaire/?lat=48.8358&lon=2.3745&r=150&nom=Mon%20projet` ouvre directement un bâtiment.

## Fiche offre

- **Page 1** : vue 3D colorée, carte avec façades numérotées, 3 à 5 messages clés, synthèse par façade
  (irradiation, masques, part des apports d'été, pic, VSC, besoins de la variante de référence),
  hypothèses principales, avertissement.
- **Page 2** : variantes de vitrage (tableau et graphique), rose des orientations, lumière naturelle,
  méthode résumée.
- **Messages clés** : règles chiffrées, chacune avec un score ; on garde les 3 à 5 plus importantes
  (concentration des apports d'été, effet d'une protection mobile, risque d'inconfort, masques,
  arbitrage entre vitrages, lumière contrainte, apports d'hiver). À relire avant envoi.
- Vérifiée en PDF (Edge) : deux pages A4 paysage de 297 × 210 mm, sans débordement.

## Lancer en local

Scripts classiques, sans étape de build : `index.html` s'ouvre par double-clic.

En `file://`, le navigateur n'envoie pas d'en-tête Referer : le fond de carte OpenStreetMap et la
recherche d'adresse (Nominatim) peuvent alors être refusés. Overpass (bâtiments) fonctionne. Pour
un usage complet en local, sous Windows, sans rien installer :

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

puis ouvrir http://localhost:8080/.

`tests.html` regroupe les tests de validation (position du soleil, découpage en façades, puis au
fil des étapes : irradiation contre PVGIS, bilan thermique contre un calcul à la main).

## Bibliothèques (CDN, versions figées)

- [Leaflet](https://leafletjs.com/) 1.9.4 — cdnjs
- [three.js](https://threejs.org/) r147 (0.147.0) et `OrbitControls` — jsDelivr. C'est la dernière
  version qui fournit encore `OrbitControls` en script classique (sans module ES) ; cdnjs ne propose
  pas cette version.
- Police Inter — Google Fonts

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Interface, onglets |
| `tests.html` | Tests de validation |
| `css/style.css` | Identité Tracés, thèmes clair et sombre, impression |
| `js/util.js` | Espace de noms `FS`, DOM/SVG, formatage, stockage local, géométrie plane (projection locale) |
| `js/solar.js` | Position du soleil (NOAA), heure légale (fuseau IANA), lever et coucher |
| `js/osm.js` | Nominatim (adresse), Overpass (bâtiments), lecture des hauteurs |
| `js/building.js` | Emprise → façades numérotées, détection des mitoyens et des héberges |
| `js/project.js` | État du projet, valeurs par défaut, grandeurs dérivées, import / export JSON |
| `js/map.js` | Carte Leaflet : sélection, dessin d'emprise, voisins, numéros de façades |
| `js/scene3d.js` | Maquette three.js : extrusions, ombres portées, course du soleil, étiquettes |
| `js/climate.js` | Open-Meteo (ERA5 2015–2024), année type, cache |
| `js/climate-paris.js` | Climat de secours : année type de Paris, générée par `tools/build-climate.html` |
| `js/irradiance.js` | Rayonnement sur plan vertical : décomposition d'Erbs, Perez 1990 ou isotrope, réfléchi |
| `js/masks.js` | Grille de points par façade, profils d'horizon, ciel vu |
| `js/results.js` | Indicateurs par façade, avec ou sans masques : annuel, mensuel, hiver / été, pic, apports vitrés |
| `js/charts.js` | Échelle de couleurs, rose des orientations, barres mensuelles (SVG) |
| `js/ui-results.js` | Onglet Exposition, coloration de la maquette 3D |
| `js/thermal.js` | Bilan mensuel quasi-stationnaire (ISO 13790), protections solaires, préréglages de vitrage |
| `js/ui-thermal.js` | Onglet Thermique : hypothèses, variantes, comparaison |
| `js/daylight.js` | VSC (BRE) et facteur de lumière du jour moyen (formule BRE simplifiée) |
| `js/ui-daylight.js` | Onglet Lumière |
| `js/messages.js` | Messages clés générés à partir des résultats |
| `js/ui-report.js` | Fiche offre : deux pages A4 paysage, impression PDF |
| `js/app.js` | Interface, onglets, enchaînement |
| `tools/build-climate.html` | Régénère `js/climate-paris.js` (voir ci-dessous) |

## Hypothèses et limites : géométrie et soleil

- **Emprises** : OpenStreetMap (souvent issues du cadastre en France). Pour un multipolygone, seul
  l'anneau extérieur principal est pris : les cours intérieures d'un même objet OSM ne sont pas
  encore traitées. À Paris, les cours sont en général des vides entre bâtiments distincts, et sont
  donc bien représentées.
- **Hauteurs** : tag `height`, sinon `building:levels` × 3 m (+ ½ niveau par niveau de comble),
  sinon 15 m. Les deux dernières sont des hypothèses, signalées en orange et modifiables
  (globalement ou voisin par voisin, en cliquant sur la carte).
- **Volumes** : prismes à toiture plate ; pas de toitures en pente, de saillies, de balcons, de végétation.
- **Façades** : chaque côté est découpé en tronçons ; un tronçon est mitoyen si un voisin le touche
  (à moins de 0,6 m, sur la normale extérieure), et la limite du mitoyen est localisée par dichotomie
  au centimètre. Seule la partie au-dessus du voisin (héberge) reste exposée, supposée aveugle par
  défaut. Les tronçons alignés à ± 10° forment une façade ; les retours de moins de 3 m sont
  rattachés à la façade voisine (chaque segment garde sa propre orientation pour les calculs).
- **Numérotation** : sens horaire, à partir de la façade la plus proche du nord. Azimut de la normale
  extérieure : 0° nord, 90° est, 180° sud, 270° ouest.
- **Soleil** : algorithme du NOAA, réfraction de Bennett, heure légale Europe/Paris. Vérifié contre
  l'exemple de référence du SPA du NREL (écart < 0,01°) et les éphémérides de Paris (± 1 min).

## Hypothèses et limites : climat et rayonnement

- **Climat** : réanalyse ERA5 (maille 0,25°) 2015–2024, via l'API Open-Meteo (CORS, sans clé).
  Les valeurs horaires sont des moyennes sur l'heure écoulée ; le soleil est pris au milieu de l'heure.
- **Année type** : pour chaque mois, le mois réel le plus représentatif des dix ans (statistique de
  Finkelstein-Schafer sur rayonnement et températures journaliers, puis cumul de rayonnement le plus
  proche de la moyenne parmi les quatre meilleurs, comme dans l'ISO 15927-4). À Paris, l'année type
  est à 0,5 % de la moyenne décennale. Ce n'est pas une année caniculaire.
- **Partage direct / diffus** : recalculé par le modèle d'Erbs (1982) à partir du global ERA5. Le
  diffus brut d'ERA5 (option) est nettement plus faible (39 % du global à Paris contre 52 %) et
  surestime les façades est et ouest de 8 à 12 % par rapport à PVGIS.
- **Plan vertical** : direct + diffus de Perez (1990, option isotrope) + réfléchi par le sol
  (albédo 0,2 réglable). Pas de réflexion par les façades voisines.
- **Validation contre PVGIS 5.3** (SARAH3, 2005–2023, Paris, 90°, sans horizon) :

  | Façade | Façade solaire | PVGIS | Écart |
  |---|---|---|---|
  | Sud | 977 kWh/m²·an | 1 016 | −3,9 % |
  | Est | 753 | 743 | +1,3 % |
  | Ouest | 704 | 722 | −2,5 % |
  | Nord | 388 | 310 | +25 % (diffus seul : modèles de ciel différents, Muneer dans PVGIS) |

  En hiver, les écarts mensuels au sud atteignent −20 à −25 % (ERA5 voit moins de journées claires
  d'hiver que le satellite) ; ils restent sous 11 % de mars à octobre.
- **Masques** : voir ci-dessous.

### Régénérer le climat de secours

`js/climate-paris.js` est produit par `tools/build-climate.html`, avec le même code que l'application.
Serveur local lancé, puis :

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --virtual-time-budget=60000 --dump-dom http://localhost:8080/tools/build-climate.html > build.html
```

et copier le contenu du bloc `<pre id="out">` dans `js/climate-paris.js`.

## Hypothèses et limites : masques

- **Grille** : un point de calcul par maille d'environ 2 m × 3 m (un par étage) sur chaque segment de
  façade, au plus environ 4 000 points ; la maquette 3D est colorée maille par maille.
- **Horizon** : pour chaque point et chaque degré d'azimut devant le mur, élévation du plus haut
  obstacle, atan((h − z)/d), d'après les arêtes des volumes voisins et du bâtiment étudié (auto-masque des
  angles rentrants et des cours). Exact au degré près pour des prismes à toit plat.
- **Effet sur le rayonnement** : direct et circumsolaire seulement si le soleil dépasse l'horizon du
  point ; diffus isotrope × ciel vu (facteur de vue intégré sur le profil, rapporté au mur dégagé) ;
  bande d'horizon de Perez × part des directions dégagées sous 6° ; réfléchi par le sol conservé.
- **Non pris en compte** : arbres, relief lointain, balcons et débords, réflexions des façades
  voisines, ombre portée sur le sol vu par la façade.
- **Validation** : élévation devant un vis-à-vis infini à ± 0,05° ; ciel vu face à une obstruction
  infinie d'angle β égal à 1 − sin β (solution analytique) à ± 0,01 ; auto-masque d'un bâtiment en L ;
  300 voisins en environ 0,2 s. Sur un bloc réel du 13e (24 m de haut, 968 points, 75 voisins dans
  300 m) : horizons en 0,16 s, calcul horaire complet en 0,3 s.

## Hypothèses et limites : bilan thermique

> Ordres de grandeur pour comparer des variantes et hiérarchiser les façades. Pas de systèmes, de ponts
> thermiques, de planchers ni de toiture, pas de scénarios d'occupation.

- **Zone de façade** : bande de plancher de 5 m (réglable) derrière chaque façade, sur toute sa hauteur.
- **Méthode** : mensuelle quasi-stationnaire, NF EN ISO 13790 (reprise par l'EN ISO 52016-1),
  facteurs d'utilisation des apports (chauffage) et des pertes (froid), a = 1 + τ/15 h, τ = C_m/H.
- **Déperditions** : U_w des baies, U_p des parois opaques (0,3 W/m²·K par défaut), renouvellement d'air
  0,5 vol/h sans récupération (hygiène et infiltrations), réglable de 0 à 5 vol/h. Sans
  renouvellement d'air, le froid serait surestimé de 40 à 90 % et le chauffage presque nul (test sur un bloc du 13e).
- **Inertie** : κ_m = 110 / 165 / 260 kJ/(m²·K) de plancher (ISO 13790, tableau 12).
- **Températures** : moyennes mensuelles de l'année type ; consignes de 20 °C et 26 °C.
- **Apports solaires** : irradiation horaire masquée × baie × (1 − menuiserie, 25 %) × F_w (0,9) × g ;
  parois opaques α·R_se·U_p·A·I ; apports internes de 5 W/m² de plancher.
- **Protection solaire mobile** : fermée quand l'irradiation dépasse 300 W/m² ; g → F_c·g ou g total.
- **Variantes** : 2 à 4, à partir de préréglages modifiables :

  | Préréglage | U_w | g | TL |
  |---|---|---|---|
  | Double vitrage ancien | 2,9 | 0,75 | 0,80 |
  | Double faible émissivité | 1,4 | 0,60 | 0,78 |
  | Double contrôle solaire | 1,3 | 0,35 | 0,65 |
  | Triple faible émissivité | 0,9 | 0,50 | 0,70 |

- **Validation** : un cas simple calculé à la main (façade sud de 30 m², janvier et juillet) est
  retrouvé à 0,1 kWh près, en appelant directement la fonction de bilan comme par la chaîne complète.

## Hypothèses et limites : lumière naturelle

> Ordre de grandeur seulement : ni simulation d'éclairement (NF EN 17037), ni étude de droit au jour.

- **VSC** (BRE 209) : ciel couvert CIE, intégré sur le profil d'horizon de chaque point de façade.
  Mur dégagé 39,6 %. Repères : ≥ 27 % bon, 15–27 % baies à agrandir, 5–15 % difficile, < 5 % très difficile.
- **FLJm** (formule BRE simplifiée, Littlefair ; BS 8206-2) : `TL · A_w · θ · M / (A · (1 − R²))` pour
  une pièce type de 4 m × profondeur de zone × 2,7 m, M = 0,9, R = 0,5 ; θ = 90° moins l'élévation
  moyenne des obstacles pondérée par cos φ (approximation de l'angle de ciel visible).
- **Validation** : VSC d'un mur dégagé 39,6 % ; obstruction infinie de 25° → 27,3 % (règle des 25° du
  BRE : 27 %) ; FLJm contre un calcul à la main.

## Déployer

Site statique : GitHub Pages publie la branche `main`, dossier racine. `.nojekyll` évite le
traitement Jekyll. `serve.ps1` et `tests.html` peuvent rester dans le dépôt.

## Données

- Fond de carte, emprises et hauteurs : © contributeurs OpenStreetMap, licence ODbL.
- Recherche d'adresse : Nominatim (OSM Foundation), usage modéré.
- Climat : réanalyse ERA5 (Copernicus Climate Change Service), servie par Open-Meteo, CC BY 4.0.
- Références de validation : PVGIS (Centre commun de recherche de la Commission européenne).
