#!/bin/sh
# Initialize this folder as a git repo and push to GitHub.
# Run from the project root: ./init-and-push.sh

set -e
cd "$(dirname "$0")"

if [ -d .git ]; then
  echo "Git is already initialized. Adding remote and pushing..."
  git remote remove origin 2>/dev/null || true
  git remote add origin https://github.com/zzish/llm-quiz-generation-evaluator.git
  git branch -M main
  git push -u origin main
  exit 0
fi

git init
git remote add origin https://github.com/zzish/llm-quiz-generation-evaluator.git
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main

echo "Done. Code is on https://github.com/zzish/llm-quiz-generation-evaluator"
