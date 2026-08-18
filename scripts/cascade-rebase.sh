#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Rebase a linear chain of branches, each onto its immediate parent, in order.

Auto-resolves a conflicted file ONLY when one side of the conflict is
byte-identical to that file's content on the parent branch's current tip
(the exact "verify ours/theirs against the already-rebased parent" check
used throughout this repo's manual rebase-cascade sessions). Any conflict
that doesn't meet that bar halts the script for manual resolution --
it never guesses, and never passes -X ours/-X theirs to git.

Does NOT use `git machete traverse`. The chain is read directly from a
machete-format file (default: .git/machete) by parsing its indentation,
so this script is unaffected by traverse-specific bugs (e.g. its handling
of branches with an empty diff against their parent). The chain source is
pluggable via --chain-file/--chain, so it doesn't have to be .git/machete.

Usage:
  scripts/cascade-rebase.sh plan   [--chain-file PATH] [--chain "b1 b2 b3"] [--from BRANCH] [--to BRANCH]
  scripts/cascade-rebase.sh run    [--chain-file PATH] [--chain "b1 b2 b3"] [--from BRANCH] [--to BRANCH] [--dry-run] [--verify-cmd "CMD"]
  scripts/cascade-rebase.sh status
  scripts/cascade-rebase.sh abort

Commands:
  plan     Print the computed branch chain and exit. Makes no changes.
  run      Start a new cascade, or resume one that previously halted
           (a halted run leaves `git rebase` itself mid-conflict; resolve
           it -- `git add` the files, do NOT run `git rebase --continue`
           yourself -- then run `scripts/cascade-rebase.sh run` again).
  status   Show the saved chain, current position, and whether a git
           rebase is currently in progress.
  abort    `git rebase --abort` the in-progress rebase (if any) and clear
           the saved cascade state. Does not touch any branch's history.

Options:
  --chain-file PATH   A machete-format file to read the chain from
                       (default: .git/machete). Format: one branch per
                       line, child branches indented deeper than their
                       parent, using any consistent whitespace unit.
  --chain "b1 b2 b3"  Explicit space-separated ordered branch list.
                       Overrides --chain-file. First entry is the root
                       (never rebased); each subsequent entry is rebased
                       onto the one before it.
  --from BRANCH        Start the cascade at BRANCH instead of the chain's
                       first non-root entry (branches before it are
                       assumed already up to date and are skipped).
  --to BRANCH          Stop the cascade after BRANCH is rebased.
  --dry-run            `run`: print the planned rebase steps, make no
                       changes.
  --verify-cmd "CMD"   `run`: after each branch's rebase completes
                       cleanly, run CMD (via `sh -c`) in the repo root.
                       A nonzero exit halts the cascade at that branch
                       (the rebase itself is left committed; fix the
                       issue and re-run to continue with the next
                       branch). Skipped in --dry-run.

State is kept in .git/cascade-rebase-state (plain text, not committed).

Examples:
  scripts/cascade-rebase.sh plan
  scripts/cascade-rebase.sh run --verify-cmd "git status --short"
  scripts/cascade-rebase.sh run --from pr/08-grid-and-snapping --to pr/N-build
  scripts/cascade-rebase.sh status
  scripts/cascade-rebase.sh abort
USAGE
}

REPO_ROOT="$(git rev-parse --show-toplevel)"
STATE_FILE="$REPO_ROOT/.git/cascade-rebase-state"
MACHETE_FILE="$REPO_ROOT/.git/machete"

chain_file=""
chain_explicit=""
from_branch=""
to_branch=""
dry_run=0
verify_cmd=""

# --- chain parsing --------------------------------------------------------

