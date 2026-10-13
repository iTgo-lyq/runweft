#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: sync-runweft-skill.sh <source-repository> <distribution-repository>" >&2
  exit 1
fi

source_root=$(realpath -- "$1")
distribution_root=$(realpath -- "$2")
source_commit=$(git -C "$source_root" rev-parse HEAD)
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

if [[ -n $(git -C "$distribution_root" status --porcelain) ]]; then
  echo "Distribution checkout must be clean before synchronizing." >&2
  exit 1
fi
if [[ $(git -C "$distribution_root" branch --show-current) != main ]]; then
  echo "Distribution checkout must be on main." >&2
  exit 1
fi

skill_export=$(mktemp -d)
trap 'rm -rf -- "$skill_export"' EXIT
# Publish the committed Skill tree, never working-tree edits or other source files.
git -C "$source_root" archive "$source_commit:.agents/skills/runweft" |
  tar -x -C "$skill_export"
node "$script_root/check-runweft-skill.mjs" "$skill_export"
mkdir -p "$distribution_root/skills/runweft"
rsync -a --delete "$skill_export/" "$distribution_root/skills/runweft/"

if [[ -z $(git -C "$distribution_root" status --porcelain -- skills/runweft) ]]; then
  echo "Runweft Skill already matches source $source_commit."
  exit 0
fi

git -C "$distribution_root" add --all -- skills/runweft
git -C "$distribution_root" -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -m "Sync Runweft Skill from ${source_commit:0:12}" \
  -m "Source revision: $source_commit"
git -C "$distribution_root" push origin HEAD:main
