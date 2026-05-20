#!/usr/bin/env bash
#
# Extends immich-pages/scripts/watch-compose-rebuild.sh for the AFFiNE deploy
# flow: recycle the buildx builder (bounded prune by default, since a full
# volume wipe before every build destroys the layer cache the Dockerfile's
# staged COPY relies on), build with plain progress into its own log file
# (still tee'd to the terminal), then down/pull/up the stack.

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage:
  watch-compose-rebuild.sh --compose-file FILE [options]

Watches a trigger file continuously. When the file appears/changes, runs:
  1. recycle the buildx builder (prune-to-size by default; --builder-mode nuke
     to stop/remove the builder container + its state volume instead)
  2. BUILDKIT_PROGRESS=plain docker compose -f FILE build   (tee'd to --build-log
     and the terminal)
  3. docker compose -f FILE down
  4. docker compose -f FILE pull
  5. docker compose -f FILE up -d
  6. a bounded `logs --tail` snapshot (or `logs -f` if --follow-logs, but that
     blocks the watcher from seeing further triggers -- only use it for a
     one-shot manual run, not the persistent watch loop)

Options:
  -f, --compose-file FILE     Compose file to operate on (required)
  -s, --service NAME          Build/recreate only this Compose service
                              (default: every service in the compose file)
  -w, --watch-dir DIR         Directory containing the trigger file (default: .)
  -t, --trigger-file NAME     Trigger filename or path (default: rebuild)
  -o, --status-file FILE      Status file (default: WATCH_DIR/.affine-rebuild.status)
  -p, --poll SECONDS          Polling fallback interval (default: 2)
      --build-log FILE        Build step log (default: WATCH_DIR/docker-build.log)
      --deploy-log FILE       down/pull/up/logs output log
                              (default: WATCH_DIR/docker-deploy.log)
      --builder-mode MODE     prune (default) or nuke
      --keep-storage SIZE     Passed to `docker buildx prune --keep-storage`
                              in prune mode (default: 20GB)
      --builder-container-pattern PAT
                              grep pattern to find the buildkit container in
                              nuke mode (default: buildkit:buildx-stable)
      --builder-volume NAME   Volume removed in nuke mode
                              (default: buildx_buildkit_container0_state)
      --follow-logs           Use `logs -f` (blocking) instead of a bounded
                              tail snapshot after `up -d`. Only sensible for a
                              one-shot manual invocation.
      --once                  Process the trigger once (if present) and exit,
                              instead of watching continuously.
  -h, --help                  Show this help

The trigger is removed only after a fully successful run. A failed trigger is
kept so it can be inspected or retried by touching it again. Every stage's
docker output is both shown on the terminal and appended to its log file.
EOF
}

compose_file=''
service=''
watch_dir='.'
trigger_file='rebuild'
status_file=''
poll_seconds='2'
build_log=''
deploy_log=''
builder_mode='prune'
keep_storage='20GB'
builder_container_pattern='buildkit:buildx-stable'
builder_volume='buildx_buildkit_container0_state'
follow_logs=0
once=0

while (($# > 0)); do
  case "$1" in
    -f|--compose-file)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      compose_file=$2; shift 2 ;;
    -s|--service)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      service=$2; shift 2 ;;
    -w|--watch-dir)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      watch_dir=$2; shift 2 ;;
    -t|--trigger-file)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      trigger_file=$2; shift 2 ;;
    -o|--status-file)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      status_file=$2; shift 2 ;;
    -p|--poll)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      poll_seconds=$2; shift 2 ;;
    --build-log)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      build_log=$2; shift 2 ;;
    --deploy-log)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      deploy_log=$2; shift 2 ;;
    --builder-mode)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      builder_mode=$2; shift 2 ;;
    --keep-storage)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      keep_storage=$2; shift 2 ;;
    --builder-container-pattern)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      builder_container_pattern=$2; shift 2 ;;
    --builder-volume)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 2; }
      builder_volume=$2; shift 2 ;;
    --follow-logs)
      follow_logs=1; shift ;;
    --once)
      once=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2 ;;
  esac
done

