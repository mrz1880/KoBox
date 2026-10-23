---
name: Signaler un bug
about: Quelque chose ne se comporte pas comme prévu sur une box KoBox
title: "[BUG] "
labels: bug

---

## Ce qui se passe

Une description claire et courte du problème.

## Étapes pour reproduire

1. ...
2. ...

## Ce qui était attendu

## Diagnostic

Retire tout ce qui est privé (noms d'hôte, adresses IP, noms des membres) avant de publier.

- `kobox doctor`
- `kobox install-status`
- `journalctl -u kobox-worker -u kobox-portal --since "1 hour ago"`

## Environnement

- Version de KoBox : _(tag, par ex. v1.0.1)_
- Version de Debian : _(`cat /etc/debian_version`)_
- Noyau : _(`uname -r`)_
- Matériel : _(CPU, RAM, disques, RAID)_
