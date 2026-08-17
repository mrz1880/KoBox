# Retour de recette beta, trié

> Remontées d'un second opérateur après prise en main de la démo, le 2026-08-17.
> Chaque point a été confronté au code avant d'être classé : la colonne qui compte
> est le verdict, pas la formulation d'origine.

---

## A. Confirmé dans le code, à corriger

### A1. « Sending » et « Download a link » ne montrent pas les mêmes dossiers

Exact, et l'écart est structurel plutôt qu'un défaut de synchronisation.

- `Sending` liste les vrais dossiers du membre, lus sur son instance
  (`routes/user.ts:358`, les `watchDirs` porteuses d'un label). N'importe quel
  dossier créé apparaît.
- `Download a link` accepte **deux catégories en dur**, `films` et `series`
  (`domain/ddl/DownloadCategory.ts:3`, enum fermé, commenté « keeps the value
  path-safe by construction »).

Un membre qui crée « Documentaires » peut le synchroniser mais ne peut rien y
télécharger. Et les labels de production sont capitalisés (`Films`, `Series`),
donc même les deux catégories existantes ne s'alignent pas forcément.

L'enum fermé avait une raison valable : garantir un sous-chemin sûr. La bonne
correction n'est donc pas de l'ouvrir en grand mais de faire porter la sûreté par
le type `Label`, déjà validé, et de proposer les dossiers réels du membre.

### A2. Les blocklists ne s'activent pas depuis l'interface

Exact. La page affiche `enabled` / `disabled` comme une pastille en lecture seule
(`views/adminTrackersPage.ts:80`) et les seules routes existantes sont
`/admin/blocklists/update` (retélécharge tout) et `/admin/blocklists/import-catalog`
(`routes/adminTrackers.ts:89` et `:98`). Aucune bascule par liste.

Le statut affiché est donc bien l'état réel, il n'est simplement pas actionnable.

### A3. Un quota ne peut pas être modifié après création

Exact. `setQuota` n'est appelé qu'une fois, à la création (`CreateUser.ts:95`).
Il n'existe ni commande CLI ni route admin pour le changer ensuite.

En revanche, **« ajouter un utilisateur met à jour le quota de tout le monde »
n'est pas ce que fait le code** : aucun recalcul global n'existe nulle part. Le
formulaire de création propose 412 GiB par défaut, donc des comptes créés à la
suite affichent tous la même valeur, ce qui ressemble à une mise à jour
collective. À confirmer avec une capture avant/après.

### A4. L'espace utilisé par membre n'est pas affiché en admin

Exact. La mesure existe (`QuotaAdapter.getUsage`, commande `kobox show-usage`),
elle n'est câblée dans aucune page.

### A5. « My Media » n'affiche pas l'arborescence quand elle est vide

Exact : une seule ligne « Nothing here yet » remplace l'arbre
(`views/userPages.ts:483`). Montrer les dossiers vides est légitime, ils
préexistent au contenu.

### A6. Retrait d'un torrent public : rien n'est envoyé au membre

Aujourd'hui un torrent public sur une instance en « privés seulement » est
enregistré comme rejeté, puis stoppé et fermé dans rTorrent. C'est exactement le
comportement demandé, **sauf le mail** : le membre n'est prévenu de rien.

À noter, la détection est désormais fiable quel que soit le mode d'ajout, ce qui
n'était pas le cas avant (`d.is_private` porté par l'événement `inserted_new`).
La notion de tracker **semi-privé** n'existe pas dans le modèle : aujourd'hui
c'est binaire.

---

## B. Absent, et jamais construit

Aucun de ces points n'est un défaut : ils n'ont simplement jamais été dans le
périmètre. Ils demandent un arbitrage avant tout code.

| Demande | État | Remarque |
|---|---|---|
| Nextcloud avec les 3 dossiers rTorrent | absent | serait un composant d'installation de plus, plus un modèle de droits (membres non-admins Nextcloud, admins portail seuls admins) |
| Choix de langue FR / EN | absent | tout est en anglais ; c'est une traversée complète des vues, pas un réglage |
| Clé SSH par membre | absent | rien ne gère `authorized_keys` hors verrouillage de compte |
| Recyclage des téléchargements (`cp -a` / `cp -al`) | absent | existait sur MySB (`files_recycling`) |
| Configuration du relais mail depuis l'interface | absent de l'UI | la commande `kobox configure-mail-relay` existe |
| Nom de domaine et Let's Encrypt depuis l'interface | absent de l'UI | le composant `letsencrypt` existe, piloté par variables d'environnement |

Le recyclage mérite un mot : la variante **lien dur** partage les inodes entre
membres, donc le quota d'un membre cesse de refléter ce qu'il consomme
réellement, et la suppression par l'un n'affecte pas les autres. C'est une
décision de modèle, pas une option à cocher. À traiter séparément de la copie
simple, qui elle est sans conséquence sur les quotas.

---

## C. Il manque une donnée pour trancher

### C1. AllDebrid termine en « Failed »

L'interface **affiche déjà la raison** de l'échec : un téléchargement raté n'a
jamais de nom de fichier (`filename` n'est posé que par `completed()`), donc la
cellule de détail montre le message d'erreur et non le nom.

Il faut donc simplement lire ce que dit la ligne en échec. Trois causes probables,
par ordre de vraisemblance :

1. le composant `aria2` n'est pas installé sur la démo (d'autres composants y
   étaient sautés, cf. l'épisode ruTorrent) ;
2. `KOBOX_ARIA2_RPC_SECRET` absent, auquel cas l'installation du composant se
   saute proprement et le téléchargement n'a personne à qui parler ;
3. la clé AllDebrid elle-même, que l'API renvoie avec un code précis.

Les trois se distinguent en une ligne, sans deviner : la raison affichée à côté
du lien en échec, ou `kobox install-status`.

---

## D. À vérifier sur la machine, pas dans le code

- **Plugins ruTorrent.** KoBox déploie l'archive officielle telle quelle, sans
  ajout ni retrait de plugins. MySB avait sa propre sélection. Il faut comparer
  les deux listes sur pièces, le code ne le dira pas.
- **Fonction Watch.** Le chemin `watch/<Label>` vers `complete/<Label>` est
  couvert par l'E2E contre un vrai rTorrent, donc le mécanisme fonctionne. Si ça
  échoue sur la démo, c'est un dossier ou un droit, pas la logique.
- **Filtrage IP par membre.** À tester avec deux membres et un changement d'IP,
  ce qu'aucun test automatique ne reproduit.
- **Fair use.** Rien à corriger tant que rien n'est reproché.

---

## E. Comparaison exhaustive avec MySB

Demandée, et pas encore faite. `docs/AUDIT.md` couvre l'architecture et les
issues amont, pas un inventaire fonctionnel écran par écran. C'est un travail à
part entière : il vaut mieux le faire avant le cutover qu'après, puisque son
résultat peut décaler la bascule.

---

## Ordre proposé

1. **A1** (les dossiers qui ne correspondent pas) : c'est celui qui se voit tous
   les jours et qui produit des données mal rangées.
2. **A3 et A4** ensemble : le quota se modifie et l'usage s'affiche, même page.
3. **A2** : les blocklists deviennent actionnables.
4. **A6** : le mail de retrait, court, et il ferme une boucle déjà en place.
5. **A5** : l'arborescence vide.
6. **C1** : dès que la raison de l'échec est connue.

Le reste (partie B) attend un arbitrage de périmètre, et **E** doit être planifié
avant le cutover.