[[ -n "$compose_file" ]] || { printf '%s\n' '--compose-file is required' >&2; usage >&2; exit 2; }
[[ -f "$compose_file" ]] || { printf 'Compose file does not exist: %s\n' "$compose_file" >&2; exit 2; }
[[ "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || { printf 'Invalid poll interval: %s\n' "$poll_seconds" >&2; exit 2; }
case "$builder_mode" in
  prune|nuke) ;;
  *) printf 'Invalid --builder-mode: %s (expected prune or nuke)\n' "$builder_mode" >&2; exit 2 ;;
esac

mkdir -p "$watch_dir"

if [[ "$trigger_file" = /* ]]; then
  trigger_path=$trigger_file
else
  trigger_path=$watch_dir/$trigger_file
fi

[[ -n "$status_file" ]] || status_file=$watch_dir/.affine-rebuild.status
[[ -n "$build_log" ]] || build_log=$watch_dir/docker-build.log
[[ -n "$deploy_log" ]] || deploy_log=$watch_dir/docker-deploy.log

trigger_name=${trigger_path##*/}
compose_args=(-f "$compose_file")
target_args=()
if [[ -n "$service" ]]; then
  target_args=("$service")
fi

status_tmp=''
stop_requested=0

cleanup() {
  if [[ -n "$status_tmp" ]]; then
    rm -f -- "$status_tmp"
  fi
}

request_stop() {
  stop_requested=1
  printf '\nStopping after the current operation...\n' >&2
}

trap request_stop INT TERM
trap cleanup EXIT

write_status() {
  local state=$1
  local message=$2
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  status_tmp=$(mktemp "${status_file}.tmp.XXXXXX")
  {
    printf 'state=%s\n' "$state"
    printf 'message=%s\n' "$message"
    printf 'updated=%s\n' "$now"
    printf 'pid=%s\n' "$BASHPID"
    printf 'compose_file=%s\n' "$compose_file"
    printf 'service=%s\n' "$service"
    printf 'watch_dir=%s\n' "$watch_dir"
    printf 'trigger_path=%s\n' "$trigger_path"
    printf 'build_log=%s\n' "$build_log"
    printf 'deploy_log=%s\n' "$deploy_log"
  } >"$status_tmp"
  mv -f -- "$status_tmp" "$status_file"
  status_tmp=''
}

run_compose() {
  docker compose "${compose_args[@]}" "$@"
}

# Every stage's stdout+stderr goes to BOTH the terminal (so you see the usual
# docker build stage output live) and its own log file, via `tee -a`.
# Every use of a bare `CMD | tee ...` pipeline below is deliberately followed
# by `|| true`: under this script's `set -e -o pipefail`, an unguarded failing
# pipeline used as a plain statement (not an `if`/`&&`/`||` condition) aborts
# the WHOLE script immediately via errexit, bypassing write_status/trigger
# handling entirely. recycle_builder() is inherently best-effort (a failure
# here should be logged, not fatal -- the actual build is what must succeed
# or fail cleanly), so `|| true` here is intentional, not a swallowed bug.
recycle_builder() {
  {
    printf '\n=== [%s] recycling buildx builder (mode=%s) ===\n' "$(date -u +%FT%TZ)" "$builder_mode"
  } | tee -a "$deploy_log" || true

  if [[ "$builder_mode" = nuke ]]; then
    local container_id
    container_id=$(docker container ls --format '{{.ID}} {{.Names}}' 2>&1 | grep -F "$builder_container_pattern" | awk '{print $1}' | head -n1 || true)
    if [[ -n "$container_id" ]]; then
      { docker container stop "$container_id" && docker container rm "$container_id"; } 2>&1 | tee -a "$deploy_log" || true
    else
      printf 'No running builder container matched pattern: %s (skipping stop/rm)\n' "$builder_container_pattern" | tee -a "$deploy_log" || true
    fi
    # A volume in use by a container that failed to remove above will fail
    # here too -- logged, not fatal, same reasoning as above.
    docker volume rm "$builder_volume" 2>&1 | tee -a "$deploy_log" || true
  else
    # Bounded prune: reclaims space without destroying the builder/volume, so
    # the layer cache the Dockerfile's staged COPY relies on can survive
    # across builds. Non-fatal if it errors (e.g. no builder yet on a fresh
    # host) -- that shouldn't block the build itself from being attempted.
    docker buildx prune --force --keep-storage "$keep_storage" 2>&1 | tee -a "$deploy_log" || true
  fi
}

# Runs one docker-compose stage, tee'ing its output to a log file, WITHOUT
# letting `set -e`/`pipefail` abort the whole script on failure -- the
# pipeline is the `if` condition itself (errexit's documented exemption),
# so a failure here is caught, status-recorded, and returned as a normal
# function failure instead of killing the watcher process outright.
run_stage() {
  local fail_message=$1 log_file=$2
  shift 2
  if ! "$@" 2>&1 | tee -a "$log_file"; then
    write_status failed "$fail_message"
    return 1
  fi
}

run_rebuild() {
  write_status recycling-builder 'Recycling the buildx builder before a fresh build.'
  recycle_builder

  write_status building 'Building the compose service(s).'
  {
    printf '\n=== [%s] docker compose build ===\n' "$(date -u +%FT%TZ)"
  } | tee -a "$build_log" || true
  export BUILDKIT_PROGRESS=plain
  run_stage 'Compose build failed; the trigger was retained.' "$build_log" \
    run_compose build "${target_args[@]}" || return 1
  unset BUILDKIT_PROGRESS

  write_status stopping 'Stopping the running stack.'
  run_stage 'Compose down failed; the trigger was retained.' "$deploy_log" \
    run_compose down || return 1

  write_status pulling 'Pulling any non-locally-built images.'
  run_stage 'Compose pull failed; the trigger was retained.' "$deploy_log" \
    run_compose pull || return 1

  write_status starting 'Starting the stack.'
  run_stage 'Compose up failed; the trigger was retained.' "$deploy_log" \
    run_compose up -d "${target_args[@]}" || return 1

  if [[ "$follow_logs" -eq 1 ]]; then
    write_status ready 'Rebuild succeeded; following logs (blocking -- Ctrl-C to return control).'
    rm -f -- "$trigger_path"
    run_compose logs -f "${target_args[@]}" 2>&1 | tee -a "$deploy_log" || true
    return 0
  fi

  run_compose logs --tail=200 "${target_args[@]}" 2>&1 | tee -a "$deploy_log" || true

  rm -f -- "$trigger_path"
  write_status ready 'Compose rebuild completed successfully; trigger removed.'
  return 0
}

trigger_signature() {
  if [[ -e "$trigger_path" ]]; then
    stat -c '%Y:%s' -- "$trigger_path" 2>/dev/null || stat -f '%m:%z' -- "$trigger_path"
  else
    printf '%s' absent
  fi
}

process_trigger() {
  [[ -e "$trigger_path" ]] || return 0
  [[ "$stop_requested" -eq 0 ]] || return 0
  printf '[%s] Trigger detected: %s\n' "$(date -u +%FT%TZ)" "$trigger_path"
  run_rebuild || true
}

command -v docker >/dev/null 2>&1 || { printf '%s\n' 'docker is required' >&2; exit 1; }
write_status waiting 'Watching for a rebuild trigger.'
printf 'Watching %s for %s using %s.\n' "$watch_dir" "$trigger_name" "$(command -v inotifywait >/dev/null 2>&1 && printf inotify || printf polling)"
printf 'Build log: %s\nDeploy log: %s\n' "$build_log" "$deploy_log"

last_signature=$(trigger_signature)
process_trigger
last_signature=$(trigger_signature)

if [[ "$once" -eq 1 ]]; then
  exit 0
fi

while [[ "$stop_requested" -eq 0 ]]; do
  if command -v inotifywait >/dev/null 2>&1; then
    event=$(inotifywait -q -e close_write,moved_to,create --format '%f' "$watch_dir" 2>/dev/null || true)
    [[ "$event" = "$trigger_name" ]] || continue
    process_trigger
  else
    sleep "$poll_seconds"
    current_signature=$(trigger_signature)
    if [[ "$current_signature" != "$last_signature" ]]; then
      process_trigger
      last_signature=$(trigger_signature)
    fi
  fi
done

write_status stopped 'Watcher stopped.'
