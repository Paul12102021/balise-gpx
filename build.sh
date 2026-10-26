#!/bin/sh
# Publication sur pisteo.app (Cloudflare Pages) : seuls les fichiers du site partent en ligne,
# pas l'appli Android, le relais Strava ni les scripts. Commande de build : sh build.sh · dossier publié : dist
set -e
rm -rf dist && mkdir dist
cp index.html app.js app.css sw.js manifest.webmanifest confidentialite.html departements.json balade.brf nuit.brf \
   icon.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png dist/
cp -r i18n regions vendor voice p retour-strava .well-known dist/
printf '/.well-known/assetlinks.json\n  Content-Type: application/json\n/sw.js\n  Cache-Control: no-cache\n' > dist/_headers
echo "site prêt dans dist/ :"; ls dist
