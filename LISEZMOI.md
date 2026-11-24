# IPTV+

Lecteur IPTV (Xtream Codes) pour Android TV et téléphone Android.

- Interface : `app/src/main/assets/www` (HTML/CSS/JS). Elle comprend l'accueil style Cinéma, la TV en direct « Direct d'abord », le guide TV, les films, les séries, les favoris, la recherche et les paramètres.
- Lecteur vidéo : LibVLC, la bibliothèque officielle de VideoLAN. Elle décode tous les formats de son, y compris AC3, E-AC3, DTS et TrueHD. Le format d'image se règle : original, 16:9, 4:3, étiré ou zoom.

## Télécharger l'APK
Dernière version : **Releases** → `IPTVPlus.apk`.
Le lien direct ne change pas d'une version à l'autre, il marche donc aussi avec l'appli « Downloader » sur la TV :
`https://github.com/benjamincoppin/Iptv-/releases/latest/download/IPTVPlus.apk`

## Compilation
Elle est automatique à chaque envoi sur `main` (onglet Actions). La signature utilise deux secrets du dépôt : `IPTV_KEYSTORE_B64` et `IPTV_KEYSTORE_PASSWORD`. Sans eux, l'APK est signé avec une clé de debug et aucune Release n'est publiée.

## Télécommande
- **TV en direct** : OK ouvre la liste des chaînes. ↑/↓ change de chaîne. → affiche ou masque les infos. Les chiffres permettent de taper un numéro de chaîne. Un appui long sur OK ouvre le menu de la chaîne (favori, format d'image).
- **Films / séries** : ←/→ recule ou avance de 10 s. OK met en pause ou relance la lecture.
- **Retour** : écran précédent. Un double appui sur l'accueil quitte l'appli.
