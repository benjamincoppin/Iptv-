# IPTV+ — lecteur Xtream Codes pour Android TV et téléphone Android

## Contenu
- `AndroidManifest.xml`, `src/` : coque Android (Java). Elle contient le lecteur vidéo natif (matériel de l'appareil) et l'affichage de l'interface.
- `assets/www/` : interface (HTML/CSS/JS) : connexion, accueil, films, séries, TV en direct, guide TV, favoris, recherche, paramètres.
- `res/` : icône et bannière Android TV.
- `keystore/iptvplus.jks` : clé de signature (mot de passe `iptvplus`). **Garde-la** : sans elle, les futures versions ne s'installeront pas par-dessus l'ancienne.
- `build.sh` : compilation sans Gradle (aapt2 → javac → d8 → zipalign → apksigner).
- `.github/workflows/build.yml` : compilation automatique sur GitHub.

## Compiler avec GitHub (rien à installer)
1. Crée un dépôt **privé** sur github.com et envoie-y tout le contenu de ce dossier.
2. Onglet **Actions** → « Compiler l'APK IPTV+ ». La compilation démarre à chaque envoi.
3. Ouvre l'exécution terminée → section **Artifacts** → télécharge `IPTVPlus-apk`.

## Compiler sur un PC (Linux, macOS ou WSL)
Prérequis : JDK 17 et le SDK Android (build-tools 34 et platform 34, installés par exemple avec Android Studio).
```
export ANDROID_HOME=~/Android/Sdk
bash build.sh
```
Le fichier se trouve ensuite dans `build/IPTVPlus.apk`.

## Installer sur la TV
- Copie l'APK sur une clé USB et ouvre-le avec un gestionnaire de fichiers. Autre solution : l'appli « Downloader » avec un lien.
- Autorise l'installation d'applications de sources inconnues pour cette appli.

## Télécommande
- **TV en direct** : OK affiche la liste des chaînes. ↑/↓ change de chaîne quand la liste est fermée. → affiche ou masque le bandeau d'infos. Les chiffres permettent de taper un numéro de chaîne. Un appui long sur OK ajoute ou retire la chaîne des favoris.
- **Films / séries** : ←/→ recule ou avance de 10 s. OK met en pause ou relance la lecture.
- **Retour** : revient à l'écran précédent. Un double appui sur l'accueil quitte l'appli.
