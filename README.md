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
| 3 | Masques des voisins (horizon par point de façade) | à venir |
| 4 | Bilan thermique mensuel (ISO 13790 / 52016-1) et variantes de vitrage | à venir |
| 5 | Lumière naturelle : VSC et facteur de lumière du jour moyen (BRE) | à venir |
| 6 | Fiche offre A4 paysage | à venir |

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
| `js/results.js` | Indicateurs par façade : annuel, mensuel, hiver / été, pic, apports vitrés |
| `js/charts.js` | Échelle de couleurs, rose des orientations, barres mensuelles (SVG) |
| `js/ui-results.js` | Onglet Exposition, coloration de la maquette 3D |
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
- **Masques** : pas encore pris en compte à l'étape 2 (étape 3).

### Régénérer le climat de secours

`js/climate-paris.js` est produit par `tools/build-climate.html`, avec le même code que l'application.
Serveur local lancé, puis :

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --virtual-time-budget=60000 --dump-dom http://localhost:8080/tools/build-climate.html > build.html
```

et copier le contenu du bloc `<pre id="out">` dans `js/climate-paris.js`.

## Déployer

Site statique : GitHub Pages publie la branche `main`, dossier racine. `.nojekyll` évite le
traitement Jekyll. `serve.ps1` et `tests.html` peuvent rester dans le dépôt.

## Données

- Fond de carte, emprises et hauteurs : © contributeurs OpenStreetMap, licence ODbL.
- Recherche d'adresse : Nominatim (OSM Foundation), usage modéré.
- Climat : réanalyse ERA5 (Copernicus Climate Change Service), servie par Open-Meteo, CC BY 4.0.
- Références de validation : PVGIS (Centre commun de recherche de la Commission européenne).
