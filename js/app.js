/* Interface : onglets, panneaux de saisie, tableau des façades, enchaînement. */
(function (FS) {
  'use strict';
  const el = FS.el;
  const pages = {};
  let ui = {};

  // ---------- Thème ----------
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: 'auto', light: 'clair', dark: 'sombre' };
  function applyTheme(t) {
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    FS.$('#btn-theme').textContent = 'Thème : ' + THEME_LABEL[t];
    FS.store.set('theme', t);
  }
  function cycleTheme() {
    const t = FS.store.get('theme', 'auto');
    applyTheme(THEMES[(THEMES.indexOf(t) + 1) % 3]);
    FS.map.render(); FS.scene3d.build();
  }

  // ---------- Mise à jour générale ----------
  function update(kind) {
    FS.project.invalidate();
    FS.project.save();
    FS.map.render();
    FS.uiSite.refresh();
    refresh3dSide();
    if (kind !== 'view' && kind !== 'mode' && kind !== 'thermal') FS.scene3d.build();
    if (kind === 'target') FS.scene3d.frame();
    if (FS.uiResults) { FS.uiResults.refresh(); if (kind === 'target' || kind === 'geom') FS.uiResults.ensureClimate(); }
  }

  // ---------- Onglet 3D ----------
  function build3d() {
    const P = FS.project.get();
    const page = el('section', { class: 'page', id: 'page-3d', hidden: true });
    page.append(FS.blockHead('03', 'Maquette 3D',
      'Bâtiment étudié en couleur, voisins en gris (teinte orangée : hauteur supposée). Réglez la date et l\'heure pour voir les ombres portées.'));
    const sceneBox = el('div', { id: 'scene' });
    const viewport = el('div', { class: 'viewport' }, sceneBox);

    const doy = el('input', { type: 'range', min: 1, max: 365, step: 1, value: P.view.doy });
    const hour = el('input', { type: 'range', min: 0, max: 24, step: 0.25, value: P.view.hour });
    ui.doyLabel = el('b'); ui.hourLabel = el('b');
    ui.doy = doy; ui.hour = hour;
    const onView = () => { P.view.doy = +doy.value; P.view.hour = +hour.value; FS.project.save(); FS.scene3d.updateSun(); refresh3dSide(); };
    doy.addEventListener('input', onView); hour.addEventListener('input', onView);
    const quick = el('div', { class: 'chips' });
    for (const [lab, m, d] of [['21 déc.', 12, 21], ['21 mars', 3, 21], ['21 juin', 6, 21], ['21 sept.', 9, 21], ['15 juil.', 7, 15]]) {
      quick.append(el('button', { class: 'chip', onclick: () => { doy.value = FS.solar.doyOf(2026, m, d); onView(); } }, lab));
    }
    let anim = 0;
    const play = el('button', {
      class: 'btn sm', onclick: () => {
        if (anim) { cancelAnimationFrame(anim); anim = 0; play.textContent = 'Animer la journée'; return; }
        play.textContent = 'Arrêter';
        const step = () => { let h = +hour.value + 0.05; if (h > 22) h = 4; hour.value = h; onView(); anim = requestAnimationFrame(step); };
        anim = requestAnimationFrame(step);
      }
    }, 'Animer la journée');

    ui.fac3d = el('div', { class: 'tbl-wrap' });
    const side = el('aside', { class: 'side' },
      el('div', { class: 'panel' }, el('h3', {}, 'Date et heure'),
        el('div', { class: 'time-row' }, el('span', {}, 'Date'), doy, ui.doyLabel),
        el('div', { class: 'time-row' }, el('span', {}, 'Heure légale'), hour, ui.hourLabel),
        quick, el('div', { class: 'row-actions', style: { marginTop: 0 } }, play,
          el('button', { class: 'btn sm ghost', onclick: () => FS.scene3d.frame() }, 'Recadrer'))),
      el('div', { class: 'panel' }, el('h3', {}, 'Façades'), ui.fac3d,
        el('small', {}, 'Cliquez une façade (ou une ligne) pour la sélectionner.')));
    page.append(el('div', { class: 'work' }, viewport, side));
    pages['3d'] = page;
    FS.$('#app').append(page);
    FS.uiResults.attach3d(viewport, side);
    FS.scene3d.init(sceneBox, { onPick: (id) => { FS.scene3d.select(id); FS.uiResults.select(id); refresh3dSide(id); FS.uiResults.refresh(); } });
    FS.scene3d.build();
    FS.scene3d.frame();
  }

  let sel3d = null;
  function refresh3dSide(selId) {
    if (!ui.fac3d) return;
    if (selId !== undefined) sel3d = selId;
    const P = FS.project.get(), D = FS.project.derived();
    const date = FS.solar.dateOfDoy(2026, P.view.doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    ui.doyLabel.textContent = date; ui.hourLabel.textContent = FS.solar.fmtHour(P.view.hour);
    if (document.activeElement !== ui.doy) ui.doy.value = P.view.doy;
    if (document.activeElement !== ui.hour) ui.hour.value = P.view.hour;
    ui.fac3d.innerHTML = '';
    if (!D.ok) { ui.fac3d.append(el('p', { class: 'muted' }, 'Sélectionnez un bâtiment dans l\'onglet Site.')); return; }
    const tb = el('tbody');
    for (const f of D.model.facades) {
      const tr = el('tr', { class: f.id === sel3d ? 'sel' : '', style: { cursor: 'pointer' }, onclick: () => { FS.scene3d.select(f.id); refresh3dSide(f.id); } },
        el('td', {}, el('b', {}, f.id)), el('td', {}, f.label), el('td', { class: 'num' }, Math.round(f.az) + '°'),
        el('td', { class: 'num' }, FS.fmt(f.area, 0) + ' m²'), el('td', { class: 'num' }, FS.pct(f.wwr)));
      tb.append(tr);
    }
    ui.fac3d.append(el('table', { class: 'tbl' }, el('thead', {}, el('tr', {},
      el('th', {}, 'N°'), el('th', {}, 'Or.'), el('th', { class: 'num' }, 'Azimut'), el('th', { class: 'num' }, 'Surface'), el('th', { class: 'num' }, 'Vitré'))), tb));
  }

  // ---------- Onglets à venir ----------
  function buildSoon(route, num, title, text, step) {
    const page = el('section', { class: 'page', id: 'page-' + route, hidden: true },
      FS.blockHead(num, title, text),
      el('p', { class: 'note' }, 'Prévu à l\'étape ' + step + ' du développement.'));
    pages[route] = page;
    FS.$('#app').append(page);
  }

  // ---------- Méthode ----------
  function buildMethod() {
    const page = el('section', { class: 'page', id: 'page-methode', hidden: true });
    page.append(FS.blockHead('—', 'Méthode', 'Hypothèses, modèles et limites. Cet outil donne des ordres de grandeur pour la phase offre.'));
    page.append(el('div', { class: 'prose', html: METHOD_HTML }));
    pages.methode = page;
    FS.$('#app').append(page);
  }

  const METHOD_HTML = `
    <p class="note warn"><b>Ce n'est ni une simulation thermique dynamique (STD) ni un calcul réglementaire.</b>
    Les résultats sont des ordres de grandeur destinés à cadrer les enjeux d'une façade en phase offre.
    Ils ne remplacent ni une étude thermique, ni une étude d'éclairement, ni un calcul RE2020 ou RT existant.</p>
    <h3>Géométrie</h3>
    <ul>
      <li><b>Emprises</b> : en France, BD TOPO de l'IGN (service WFS de la Géoplateforme), c'est-à-dire l'emprise
        cadastrale recalée de chaque bâtiment, cours intérieures comprises ; ailleurs, ou si l'IGN ne répond pas,
        OpenStreetMap (Overpass). Tous les bâtiments de la vue sont dessinés en contour de couleur et cliquables.
        L'emprise peut aussi être dessinée à la main, avec une ou plusieurs cours intérieures.</li>
      <li><b>Hauteurs</b> : BD TOPO (attribut « hauteur », mesuré ; sinon altitude du toit moins altitude du sol ;
        sinon nombre d'étages × 3 m), ou OSM (<code>height</code>, sinon <code>building:levels</code> × 3 m) ; sans donnée,
        15 m. Les hauteurs supposées sont signalées en orange et modifiables, globalement ou bâtiment par bâtiment.
        À Paris, plus de 90 % des bâtiments de la BD TOPO ont une hauteur mesurée.</li>
      <li><b>Voisins</b> : soit lus automatiquement dans un rayon (150 m par défaut), complétés si besoin de bâtiments
        ajoutés d'un clic ou dessinés ; soit uniquement dessinés à la main, chacun avec sa hauteur.</li>
      <li><b>Cours</b> : leurs murs sont des façades (numérotées après celles du contour, normale vers la cour) et
        des obstacles pour les autres murs de la cour.</li>
      <li><b>Fenêtres</b> dessinées en 3D : théoriques, au rythme parisien (une travée tous les 2,7 m environ,
        portes-fenêtres plus hautes que larges, une rangée par étage), de surface égale à la fraction vitrée de
        chaque façade. Elles illustrent l'hypothèse ; les calculs utilisent la fraction vitrée, pas ce dessin.</li>
      <li>Les bâtiments sont des prismes à toiture plate : pas de toitures en pente, de saillies, de balcons
        ni de végétation.</li>
      <li>Projection locale équirectangulaire autour du bâtiment (x vers l'est, y vers le nord), précise au
        centimètre à l'échelle d'un îlot.</li>
    </ul>
    <h3>Façades</h3>
    <ul>
      <li>Chaque côté de l'emprise est découpé en tronçons d'environ 1 m. Un tronçon est mitoyen lorsqu'un
        voisin touche le mur (à moins de 0,6 m sur la normale extérieure) ; la limite est ensuite localisée
        au centimètre. Seule la partie au-dessus du voisin (héberge) reste exposée, supposée aveugle par défaut ;
        un mur couvert sur toute sa hauteur n'est pas une façade.</li>
      <li>Les tronçons consécutifs orientés à ± 10° près forment une façade ; les retours de moins de 3 m sont
        rattachés à la façade voisine, mais chaque segment garde sa propre orientation pour les calculs.
        L'orientation affichée est la moyenne des segments principaux, pondérée par la longueur.</li>
      <li>Un voisin recouvert en majorité par l'emprise étudiée est écarté (cas d'un projet qui remplace
        l'existant) ; un voisin peut aussi être retiré à la main depuis la carte.</li>
      <li>Numérotation dans le sens horaire, à partir de la façade la plus proche du nord. Azimut de la
        normale extérieure : 0° nord, 90° est, 180° sud, 270° ouest.</li>
    </ul>
    <h3>Soleil</h3>
    <ul>
      <li>Position du soleil par l'algorithme du NOAA (formulation de Meeus), réfraction de Bennett.
        Précision de l'ordre de 0,01° entre 1800 et 2100.</li>
      <li>Heures légales du fuseau Europe/Paris (changement d'heure compris).</li>
      <li>Vérifiée contre l'exemple de référence du SPA du NREL (écart &lt; 0,01°) et les éphémérides de Paris (± 1 min).</li>
    </ul>
    <h3>Climat</h3>
    <ul>
      <li>Données horaires de la réanalyse ERA5 (maille de 0,25°, soit environ 28 × 18 km à Paris), 2015 à 2024,
        servies par l'API Open-Meteo : rayonnement global horizontal et température. Mises en cache dans le navigateur.</li>
      <li><b>Année type</b> : pour chaque mois, le mois réel le plus représentatif des dix ans (statistique de
        Finkelstein-Schafer sur les distributions journalières de rayonnement et de température, puis, parmi les quatre
        meilleurs, celui dont le cumul de rayonnement est le plus proche de la moyenne ; démarche de l'ISO 15927-4).
        On garde ainsi la variabilité réelle des journées, qu'une moyenne heure par heure effacerait.
        À Paris, l'année type est à 0,5 % de la moyenne décennale.</li>
      <li>Les jonctions entre mois ne sont pas lissées. Une année type n'est pas une année chaude : les pics
        estivaux d'une canicule peuvent être plus élevés.</li>
      <li>En cas d'indisponibilité d'Open-Meteo, un jeu de secours (année type de Paris, même méthode) est utilisé et
        signalé.</li>
    </ul>
    <h3>Rayonnement sur les façades</h3>
    <ul>
      <li><b>Partage direct / diffus</b> : le diffus est recalculé à partir du global par le modèle d'Erbs, Klein et
        Duffie (1982). Le diffus brut d'ERA5 paraît sous-estimé (39 % du global à Paris, contre 52 % avec Erbs) :
        avec lui, les façades est et ouest dépassent PVGIS de 8 à 12 %, contre 1 à 3 % avec Erbs. Il reste disponible en option.</li>
      <li>Direct normal déduit du global et du diffus, avec la hauteur du soleil au milieu de chaque heure
        (les valeurs horaires sont des moyennes sur l'heure écoulée).</li>
      <li><b>Diffus du ciel</b> : modèle de Perez (1990), qui distingue le ciel uniforme, l'auréole autour du soleil et
        la bande lumineuse de l'horizon. Option : ciel isotrope.</li>
      <li><b>Réfléchi</b> : sol uniforme, albédo 0,2 par défaut (enrobé, pavés ; 0,3 à 0,4 pour un sol clair).</li>
      <li><b>Validation</b> : façades verticales non masquées à Paris, contre PVGIS 5.3 (base satellite SARAH3,
        2005–2023) : sud −4 %, est +1 %, ouest −3 %, nord +25 % (la façade nord ne reçoit que du diffus, où les modèles
        de ciel divergent le plus ; PVGIS utilise le modèle de Muneer). Détail dans <code>tests.html</code>.</li>
    </ul>
    <h3>Masques</h3>
    <ul>
      <li>Chaque segment de façade porte une grille de points de calcul, d'environ 2 m de large sur 3 m de haut
        (un par étage), un peu plus lâche au-delà de 4 000 points. Les couleurs de la maquette 3D suivent cette grille.</li>
      <li>Pour chaque point, on calcule le <b>profil d'horizon</b> : pour chaque degré d'azimut devant le mur, l'élévation
        du plus haut obstacle, atan((h − z)/d), d'après les arêtes des volumes voisins et du bâtiment étudié lui-même
        (angles rentrants, cours). Les volumes étant des prismes à toit plat, ce lancer de rayons est exact au degré près.</li>
      <li>Heure par heure, le <b>direct</b> et le <b>circumsolaire</b> ne comptent que si le soleil est au-dessus de l'horizon
        du point. Le <b>diffus isotrope</b> est multiplié par le ciel vu du point, rapporté à un mur dégagé
        (facteur de vue intégré sur le profil d'horizon). La <b>bande d'horizon</b> de Perez est réduite à la part des
        directions dégagées sous 6°.</li>
      <li>Le <b>réfléchi par le sol</b> est conservé tel quel. On ne compte ni la réflexion des façades voisines (qui
        compense en partie), ni l'ombre portée sur le sol vu par la façade.</li>
      <li>Un point qui tombe dans un volume voisin plus haut (chevauchement d'emprises OSM) est écarté.</li>
      <li>Les arbres, le relief lointain, les balcons et les débords de toiture ne sont pas pris en compte.</li>
      <li><b>Validation</b> : élévation devant un vis-à-vis infini, à ± 0,05°, dans l'axe et de biais ; ciel vu face à une
        obstruction infinie d'angle β égal à 1 − sin β (solution analytique), à ± 0,01 ; auto-masque d'un bâtiment en L ;
        300 voisins traités en environ 0,2 s.</li>
    </ul>
    <h3>Diagramme de masque</h3>
    <p>Pour la façade sélectionnée, le diagramme montre en projection cylindrique la silhouette des obstacles vus d'un point
    (bas, milieu ou haut de la façade) et les courses du soleil des 21 juin, 21 décembre et des équinoxes. Les points pleins
    signalent les heures où le soleil est visible, les points creux celles où il est masqué.</p>
    <h3>Indicateurs</h3>
    <ul>
      <li>Irradiation annuelle, d'hiver (octobre à avril) et d'été (mai à septembre), en kWh/m² de façade : moyenne des
        segments de la façade pondérée par leur surface exposée.</li>
      <li>Pic d'été : irradiance horaire maximale (W/m²) de mai à septembre sur l'année type.</li>
      <li>Soleil direct : nombre d'heures où au moins la moitié de la façade est au soleil, avec un rayonnement direct
        supérieur à 120 W/m² (seuil de l'OMM pour la durée d'insolation).</li>
      <li>Masques : perte d'irradiation annuelle par rapport à la même façade sans aucun obstacle. Ciel vu : facteur de vue
        du ciel moyen de la façade, rapporté à un mur dégagé.</li>
      <li>Apports par les vitrages (onglet Exposition) : irradiation masquée × surface de baie × g de la variante de
        référence, sans protection solaire ni menuiserie ; le pic d'apports est le maximum horaire en été (kW).</li>
      <li>Les échelles de couleur ont des bornes fixes (1 000 kWh/m²·an, 800 W/m²…) pour comparer les projets entre eux.</li>
    </ul>
    <h3>Bilan thermique</h3>
    <p class="note warn">Ordres de grandeur pour comparer des variantes et hiérarchiser les façades. Ni STD, ni calcul réglementaire :
    pas de systèmes, pas de ponts thermiques, pas de planchers ni de toiture, pas de scénarios d'occupation.</p>
    <ul>
      <li><b>Zone de façade</b> : la bande de plancher de profondeur p (5 m par défaut) derrière chaque façade, sur toute sa
        hauteur ; plancher A<sub>f</sub> = surface de façade / hauteur d'étage × p.</li>
      <li><b>Méthode mensuelle quasi-stationnaire</b> (NF EN ISO 13790:2008, reprise par l'EN ISO 52016-1) :
        Q<sub>H</sub> = Q<sub>ht</sub> − η<sub>gn</sub>·Q<sub>gn</sub> et Q<sub>C</sub> = Q<sub>gn</sub> − η<sub>ls</sub>·Q<sub>ht</sub>,
        avec les facteurs d'utilisation η = (1 − γ<sup>a</sup>)/(1 − γ<sup>a+1</sup>) (et la forme symétrique pour le froid),
        a = 1 + τ/15 h, τ = C<sub>m</sub>/H.</li>
      <li><b>Déperditions</b> : U<sub>w</sub> des baies, U<sub>p</sub> des parois opaques, et renouvellement d'air
        (0,5 vol/h par défaut, sans récupération de chaleur : hygiène et infiltrations), H<sub>ve</sub> = 0,34·n·V.
        Sans renouvellement d'air, le froid serait fortement surestimé et le chauffage sous-estimé.</li>
      <li><b>Inertie</b> : C<sub>m</sub> = κ<sub>m</sub>·A<sub>f</sub>, κ<sub>m</sub> = 110, 165 ou 260 kJ/(m²·K)
        (légère, moyenne, lourde ; ISO 13790, tableau 12).</li>
      <li><b>Températures</b> : moyennes mensuelles de l'année type ; consignes de 20 °C (chauffage) et 26 °C (froid).</li>
      <li><b>Apports solaires</b> : irradiation horaire de la façade, masques compris, × surface de baie × (1 − part de
        menuiserie, 25 %) × F<sub>w</sub> (0,9, incidence non normale) × g. Parois opaques : α·R<sub>se</sub>·U<sub>p</sub>·A·I
        (α = 0,6, R<sub>se</sub> = 0,04). Apports internes : 5 W/m² de plancher par défaut.</li>
      <li><b>Protection solaire mobile</b> : fermée heure par heure quand l'irradiation de la façade dépasse 300 W/m²
        (règle de l'ISO 13790) ; g devient F<sub>c</sub>·g, ou le g total saisi.</li>
      <li><b>Pic d'apports</b> : apports solaires vitrés maximaux en été, rapportés au plancher de la zone. Repère
        d'inconfort indicatif : faible &lt; 25 W/m², modéré 25–50, élevé &gt; 50.</li>
      <li><b>Validation</b> : cas simple calculé à la main dans <code>tests.html</code> (façade sud 30 m², janvier et juillet),
        retrouvé à 0,1 kWh près par la fonction de bilan et par la chaîne complète.</li>
    </ul>
    <h3>Lumière naturelle</h3>
    <p class="note warn">Ordre de grandeur seulement : ni simulation d'éclairement (NF EN 17037), ni étude de droit au jour.</p>
    <ul>
      <li><b>VSC</b> (composante de ciel verticale, BRE 209) : part de l'éclairement d'un ciel couvert CIE
        (luminance ∝ (1 + 2 sin α)/3) reçue sur le plan de la façade, rapportée à l'éclairement horizontal d'un site dégagé.
        Calculée en chaque point de façade par intégration sur le profil d'horizon de l'étape 3. Mur dégagé : 39,6 %.
        Repères BRE : ≥ 27 % bon, 15–27 % baies à agrandir, 5–15 % difficile, &lt; 5 % très difficile.</li>
      <li><b>FLJm</b> (facteur de lumière du jour moyen, formule BRE simplifiée de Littlefair, BS 8206-2) :
        FLJm = TL · A<sub>w</sub> · θ · M / (A · (1 − R²)), pour une pièce type de 4 m de large, de la profondeur de la zone de
        façade et de 2,7 m sous plafond ; A<sub>w</sub> = fraction vitrée × largeur × hauteur d'étage × (1 − menuiserie) ;
        θ = 90° moins l'élévation moyenne des obstacles (pondérée par cos) ; M = 0,9 ; R = 0,5.
        Repères : ≥ 2 % pièce bien éclairée, ≥ 5 % très lumineuse ; en logement 1 % chambre, 1,5 % séjour, 2 % cuisine.</li>
      <li><b>Validation</b> : VSC d'un mur dégagé 39,6 % ; derrière une obstruction infinie de 25°, VSC de 27,3 %, cohérent
        avec la règle des 25° du BRE (27 %) ; FLJm d'une pièce type contre un calcul à la main.</li>
    </ul>
    <h3>Fiche offre</h3>
    <ul>
      <li>Deux pages A4 paysage imprimables en PDF par le navigateur : vue 3D (cadrage, date, heure et coloration de
        l'onglet Maquette 3D), carte, messages clés, synthèse par façade, hypothèses ; en annexe, variantes de vitrage,
        rose des orientations, lumière et méthode résumée.</li>
      <li><b>Messages clés</b> : générés par règles à partir des résultats, chacun avec un score d'importance ; on garde les
        3 à 5 premiers. Règles : concentration des apports d'été sur une orientation (≥ 30 %), effet chiffré d'une
        protection extérieure mobile sur le froid, risque d'inconfort d'été (pic d'apports), poids des masques,
        arbitrage hiver / été entre variantes, lumière contrainte (VSC &lt; 15 %), apports d'hiver valorisables.
        Ce sont des pistes de discussion, à relire avant envoi.</li>
      <li>Lien direct vers un bâtiment : <code>?lat=48.8358&amp;lon=2.3745&amp;r=150&amp;nom=…</code> ouvre un nouveau projet
        sur le bâtiment situé à ces coordonnées.</li>
    </ul>
    <h3>Sources des données</h3>
    <p>Emprises et hauteurs : BD TOPO © IGN (Licence ouverte Etalab 2.0) ; fond de carte et bâtiments hors de France : © contributeurs OpenStreetMap, licence ODbL.
    Recherche d'adresse : Nominatim. Climat : réanalyse ERA5 (Copernicus Climate Change Service) via Open-Meteo,
    licence CC BY 4.0.</p>`;

  // ---------- Routage ----------
  function route() {
    const r = (location.hash.replace(/^#\/?/, '') || 'site');
    const key = pages[r] ? r : 'site';
    for (const k in pages) pages[k].hidden = k !== key;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    if (key === 'site') FS.map.invalidateSize();
    if (key === '3d') FS.scene3d.redraw();
    if (key === 'fiche') FS.uiReport.onShow();
  }

  // ---------- Projet : nouveau, import, export ----------
  function wireProject() {
    FS.$('#btn-theme').addEventListener('click', cycleTheme);
    FS.$('#btn-new').addEventListener('click', () => {
      if (!confirm('Démarrer un nouveau projet ? Le projet en cours sera effacé de ce navigateur (exportez-le d\'abord si besoin).')) return;
      FS.project.reset(); update('target'); FS.uiSite.setStatus('Nouveau projet. Cherchez une adresse.');
    });
    FS.$('#btn-export').addEventListener('click', () => {
      const P = FS.project.get();
      const nm = (P.name || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      FS.download('facade-solaire-' + (nm || 'projet') + '.json', FS.project.exportJSON());
    });
    const file = FS.$('#file-import');
    FS.$('#btn-import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        FS.project.importJSON(await f.text());
        update('target'); FS.map.fit(); FS.uiSite.setStatus('Projet « ' + (FS.project.get().name || f.name) + ' » importé.');
      } catch (e) { alert('Import impossible : ' + e.message); }
      file.value = '';
    });
  }

  function start() {
    FS.project.load();
    applyTheme(FS.store.get('theme', 'auto'));
    if (!window.L) FS.$('#app').append(el('p', { class: 'note err', style: { margin: '20px var(--pad)' } }, 'Leaflet n\'a pas pu être chargé : vérifiez la connexion internet.'));
    pages.site = FS.uiSite.build();
    build3d();
    pages.resultats = FS.uiResults.build();
    pages.thermique = FS.uiThermal.build();
    pages.lumiere = FS.uiDaylight.build();
    pages.fiche = FS.uiReport.build();
    buildMethod();
    wireProject();
    window.addEventListener('hashchange', route);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { FS.map.render(); FS.scene3d.build(); });
    route();
    FS.uiSite.refresh(); refresh3dSide();
    FS.uiResults.refresh();
    // Lien direct vers un bâtiment : ?lat=48.8358&lon=2.3745[&r=150][&nom=…] → nouveau projet sur ce bâtiment
    const q = new URLSearchParams(location.search);
    const qlat = parseFloat(q.get('lat')), qlon = parseFloat(q.get('lon'));
    if (isFinite(qlat) && isFinite(qlon)) {
      FS.project.reset();
      const P = FS.project.get();
      if (q.get('r')) P.radius = FS.clamp(parseInt(q.get('r'), 10) || 150, 20, 500);
      if (q.get('nom')) P.name = q.get('nom');
      FS.map.flyTo(qlat, qlon);
      FS.uiSite.activate(2);
      FS.map.selectAt(qlat, qlon);
      return;
    }
    if (FS.project.get().target) FS.uiResults.ensureClimate();
    if (FS.project.get().target) FS.map.fit();
  }

  FS.app = { update };
  document.addEventListener('DOMContentLoaded', start);
})(window.FS);
