#!/bin/bash
set -e

echo "→ Committing any uncommitted changes..."
git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore: deploy $(date '+%Y-%m-%d %H:%M')"
else
  echo "  Nothing new to commit"
fi

echo "→ Pushing to main..."
git push origin HEAD:main

echo "→ Building Electron app..."
cd electron-app
npm install
npm run build
cd ..

echo ""
echo "✓ Done. Find your new .dmg in electron-app/dist/"
echo "  Drag it to Applications to update the app."
