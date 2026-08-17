# Inventaire fonctionnel MySB face à KoBox

> Demandé en recette : « vérifier qu'aucune fonctionnalité importante n'a été
> oubliée ». Établi le 2026-08-17 en listant les 33 pages web et les 15 scripts
> de `archive/v7.2`, puis en cherchant leur équivalent dans KoBox. Rien ici ne
> vient d'un souvenir : chaque ligne renvoie à un fichier de l'un ou l'autre.
>
> À faire avant le cutover, puisque son résultat peut le décaler.

## Verdict

Sur les 33 pages MySB, **24 ont un équivalent**, **4 ont été retirées du
périmètre volontairement**, et **5 n'existent pas encore**. Aucune des cinq
n'est bloquante pour la bascule ; deux méritent une décision.

---

## Ce qui est couvert

| Page MySB | Équivalent KoBox |
|---|---|
| `Home.php` | `/` (accueil selon le rôle) |
| `index.php` + `Logout.php` | `/login`, `/logout` |
| `ChangePassword.php` | `/password` |
| `ChangeEmail.php` | fiche membre en admin (`/admin/users/:name`) |
| `NewUser.php`, `UserAdd.php` | `/admin/users` |
| `UserInfo.php` | `/admin/users/:name` |
| `UserInfoMail.php` | l'outbox (`/admin/mails`) et le mail de bienvenue |
| `rTorrent.php` | `/rutorrent` (iframe) et `/admin/users/:name` pour les ports |
| `Synchronization.php` | `/sync` (dossiers, modes, destination, file d'envoi) |
| `TrackersList.php` | `/admin/trackers` |
| `Help_Trackers.php` | texte explicatif sur `/admin/trackers` |
| `BlockLists_Usual.php` | `/admin/blocklists` |
| `BlockLists_Countries.php` | même page, même catalogue |
| `Help_Blocklists.php` | texte explicatif sur `/admin/blocklists` |
| `ManageAddresses.php` | `/admin/addresses` |
| `Help_IPrestriction.php` | texte explicatif sur `/admin/addresses` |
| `OpenVPN.php` | `/access` (les trois profils) |
| `SMTP.php` | `/admin/mail-relay`, avec envoi de test |
| `Logs.php` | `/admin/logs` |
| `ApplyConfig.php` | plus de bouton : la convergence est le modèle d'installation |
| `OptionsSystem.php` (partiel) | `/admin/health`, `/admin/packages`, `/monitoring` |
| `OptionsMySB.php` (partiel) | `/admin/config` (lecture seule) et la fiche membre |
| `scripts/SendMails.bsh` | job planifié `send-mails` |
| `scripts/BlocklistsRTorrent.bsh` | `update-blocklists` + `render-blocklist-filters` |
| `scripts/GetTrackersCert.bsh` | `renew-tracker-certs` |
| `scripts/DynamicAddressResolver.bsh` | `resolve-dyndns` |
| `scripts/LogServerAndQuota.bsh` | `sample-disk-usage` + `evaluate-fair-use` |
| `scripts/NextCloud.bsh` | composant `nextcloud` |
| `scripts/OpenVPN-Bridge.bsh` | composant `openvpn` |
| `install/MySB_Install.bsh` | `kobox install`, déclaratif et convergent |
| `upgrade/*.bsh` | `kobox upgrade` (transactionnel, avec rollback) |

## Ce qui a été retiré volontairement

| Page ou script MySB | Décision |
|---|---|
| `RentingInfo.php`, `RentingOptions.php`, `RentingPayments.php`, `PaymentReminder.bsh` | la facturation sort du périmètre v1 (`docs/AUDIT.md` §7) |
| `scripts/PeerGuardian.bsh`, `funcs_PeerGuardian` | remplacé par ipset, validé en Phase 5 |
| `scripts/DNScrypt-proxy.bsh`, `DNScrypt.php` | dnscrypt-proxy n'est pas packagé pour Debian 12 ; bind seul, saut honnête à l'installation |
| `funcs_Minio`, `Buckets.php` | Minio hors périmètre v1 ; réparation notée en optionnel |
| `install/MySB_CleanAll.bsh` | délibérément non porté : `kobox uninstall` ne touche ni les comptes, ni les homes, ni la base |

## Ce qui manque

**1. `ForceAddress.php` : forcer l'adresse IP d'un membre.** MySB permettait de
fixer l'adresse d'un membre plutôt que de la laisser se résoudre. KoBox gère les
adresses (`/admin/addresses`) et le DynDNS, mais pas le forçage manuel. Impact
faible, et à confirmer : la fonction existait peut-être pour un cas que le
DynDNS couvre désormais.

**2. Le rapport PeerGuardian par mail** (`OptionsSystem.php`, section PGL).
L'ipset qui l'a remplacé n'envoie rien. Ce n'est pas une régression du blocage
lui-même, seulement de sa visibilité.

**3. La page d'aide dédiée par sujet.** MySB avait trois pages `Help_*`. KoBox a
mis l'explication dans la page concernée plutôt que dans une page à part. C'est
un choix, pas un oubli, mais il n'existe aucun endroit où lire l'ensemble.

**4. Le choix de version de rTorrent** (`OptionsMySB.php`,
`User_OptionsMySB_rTorrentVersion`). KoBox installe la version de la
distribution. Porter le choix supposerait de vendorer plusieurs versions.

**5. La langue de l'interface d'administration.** MySB traduisait tout, y
compris l'administration (`inc/lang/fr/`). KoBox traduit les pages membres et
laisse l'administration en anglais.

---

## Deux points qui méritent une décision

- **Le rapport PGL par mail.** Soit on l'abandonne explicitement, soit
  `update-blocklists` envoie un résumé par l'outbox, ce qui est une demi-journée.
- **L'administration en français.** Le mécanisme est en place et le catalogue
  s'étend une ligne à la fois ; c'est un travail de vocabulaire, pas de code.

Le reste peut se décider après la bascule sans coût.