# Parses a machete-format file into an ordered chain (root first) by
# walking it top to bottom and tracking the most recent branch seen at
# each indentation depth. Indentation unit is whatever the file uses
# consistently; we only compare relative depth (strictly deeper /
# shallower than the previous line), not an assumed column width.
parse_machete_chain() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "error: chain file not found: $file" >&2
    exit 1
  fi
  awk '
    function indent_len(line,    i, n) {
      n = 0
      for (i = 1; i <= length(line); i++) {
        c = substr(line, i, 1)
        if (c == " " || c == "\t") n++
        else break
      }
      return n
    }
    {
      if ($0 ~ /^[[:space:]]*$/) next
      ind = indent_len($0)
      branch = $0
      sub(/^[[:space:]]*/, "", branch)
      sub(/[[:space:]]+$/, "", branch)
      depth = 0
      # Find the deepest recorded indent strictly less than this one.
      best = -1
      for (d in indent_at) {
        if (indent_at[d] < ind && indent_at[d] > best) {
          best = indent_at[d]
          depth = depth_at[d] + 1
        }
      }
      if (best == -1) depth = 0
      indent_at[ind] = ind
      depth_at[ind] = depth
      branch_at_depth[depth] = branch
      print depth "\t" branch
    }
  ' "$file"
}

