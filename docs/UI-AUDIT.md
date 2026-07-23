# KoBox — Audit UI du portail & direction design

> Audit du portail MySB actuel (depuis les **assets réels** du thème — pas de capture de la
> prod, qui exposerait les données des 8 users) + **direction design** pour le portail KoBox
> réécrit (audit §6, phase 6). Mené avec le skill `frontend-design`.
>
> **Direction visuelle démontrée (artifact)** :
> https://claude.ai/code/artifact/0d4069eb-0830-47b9-8e54-73a294cad1ea

---

## 1. État des lieux — le portail actuel

Thème `web/public/themes/MySB/` = **thème jQuery skeuomorphe ~2013, largeur fixe,
desktop-only**. Preuves (assets) :

| Axe | Constat | Preuve |
|---|---|---|
| **Palette** | Cream chaud + olive + cyan + taupe | `screen.css` : `#F8F7EE` + `pattern.png`, olive `#76a83a`, accent cyan `#09D4FF`, erreur `#c00000` |
| **Typo** | Une seule fonte display, un seul poids, pas de woff2 ; échelle ad-hoc en `%` | `YanoneKaffeesatz-Regular.{eot,ttf}` ; `font-size: 80→160%` ; fallback `lucida sans` |
| **Chrome** | Image-sliced : barre de menu, fond, puces, footer en PNG ; **spacer `pixel.gif`** ; logo **GIF animé** | `menubar.png`, `menu_hover.png`, `footer.png`, `bullet.png`, `pixel.gif`, `toulousain79.gif` |
| **Boutons** | Kit **Bootstrap 2.x** glossy (dégradés) bolté par-dessus le thème custom → 2ᵉ langage visuel | `buttons.css` : `#f89406 #bd362f #51a351 #2f96b4` + `#fbb450`… |
| **Responsive** | **Aucune `@media`**, **pas de `<meta viewport>`** → non responsive, inutilisable mobile | `grep @media` = ∅ ; `Layout.php` sans viewport ; doctype XHTML |
| **Cohérence** | **4 vocabulaires** UI empilés | thème custom + Bootstrap 2 + `animate.css` (2910 l.) + `noty`/`tooltipster` |
| **Code front** | HTML construit par concat PHP, styles inline (ex. `width:strlen*10px`), menu = `switch` de 280 l. | `web/pages/*.php`, `web/inc/functions.php` |

**Diagnostic (par priorité)** :
1. **Desktop-only** — pas de viewport ni de responsive. the owner/les users sur mobile passent par
   le plugin ruTorrent Mobile, jamais par le portail.
2. **Chrome image-sliced** — non-retina, non-thémable, non-maintenable (chaque changement = ré-éditer des PNG).
3. **Incohérence visuelle** — 4 kits UI qui se contredisent (Bootstrap 2 vs thème cyan/olive).
4. **Dette front** — HTML/CSS/SQL mélangés, inline styles, aucune tokenisation.
5. **Aucune lecture d'état** — le portail liste des lignes ; il ne **montre** rien de l'état
   opérationnel (santé, bande passante, quota par user). C'est exactement ce qui a laissé passer user-h.

**À conserver (the owner reconnaît l'accès)** : l'URL/entrée `https://seedbox.example:8189` + auth,
et l'interaction signature **« Appliquer les modifications »** (on empile des changements puis on
applique — mappe le job-queue KoBox ; grisée quand rien n'est en attente, bonne affordance à
garder). Le reste du look est libre (décision §7 de `AUDIT.md`).

**Confirmé par capture réelle (home de `user-f`, fournie 2026-07-23)** — 3 constats que les assets
seuls ne montraient pas :
1. **La home récite des fonctionnalités au lieu de montrer un état** : « En tant qu'utilisateur
   normal, vous *diposez* des fonctionnalités suivantes : [7 puces] » (+ vrai bug de copie
   *diposez → disposez*). C'est le système qui se décrit — une notice, pas un poste de travail.
   Header = **photo bokeh floue** (stock, décorative, muette sur le sujet). Footer crédite la
   stack : *CSS3_two · CMS Wolf · Medoo · GeoLite2*.
