#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage: $0 <repo-path> <upstream-branch> <private-repo-url> <host-hooks-branch> [ext-branches-csv]"
  echo "Example: $0 /workspace/AFFiNE canary https://github.com/spmp/AFFiNE.git platform/host-hooks ext/connector-kit,ext/grid-snap"
  exit 1
fi

REPO_PATH="$1"
UPSTREAM_BRANCH="$2"
PRIVATE_REPO_URL="$3"
HOST_HOOKS_BRANCH="$4"
EXT_BRANCHES_CSV="${5:-}"

if [ ! -d "$REPO_PATH/.git" ]; then
  echo "Error: $REPO_PATH is not a git repository"
  exit 1
fi

if ! git -C "$REPO_PATH" rev-parse --verify "upstream/$UPSTREAM_BRANCH" >/dev/null 2>&1; then
  echo "Error: upstream/$UPSTREAM_BRANCH not found. Run: git -C $REPO_PATH fetch upstream"
  exit 1
fi

if git -C "$REPO_PATH" remote get-url private >/dev/null 2>&1; then
  git -C "$REPO_PATH" remote set-url private "$PRIVATE_REPO_URL"
else
  git -C "$REPO_PATH" remote add private "$PRIVATE_REPO_URL"
fi

git -C "$REPO_PATH" fetch private "$HOST_HOOKS_BRANCH"

BASE_REF="upstream/$UPSTREAM_BRANCH"

for sha in $(git -C "$REPO_PATH" rev-list --reverse --no-merges "$BASE_REF..private/$HOST_HOOKS_BRANCH"); do
  git -C "$REPO_PATH" cherry-pick "$sha"
done

if [ -n "$EXT_BRANCHES_CSV" ]; then
  IFS=',' read -ra EXT_BRANCHES <<< "$EXT_BRANCHES_CSV"
  for branch in "${EXT_BRANCHES[@]}"; do
    ext_branch="$(echo "$branch" | xargs)"
    if [ -z "$ext_branch" ]; then
      continue
    fi

    git -C "$REPO_PATH" fetch private "$ext_branch"

    for sha in $(git -C "$REPO_PATH" rev-list --reverse --no-merges "private/$HOST_HOOKS_BRANCH..private/$ext_branch"); do
      git -C "$REPO_PATH" cherry-pick "$sha"
    done
  done
fi

echo "Done composing private branches onto current checkout."
