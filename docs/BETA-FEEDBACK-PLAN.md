# Plan d'exécution du retour de recette

> Suite de `docs/BETA-FEEDBACK.md`. Une tranche par livrable, chacune testée et
> mergeable seule. Ordre choisi par ce qui se voit le plus et ce qui débloque le
> reste, pas par la numérotation d'origine.

## Principe

TDD sur chaque tranche : un test qui échoue pour la bonne raison, le minimum pour
le faire passer, puis le refactor. Suite complète plus E2E en conteneur avant de
pousser. Une PR par tranche.

Deux tranches portent une décision de modèle plutôt qu'un simple ajout : le
recyclage en lien dur (tranche 9) et le choix de langue (tranche 10). Elles
disent explicitement quel arbitrage a été pris et pourquoi.

---

## Tranche 1 — Les dossiers réels partout (A1)

`DownloadCategory` est un enum fermé `films|series` créé pour garantir un
sous-chemin sûr. `Label` garantit déjà cette propriété, par une expression
régulière qui exclut le point initial, les barres obliques et les métacaractères,
et il préserve la casse (`Films`, `Series`, `Divers` en production).

Remplacer l'un par l'autre : le formulaire « Download a link » propose les
dossiers réels du membre, les mêmes que « Sending ». Colonne `category` en texte
libre validé par `Label` plutôt qu'en enum SQL, avec migration.

Risque : les lignes existantes portent `films`/`series` en minuscules, que
`Label` accepte tel quel. Rien à réécrire.

## Tranche 2 — Quotas modifiables et usage visible (A3, A4)

Un cas d'usage `SetUserQuota`, son job typé, sa commande CLI et sa route admin
sur la fiche du membre. L'usage mesuré (`QuotaAdapter.getUsage`, déjà écrit)
s'affiche à côté du quota, avec la part consommée.

Vérifier au passage que rien ne recalcule les quotas des autres membres, et le
dire dans le test.

## Tranche 3 — Blocklists actionnables (A2)

Une bascule par liste, qui écrit l'état et déclenche le rendu du filtre. La
pastille cesse d'être décorative.

## Tranche 4 — Le membre est prévenu d'un retrait (A6)

Un torrent public retiré sur une instance en « privés seulement » produit un mail
par l'outbox existante, disant quel torrent et pourquoi. La détection est déjà
fiable quel que soit le mode d'ajout.

## Tranche 5 — L'arborescence même vide (A5)

« My Media » affiche les dossiers du membre même sans fichier dedans. Un dossier
vide préexiste à son contenu.

## Tranche 6 — Diagnostic AllDebrid (C1)

La raison d'échec est déjà affichée. Rendre lisible la cause la plus probable :
si `aria2` n'est pas installé ou sans secret RPC, le dire dans la page
Downloads plutôt que de laisser un échec par lien.

## Tranche 7 — Relais mail et domaine depuis l'interface (B)

Deux écrans admin par-dessus ce qui existe déjà en CLI et en composant :
`configure-mail-relay` d'un côté, le composant `letsencrypt` de l'autre. Avec
l'envoi d'un mail de test, qui est la seule façon honnête de valider un relais.

## Tranche 8 — Clé SSH par membre (B)

Le membre dépose sa clé publique depuis son espace, KoBox écrit son
`authorized_keys`. Restreindre ce que la clé permet, puisque le besoin est
l'envoi de torrents par script et non un shell.

## Tranche 9 — Recyclage des téléchargements (B)

Trois modes : aucun, copie simple, lien dur. Les deux premiers sont sans
conséquence sur les quotas. Le troisième partage les inodes entre membres et fait
cesser au quota de refléter ce que chacun consomme.

Arbitrage pris : les trois sont implémentés, le défaut reste **aucun**, et le
mode lien dur affiche ce qu'il change avant d'être activé. Refuser d'écrire
l'option serait décider à la place de l'exploitant ; l'activer par défaut serait
décider à sa place aussi.

## Tranche 10 — Choix de la langue (B)

Français et anglais. Arbitrage pris : la langue est une préférence du membre,
stockée sur son compte, pas une variable globale ni une détection d'en-tête.
Traversée de toutes les vues.

## Tranche 11 — Nextcloud (B)

Composant d'installation, avec les trois dossiers rTorrent montés à la racine du
membre et le modèle de droits demandé : membres non-administrateurs, seuls les
administrateurs du portail sont administrateurs Nextcloud.

## Tranche 12 — Comparaison fonctionnelle avec MySB (E)

Inventaire écran par écran contre les sources archivées, pas contre le souvenir.
À faire avant le cutover, son résultat pouvant le décaler.

---

## Ce qui reste hors de ce plan

- Les plugins ruTorrent : comparaison à faire sur pièces, sur la machine.
- Le filtrage IP, la fonction Watch et le fair use : à éprouver sur la démo,
  aucun code en cause tant que rien n'est reproché.
