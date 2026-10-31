#!/bin/sh
# Publication sur pisteo.app (Cloudflare Pages) : seuls les fichiers du site partent en ligne,
# pas l'appli Android, le relais Strava ni les scripts. Commande de build : sh build.sh · dossier publié : dist
set -e
rm -rf dist && mkdir dist
cp index.html app.js app.css sw.js manifest.webmanifest confidentialite.html departements.json balade.brf nuit.brf pistes.brf \
   icon.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png dist/
cp -r i18n regions vendor voice p suivi retour-strava .well-known dist/
# allègement du code (≈ 30 % de moins à télécharger) ; si l'outil manque, on publie les fichiers tels quels
for f in app.js app.css; do
  if npx --yes esbuild@0.25 "$f" --minify --target=es2020 --log-level=error --outfile="dist/$f.min" 2>/dev/null && [ -s "dist/$f.min" ]; then
    mv "dist/$f.min" "dist/$f"; echo "allégé : $f"
  else rm -f "dist/$f.min"; echo "non allégé : $f"; fi
done
printf '/.well-known/assetlinks.json\n  Content-Type: application/json\n/sw.js\n  Cache-Control: no-cache\n' > dist/_headers
echo "site prêt dans dist/ :"; ls dist