compute_chain() {
  if [ -n "$chain_explicit" ]; then
    echo "$chain_explicit"
    return
  fi
  local file="${chain_file:-$MACHETE_FILE}"
  # parse_machete_chain prints "<depth>\t<branch>" per line, in file order,
  # which for a strictly linear stack is already root-to-leaf order.
  parse_machete_chain "$file" | cut -f2- | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

# --- state -----------------------------------------------------------------

save_state() {
  local chain="$1" index="$2"
  printf 'CHAIN=%q\nINDEX=%q\n' "$chain" "$index" > "$STATE_FILE"
}

load_state() {
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
  fi
}

clear_state() {
  rm -f "$STATE_FILE"
}

# --- conflict auto-resolution ----------------------------------------------

# Echoes "ours", "theirs", or "" (unresolvable) for a conflicted path,
# given the branch whose already-rebased tip is the ground truth.
classify_conflict() {
  local path="$1" parent="$2"
  local ours_tmp theirs_tmp parent_tmp
  ours_tmp="$(mktemp)"
  theirs_tmp="$(mktemp)"
  parent_tmp="$(mktemp)"
  git show ":2:$path" > "$ours_tmp" 2>/dev/null || true
  git show ":3:$path" > "$theirs_tmp" 2>/dev/null || true
  git show "$parent:$path" > "$parent_tmp" 2>/dev/null || true

  local result=""
  if diff -q "$ours_tmp" "$parent_tmp" > /dev/null 2>&1; then
    result="ours"
  elif diff -q "$theirs_tmp" "$parent_tmp" > /dev/null 2>&1; then
    result="theirs"
  fi
  rm -f "$ours_tmp" "$theirs_tmp" "$parent_tmp"
  echo "$result"
}

# Attempts to resolve every currently-conflicted path against $1 (the
# parent branch). Returns 0 and stages all resolutions if every conflict
# was classifiable; returns 1 and leaves the conflict untouched (nothing
# staged) if any path couldn't be classified, printing a diagnostic first.
resolve_conflicts_against() {
  local parent="$1"
  local unresolved=0
  local -a conflicted
  mapfile -t conflicted < <(git status --porcelain=v1 | awk '$1=="UU"||$1=="AA"||$1=="AU"||$1=="UA" {print substr($0,4)}')

  if [ "${#conflicted[@]}" -eq 0 ]; then
    # Conflict type git itself can't auto-merge into a UU/AA state
    # (rename conflicts, delete/modify, etc.) -- bail out for manual review.
    echo "  no UU/AA conflicts found (unusual conflict type) -- manual resolution required" >&2
    return 1
  fi

  echo "  ${#conflicted[@]} conflicted file(s):"
  local path side
  for path in "${conflicted[@]}"; do
    side="$(classify_conflict "$path" "$parent")"
    if [ -z "$side" ]; then
      echo "    UNRESOLVABLE: $path (neither side matches $parent's tip)" >&2
      unresolved=1
      continue
    fi
    echo "    $path -> $side (matches $parent's tip)"
  done

  if [ "$unresolved" -eq 1 ]; then
    echo "  halting: at least one conflict needs manual resolution (see UNRESOLVABLE above)" >&2
    return 1
  fi

  for path in "${conflicted[@]}"; do
    side="$(classify_conflict "$path" "$parent")"
    git checkout "--$side" -- "$path"
    git add -- "$path"
  done
  return 0
}

# Drives `git rebase <parent>` (or continues an in-progress one) to
# completion, auto-resolving conflicts against $parent at each step.
drive_rebase() {
  local parent="$1"
  local start_new="$2" # 1 = run `git rebase $parent`, 0 = already in progress

  if [ "$start_new" -eq 1 ]; then
    if git rebase "$parent" > /tmp/cascade-rebase-last.log 2>&1; then
      cat /tmp/cascade-rebase-last.log
      return 0
    fi
    cat /tmp/cascade-rebase-last.log
  fi

  while true; do
    if ! git status --short | grep -q '^U\|^AA\|^AU\|^UA'; then
      # No conflict markers left -- either already resolved (shouldn't
      # happen here) or rebase finished on its own.
      if [ -d "$REPO_ROOT/.git/rebase-merge" ] || [ -d "$REPO_ROOT/.git/rebase-apply" ]; then
        echo "  no conflicts pending but rebase still in progress -- continuing" >&2
        GIT_EDITOR=true git rebase --continue > /tmp/cascade-rebase-last.log 2>&1 || {
          cat /tmp/cascade-rebase-last.log
          continue
        }
        cat /tmp/cascade-rebase-last.log
      fi
      return 0
    fi

    if ! resolve_conflicts_against "$parent"; then
      return 1
    fi

    if GIT_EDITOR=true git rebase --continue > /tmp/cascade-rebase-last.log 2>&1; then
      cat /tmp/cascade-rebase-last.log
      return 0
    fi
    cat /tmp/cascade-rebase-last.log
    # loop: either more conflicts (handled next iteration) or rebase done
  done
}

# --- commands ----------------------------------------------------------------

cmd_plan() {
  local chain
  chain="$(compute_chain)"
  if [ -z "$chain" ]; then
    echo "error: empty chain (check --chain-file/--chain and the file's content)" >&2
    exit 1
  fi
  echo "Chain (root first):"
  local i=0
  for b in $chain; do
    if [ "$i" -eq 0 ]; then
      printf '  %s  (root, never rebased)\n' "$b"
    else
      printf '  %s\n' "$b"
    fi
    i=$((i + 1))
  done
}

cmd_status() {
  load_state
  if [ -z "${CHAIN:-}" ]; then
    echo "no cascade in progress (no saved state at $STATE_FILE)"
  else
    local -a arr
    read -r -a arr <<< "$CHAIN"
    echo "saved chain: ${CHAIN}"
    echo "position: index ${INDEX} / $(( ${#arr[@]} - 1 )) (next to process: ${arr[$INDEX]:-<done>})"
  fi
  if [ -d "$REPO_ROOT/.git/rebase-merge" ] || [ -d "$REPO_ROOT/.git/rebase-apply" ]; then
    echo "git rebase: IN PROGRESS on branch $(git branch --show-current 2>/dev/null || echo '(detached)')"
    git status --short
  else
    echo "git rebase: none in progress"
  fi
}

cmd_abort() {
  if [ -d "$REPO_ROOT/.git/rebase-merge" ] || [ -d "$REPO_ROOT/.git/rebase-apply" ]; then
    git rebase --abort
    echo "aborted in-progress rebase"
  else
    echo "no rebase in progress"
  fi
  clear_state
  echo "cleared saved cascade state"
}

cmd_run() {
  local chain
  local -a arr
  local resuming=0

  if [ -d "$REPO_ROOT/.git/rebase-merge" ] || [ -d "$REPO_ROOT/.git/rebase-apply" ]; then
    resuming=1
    load_state
    if [ -z "${CHAIN:-}" ]; then
      echo "error: a git rebase is in progress but there's no saved cascade state ($STATE_FILE)." >&2
      echo "This rebase wasn't started by this script (or state was cleared). Resolve or" >&2
      echo "abort it manually with plain git, then re-run." >&2
      exit 1
    fi
    chain="$CHAIN"
    read -r -a arr <<< "$chain"
    echo "resuming cascade at index $INDEX (${arr[$INDEX]}), continuing an in-progress rebase"
  else
    chain="$(compute_chain)"
    if [ -z "$chain" ]; then
      echo "error: empty chain (check --chain-file/--chain and the file's content)" >&2
      exit 1
    fi
    read -r -a arr <<< "$chain"

    local start_index=1
    if [ -n "$from_branch" ]; then
      local found=0
      for idx in "${!arr[@]}"; do
        if [ "${arr[$idx]}" = "$from_branch" ]; then
          start_index=$idx
          found=1
          break
        fi
      done
      if [ "$found" -eq 0 ]; then
        echo "error: --from branch '$from_branch' not found in chain" >&2
        exit 1
      fi
      if [ "$start_index" -eq 0 ]; then
        start_index=1
      fi
    fi
    if [ "$dry_run" -eq 1 ]; then
      INDEX="$start_index"
    else
      save_state "$chain" "$start_index"
      load_state
    fi
  fi

  local end_index=$(( ${#arr[@]} - 1 ))
  if [ -n "$to_branch" ]; then
    local found=0
    for idx in "${!arr[@]}"; do
      if [ "${arr[$idx]}" = "$to_branch" ]; then
        end_index=$idx
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      echo "error: --to branch '$to_branch' not found in chain" >&2
      exit 1
    fi
  fi

  if [ "$dry_run" -eq 1 ]; then
    echo "DRY RUN -- no changes will be made"
    local i
    for (( i = INDEX; i <= end_index; i++ )); do
      echo "  would rebase ${arr[$i]} onto ${arr[$((i-1))]}"
    done
    return 0
  fi

  local i
  for (( i = INDEX; i <= end_index; i++ )); do
    local branch="${arr[$i]}"
    local parent="${arr[$((i-1))]}"

    if [ "$resuming" -eq 1 ] && [ "$i" -eq "$INDEX" ]; then
      echo "== continuing rebase of $branch onto $parent =="
      if ! drive_rebase "$parent" 0; then
        save_state "$chain" "$i"
        echo "halted mid-cascade at $branch. Resolve remaining conflicts, 'git add' them," >&2
        echo "and re-run 'scripts/cascade-rebase.sh run' (do not run git rebase --continue yourself)." >&2
        exit 1
      fi
      resuming=0
    else
      echo "== rebasing $branch onto $parent =="
      git checkout "$branch"
      if ! drive_rebase "$parent" 1; then
        save_state "$chain" "$i"
        echo "halted mid-cascade at $branch. Resolve remaining conflicts, 'git add' them," >&2
        echo "and re-run 'scripts/cascade-rebase.sh run' (do not run git rebase --continue yourself)." >&2
        exit 1
      fi
    fi

    echo "== $branch rebased cleanly onto $parent =="

    if [ -n "$verify_cmd" ]; then
      echo "  running verify command: $verify_cmd"
      if ! sh -c "$verify_cmd"; then
        save_state "$chain" "$((i + 1))"
        echo "verify command failed on $branch. The rebase itself succeeded and is committed;" >&2
        echo "fix the issue, then re-run 'scripts/cascade-rebase.sh run' to continue with the next branch." >&2
        exit 1
      fi
    fi

    save_state "$chain" "$((i + 1))"
  done

  clear_state
  echo "== cascade complete: rebased through ${arr[$end_index]} =="
}

# --- arg parsing --------------------------------------------------------

if [ $# -eq 0 ]; then
  usage
  exit 1
fi

command="$1"
shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --chain-file)
      chain_file="$2"
      shift 2
      ;;
    --chain)
      chain_explicit="$2"
      shift 2
      ;;
    --from)
      from_branch="$2"
      shift 2
      ;;
    --to)
      to_branch="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --verify-cmd)
      verify_cmd="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

case "$command" in
  plan) cmd_plan ;;
  run) cmd_run ;;
  status) cmd_status ;;
  abort) cmd_abort ;;
  *)
    echo "unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
