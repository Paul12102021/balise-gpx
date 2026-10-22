#!/usr/bin/env bash
# Assemble le site publié sur pisteo.app (Cloudflare Pages : commande « bash build-site.sh », dossier « dist »)
#   pisteo.app/       → la page vitrine (dossier vitrine/)
#   pisteo.app/app/   → l'appli (fichiers à la racine du dépôt)
set -euo pipefail
rm -rf dist && mkdir -p dist/app
cp -r vitrine/. dist/
for f in *; do
  case "$f" in
    dist|vitrine|android|strava-relay|ancienne-adresse|build-site.sh|README.md|LICENSE|_headers|_redirects) ;;
    *) cp -r "$f" dist/app/ ;;
  esac
done
cp _headers _redirects dist/
echo "Site prêt : $(find dist -type f | wc -l) fichiers"