2. **Seule télémétrie = un bandeau host en pastilles vertes** en bas (cpu/ram/swap/load,
   toujours « vert »). **Host-wide, zéro attribution par user** = l'angle mort exact qui a caché
   user-h (un uid sature l'upstream, le load agrégé reste calme). Déco déguisée en monitoring.
3. **Ton chaleureux/personnel** (« Bonjour user-f, bienvenue ») — juste pour 8 potes. À **garder**
   sur la home user ; la console froide convient à la vue owner/admin, pas à l'accueil user.

## 2. Direction design KoBox (token system)

Sujet : **console d'exploitation** d'une seedbox privée pour 8 users de confiance ; dense,
pilotée par l'état, opérée par un power-user + maintenue par un dev. Ce n'est pas un site
marketing — c'est un **instrument**.

**Color** (bleu-ardoise, *pas* le near-black+acid par défaut ; teal = débit, ambre = alerte
fair-use **réservée** donc elle ressort ; light mode = papier chaud, clin d'œil au cream MySB) :
- dark : `--bg #0E131A` · `--panel #151D28` · `--line #26313F` · `--ink #E8EDF3` ·
  `--teal #37B0C4` · `--amber #EBA23C` · `--green #5FB98A` · `--danger #E4575C`
- light : `--bg #EFEBE2` · `--panel #FBFAF6` · `--ink #1B242E` · `--teal #0E8FA6` · `--amber #B26F14`

**Type** (la CSP des artifacts bloque les webfonts → on fait de la **mono système une voix
délibérée**, authentique à une console) :
- **Data/télémétrie** : `ui-monospace` + `tabular-nums` — ports, compteurs, octets, hashes.
- **Labels/titres** : sans système en gras, eyebrows **UPPERCASE** tracké. Pas de fonte à embarquer.

**Layout** : une seule vue **Fleet console**. Ruban de synthèse en tête (egress agrégé, disque,
alertes, **« Apply changes · N »**), puis les **channel strips** par user.

**Signature — le « signal strip »** : chaque user = une voie de **table de mixage / VU-mètre**
(LED d'état · VU de débit live · jauge de quota · torrents · actions). La bande passante devient
lisible d'un coup d'œil → un abuseur comme **user-h** est **évident immédiatement**, au lieu de
remonter des jours plus tard en « SSH galère ». C'est l'incarnation directe de l'observabilité
fair-use (`AUDIT.md §3.7`) et du sujet « station de transmission ».

**Réponse graduée visible in-place** : sur la voie en breach, l'auto-throttle est appliqué et
**Suspend** est mis en file dans « Apply changes » (humain dans la boucle) — cohérent avec les
décisions figées (`AUDIT.md §3.7`).

**Home = poste de travail, par rôle** (leçon de la home legacy qui récite des features) :
- **User** (ex. user-f) : sa **propre** signal strip en tête (débit/quota/torrents/état) + ses
  actions réelles (rTorrent, catégories/sync, adresses autorisées, OpenVPN, mot de passe). Ton
  **chaleureux** conservé (un bonjour personnel), pas de liste-notice.
- **Owner/admin** (the owner) : la **Fleet console** (les 8 voies + fair-use).
Le bandeau host « pastilles vertes » legacy est remplacé par les signal strips par-user ;
l'agrégat host reste un ruban compact. Le héros de la page est l'**état**, pas une photo bokeh.

## 3. Décisions de composants (portail réécrit)

| Composant legacy | Problème | KoBox |
|---|---|---|
| Menu sooperfish (dropdown `switch` 280 l.) | non responsive, i18n par valeur de string | nav plate, tokenisée, responsive |
| Boutons Bootstrap 2 glossy | 2ᵉ langage visuel | boutons plats via tokens (ghost / primary teal / warn ambre / danger) |
| Validation par `valid.png`/`invalid.png` | images, pas d'a11y | états CSS + message texte (voix interface) |
| `noty` + `tooltipster` | kits jQuery datés | toasts natifs + `NotificationPort` (ntfy/email/discord) pour l'ops |
| Tables brutes (trackers/users) | pas de lecture d'état | tables denses + **severity chips / VU** ; `tabular-nums` |
| « Apply configuration » | interaction signature à garder | conservée = déclencheur du job-queue typé |
| NetData iframe (Bootstrap 3) | dashboard host séparé | gardé pour l'œil host ; l'état **par-user** vit dans le portail |

**Apps vendored gardées — the owner les utilise** (« j'utilise webmin seedbox manager cakebox etc »,
2026-07-23) : Cakebox, Seedbox-Manager, Webmin, ShellInABox, NetData, ruTorrent restent
**liées/iframées** depuis le portail KoBox. Le portail est un **shell / launcher** qui unifie
l'admin KoBox-natif (users, trackers, fair-use, sync…) — il n'absorbe **pas** ces apps et ne
supprime **aucun** accès existant. La signal strip et les vues rôle-scopées s'ajoutent ; les
liens vers les UIs tierces restent.

**Plancher qualité** : responsive jusqu'au mobile, `<meta viewport>`, focus clavier visible,
`prefers-reduced-motion` respecté, thème-aware (light/dark), zéro chrome image-sliced, aucune
largeur fixe.

## 4. Placement

Le portail réécrit est la **Phase 6** du plan de migration (`AUDIT.md §6`), dernière tranche
(auth applicative + SSR). Mais les **tokens design + le composant « signal strip »** sont posés
plus tôt : dès que l'instrumentation Phase 0 et le métering par-user Phase 3 existent, la Fleet
console a des données réelles à afficher. Le signal strip est donc le **fil rouge visuel** entre
l'observabilité (§3.7) et le portail (phase 6).
