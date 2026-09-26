#!/usr/bin/env bash
#
# Tallyhand installer — interactive, idempotent, pure bash.
#
#   curl -fsSL https://raw.githubusercontent.com/pkyanam/tallyhand/main/install.sh | bash
#   # or locally:
#   ./install.sh
#
# curl|bash works: prompts reopen /dev/tty, and when the script isn't running
# from a checkout it clones the repo into ./tallyhand (or $TALLYHAND_DIR).
#
# Three paths:
#   0. tally CLI binary — downloads the prebuilt `tally` binary for your
#      platform from the latest GitHub Release. No Node, git, or Docker
#      needed. The CLI talks to a Tallyhand server (local or hosted).
#   1. Local  — SQLite + no auth, zero-config single-user. No Docker needed.
#   2. Hosted — Docker Compose + Postgres, with Clerk or builtin magic-link auth.
#
# Re-runs are safe: an existing .env is detected and you choose Update / Fresh
# install / Start services / Quit. Existing .env files are backed up before
# any overwrite. `docker compose up` itself is idempotent.
#
set -euo pipefail

# Interactive prompts need a terminal. Under `curl ... | bash`, stdin is the
# pipe — reopen the controlling terminal so ask/choose still work.
if [ ! -t 0 ]; then
  # Probe in a subshell first: a failed </dev/tty redirection prints to the
  # shell's ORIGINAL stderr before 2>/dev/null applies, so test quietly here
  # and only then reopen stdin for real.
  if (exec </dev/tty) 2>/dev/null; then
    exec </dev/tty
    printf '\033[33m  ! stdin is a pipe (curl|bash?) — reading answers from your terminal\033[0m\n' >&2
  else
    printf '\033[31m  ✗ This installer is interactive and found no terminal.\033[0m\n' >&2
    printf '      Run it in a terminal:  ./install.sh\n' >&2
    exit 1
  fi
fi

REPO_URL_DEFAULT="https://github.com/pkyanam/tallyhand.git"
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  # Running from a checkout (./install.sh).
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  # Piped (curl|bash): no script file — work in an explicit target dir,
  # cloning the repo when it isn't already there.
  ROOT="${TALLYHAND_DIR:-$HOME/tallyhand}"
  if [ ! -f "$ROOT/package.json" ]; then
    command -v git >/dev/null 2>&1 || {
      printf '\033[31m  ✗ git is required to fetch Tallyhand.\033[0m\n' >&2
      printf '      git clone <repo> %s\n' "$ROOT" >&2
      exit 1
    }
    REPO_URL="${TALLYHAND_REPO:-$REPO_URL_DEFAULT}"
    printf '\n\033[1mCloning Tallyhand → %s\033[0m\n' "$ROOT"
    printf '  repo [%s]: ' "$REPO_URL" >&2
    IFS= read -r answer || true
    [ -n "$answer" ] && REPO_URL="$answer"
    git clone "$REPO_URL" "$ROOT"
  fi
fi
ENV_FILE="$ROOT/.env"
COMPOSE_FILE="$ROOT/deploy/docker-compose.yml"

# ------------------------------------------------------------------ helpers

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ask VAR "prompt" "default"
ask() {
  local var="$1" prompt="$2" default="${3:-}" answer
  if [ -n "$default" ]; then
    read -r -p "  $prompt [$default]: " answer || true
    printf -v "$var" '%s' "${answer:-$default}"
  else
    read -r -p "  $prompt: " answer || true
    printf -v "$var" '%s' "$answer"
  fi
}

# ask_secret VAR "prompt" — silent input; keeps existing value on empty
ask_secret() {
  local var="$1" prompt="$2" answer current
  current="$(env_value "$var" 2>/dev/null || true)"
  if [ -n "$current" ]; then
    read -r -s -p "  $prompt [kept — press enter to keep]: " answer || true; echo
    [ -n "$answer" ] && printf -v "$var" '%s' "$answer" || printf -v "$var" '%s' "$current"
  else
    read -r -s -p "  $prompt: " answer || true; echo
    printf -v "$var" '%s' "$answer"
  fi
}

# choose VAR "prompt" "opt1" "opt2" ... — numbered menu, defaults to 1
choose() {
  local var="$1"; shift
  local prompt="$1"; shift
  local i=1 n
  echo "  $prompt"
  for opt in "$@"; do printf '    %d) %s\n' "$i" "$opt"; i=$((i+1)); done
  n=$(($#-0))
  local answer
  read -r -p "  Choice [1]: " answer || true
  answer="${answer:-1}"
  if ! [[ "$answer" =~ ^[0-9]+$ ]] || [ "$answer" -lt 1 ] || [ "$answer" -gt "$n" ]; then
    die "Invalid choice: $answer"
  fi
  i=1
  for opt in "$@"; do
    if [ "$i" = "$answer" ]; then printf -v "$var" '%s' "$opt"; return; fi
    i=$((i+1))
  done
}

gen_secret() { # 32 random bytes as hex (64 chars)
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

env_value() { # env_value KEY — print value from existing .env (or empty)
  local key="$1" line
  [ -f "$ENV_FILE" ] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  printf '%s' "${line#*=}"
}

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }

COMPOSE_PROFILE_ARGS=()

# Set COMPOSE_PROFILE_ARGS from the configured storage backend: the bundled
# Postgres service lives behind the "postgres" compose profile, so Convex
# and external-DB deployments don't start a database they never use.
set_compose_profile() {
  local storage="${1:-$(env_value TALLY_STORAGE || echo postgres)}"
  if [ "$storage" = "postgres" ]; then
    COMPOSE_PROFILE_ARGS=(--profile postgres)
  else
    COMPOSE_PROFILE_ARGS=()
  fi
}

compose() { docker compose "${COMPOSE_PROFILE_ARGS[@]}" -f "$COMPOSE_FILE" "$@"; }

containers_exist() {
  docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null | grep -q .
}

backup_env() {
  if [ -f "$ENV_FILE" ]; then
    local bak="$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
    cp "$ENV_FILE" "$bak"
    info "Backed up existing .env → $(basename "$bak")"
  fi
}

# write_env KEY=VALUE ... — idempotent: updates keys in place, appends new ones
# (last occurrence wins; untouched keys keep first occurrence; file mode 600).
# Implemented with awk (POSIX, macOS-safe) — no bash 4 associative arrays.
write_env() {
  local pairs src kv
  pairs="$(mktemp)"; src="$(mktemp)"
  for kv in "$@"; do printf '%s\n' "$kv" >> "$pairs"; done
  if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$src"; else : > "$src"; fi
  awk -v pairs="$pairs" '
    BEGIN {
      np = 0
      while ((getline line < pairs) > 0) {
        i = index(line, "=")
        k = substr(line, 1, i - 1); v = substr(line, i + 1)
        if (!(k in val)) order[np++] = k
        val[k] = v
      }
      close(pairs)
    }
    {
      i = index($0, "=")
      if (i == 0) { print; next }
      k = substr($0, 1, i - 1)
      if (k in val) {
        if (!(k in emitted)) { print k "=" val[k]; emitted[k] = 1 }
      } else if (!(k in kepts)) {
        print; kepts[k] = 1
      }
    }
    END {
      for (i = 0; i < np; i++) {
        k = order[i]
        if (!(k in emitted)) print k "=" val[k]
      }
    }
  ' "$src" > "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
  rm -f "$pairs" "$src"
  chmod 600 "$ENV_FILE"
}

# ------------------------------------------------------------- re-run logic

say "Tallyhand installer"

choose INSTALL_KIND "What would you like to set up?" \
  "tally CLI binary — instant, no Node/git/Docker (needs a Tallyhand server URL)" \
  "Full app setup — local SQLite or hosted Docker (interactive)"

# ============================================================== BINARY ===

if [[ "$INSTALL_KIND" == "tally CLI binary"* ]]; then
  say "tally CLI binary"
  need_cmd curl
  OS="$(uname -s)"; ARCH="$(uname -m)"
  case "$OS/$ARCH" in
    Linux/x86_64)   TARGET="tally-linux-x64" ;;
    Darwin/arm64)    TARGET="tally-macos-arm64" ;;
    Darwin/x86_64)   TARGET="tally-macos-x64" ;;
    MINGW*/x86_64|MSYS*/x86_64|CYGWIN*/x86_64) TARGET="tally-windows-x64.exe" ;;
    *) die "No prebuilt binary for $OS/$ARCH — see https://github.com/pkyanam/tallyhand/releases" ;;
  esac
  BIN_NAME="tally"; [[ "$TARGET" == *.exe ]] && BIN_NAME="tally.exe"
  DEST_DIR="${TALLY_BIN_DIR:-$HOME/.local/bin}"
  mkdir -p "$DEST_DIR"
  URL="https://github.com/pkyanam/tallyhand/releases/latest/download/$TARGET"
  info "Downloading $TARGET …"
  if ! curl -fsSL -o "$DEST_DIR/$BIN_NAME.tmp" "$URL"; then
    rm -f "$DEST_DIR/$BIN_NAME.tmp"
    die "Download failed. If no release is published yet, see https://github.com/pkyanam/tallyhand/releases"
  fi
  mv "$DEST_DIR/$BIN_NAME.tmp" "$DEST_DIR/$BIN_NAME"
  chmod +x "$DEST_DIR/$BIN_NAME"
  if "$DEST_DIR/$BIN_NAME" --help >/dev/null 2>&1; then
    info "Binary works ✓"
  else
    warn "Downloaded binary didn't pass its smoke test — try re-running."
  fi
  case ":$PATH:" in
    *":$DEST_DIR:"*) ;;
    *) warn "$DEST_DIR is not on your PATH — add it:  export PATH=\"$DEST_DIR:\$PATH\"" ;;
  esac

  say "Point it at your server"
  ask TALLY_API "Tallyhand server URL" "http://localhost:3000"
  ask_secret TALLY_TOKEN "API token (empty = none)"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$HOME/.tallyhand/config.json" "$TALLY_API" "$TALLY_TOKEN" <<'PYEOF'
import json, os, sys
p, api, tok = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = {"apiUrl": api}
if tok:
    cfg["token"] = tok
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
os.chmod(p, 0o600)
PYEOF
  else
    mkdir -p "$HOME/.tallyhand"
    if [ -n "$TALLY_TOKEN" ]; then
      printf '{\n  "apiUrl": "%s",\n  "token": "%s"\n}\n' "$TALLY_API" "$TALLY_TOKEN" > "$HOME/.tallyhand/config.json"
    else
      printf '{\n  "apiUrl": "%s"\n}\n' "$TALLY_API" > "$HOME/.tallyhand/config.json"
    fi
    chmod 600 "$HOME/.tallyhand/config.json"
  fi
  info "Config written to ~/.tallyhand/config.json (mode 600)"

  say "Done ✓"
  info "Try:  tally --help"
  info "      tally mcp        # MCP server over stdio for AI agents"
  info ""
  info "The CLI needs a running Tallyhand server — run the full installer"
  info "on your server (or locally) to get one."
  exit 0
fi

# ============================================================= RE-RUN ===

if [ -f "$ENV_FILE" ]; then
  info "Found an existing .env"
  if containers_exist; then info "Existing containers detected."; fi
  choose MODE "What would you like to do?" \
    "Update settings (keep containers & data)" \
    "Fresh install (backup .env, reconfigure from scratch)" \
    "Just start services" \
    "Quit"
  case "$MODE" in
    *Quit*) exit 0 ;;
    *start*) say "Starting services…"; set_compose_profile; compose up -d; compose ps; exit 0 ;;
    *Fresh*) backup_env; rm -f "$ENV_FILE" ;;
    *) info "Updating in place — press enter to keep any current value." ;;
  esac
fi

# ------------------------------------------------------------- choose mode

choose DEPLOY_MODE "Choose a deployment mode:" \
  "Local — SQLite, no auth, zero-config (this machine only)" \
  "Hosted — Docker Compose + Postgres, multi-user with login"

# ================================================================= LOCAL ===

if [[ "$DEPLOY_MODE" == Local* ]]; then
  say "Local mode"
  info "SQLite file backend, no login — just you and your data."
  ask TALLYHAND_DB_PATH "SQLite file path" "$(env_value TALLYHAND_DB_PATH || echo "$ROOT/data/tallyhand.db")"

  backup_env
  write_env \
    "TALLY_STORAGE=sqlite" \
    "TALLY_AUTH=none" \
    "TALLYHAND_DB_PATH=$TALLYHAND_DB_PATH"

  say "Done ✓"
  info "Config written to .env"
  info ""
  info "Next steps:"
  info "  1. npm install          # once"
  info "  2. npm run dev          # open http://localhost:3000"
  info ""
  info "Your data lives in: $TALLYHAND_DB_PATH"
  exit 0
fi

# ================================================================ HOSTED ===

say "Hosted mode"
need_cmd docker
need_cmd curl
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"

choose STORAGE "Storage backend:" \
  "Postgres via Docker Compose (recommended)" \
  "Convex (external — you run \`npx convex dev\` yourself)"

choose AUTH "Authentication:" \
  "Clerk (recommended hosted pick)" \
  "Builtin magic links (self-hosted, email)" \
  "None (not recommended for hosted — single user, no login)"

warn "Auth 'none' with hosted storage means anyone with the URL sees the data."
if [[ "$AUTH" == None* ]]; then
  ask CONFIRM "Type YES to continue without auth" ""
  [ "$CONFIRM" = "YES" ] || die "Aborted."
fi

ask APP_BASE_URL "Public base URL (used for login + share links)" \
  "$(env_value APP_BASE_URL || echo "http://localhost:3000")"
ask APP_PORT "Host port to publish the app on" "$(env_value APP_PORT || echo "3000")"

# secrets (generate when missing)
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
[ -z "$POSTGRES_PASSWORD" ] && POSTGRES_PASSWORD="$(gen_secret | cut -c1-32)"
TALLY_SHARE_SECRET="$(env_value TALLY_SHARE_SECRET)"
[ -z "$TALLY_SHARE_SECRET" ] || [ "${#TALLY_SHARE_SECRET}" -lt 32 ] && TALLY_SHARE_SECRET="$(gen_secret)"
info "Generated TALLY_SHARE_SECRET and POSTGRES_PASSWORD."

AUTH_ENV=none
if [[ "$AUTH" == Clerk* ]]; then
  AUTH_ENV=clerk
  say "Clerk setup"
  info "Create an app at https://dashboard.clerk.com → API Keys, then paste:"
  ask_secret CLERK_PUBLISHABLE_KEY "  CLERK_PUBLISHABLE_KEY"
  ask_secret CLERK_SECRET_KEY "  CLERK_SECRET_KEY"
  [ -z "${CLERK_PUBLISHABLE_KEY:-}" ] && die "CLERK_PUBLISHABLE_KEY is required."
  [ -z "${CLERK_SECRET_KEY:-}" ] && die "CLERK_SECRET_KEY is required."
  info "After first deploy: Clerk dashboard → pick a user → Public metadata → {\"role\":\"admin\"}."
elif [[ "$AUTH" == Builtin* ]]; then
  AUTH_ENV=builtin
  say "Builtin magic-link setup"
  BUILTIN_AUTH_SECRET="$(env_value BUILTIN_AUTH_SECRET)"
  if [ -z "$BUILTIN_AUTH_SECRET" ] || [ "${#BUILTIN_AUTH_SECRET}" -lt 32 ]; then
    BUILTIN_AUTH_SECRET="$(gen_secret)"; info "Generated BUILTIN_AUTH_SECRET."
  fi
  info "Optional SMTP — when skipped, login links print to the server logs"
  info "(docker compose logs app) for you to forward. Standard self-host fallback."
  ask SMTP_HOST "SMTP host (empty = log links instead)" "$(env_value SMTP_HOST)"
  if [ -n "${SMTP_HOST:-}" ]; then
    ask SMTP_PORT "SMTP port" "$(env_value SMTP_PORT || echo 587)"
    ask SMTP_USER "SMTP username" "$(env_value SMTP_USER)"
    ask_secret SMTP_PASS "SMTP password"
    ask SMTP_FROM "From address" "$(env_value SMTP_FROM || echo "tallyhand@${APP_BASE_URL#*://}")"
  fi
fi

STORAGE_ENV=postgres
CONVEX_URL_VAL=""
if [[ "$STORAGE" == Convex* ]]; then
  STORAGE_ENV=convex
  ask CONVEX_URL_VAL "CONVEX_URL (from \`npx convex dev\`)" "$(env_value CONVEX_URL)"
  [ -z "$CONVEX_URL_VAL" ] && die "CONVEX_URL is required for Convex storage."
fi

# ------------------------------------------------------------- write .env

backup_env
ENV_KV=(
  "TALLY_STORAGE=$STORAGE_ENV"
  "TALLY_AUTH=$AUTH_ENV"
  "APP_BASE_URL=$APP_BASE_URL"
  "APP_PORT=$APP_PORT"
  "TALLY_SHARE_SECRET=$TALLY_SHARE_SECRET"
  "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
)
if [ "$STORAGE_ENV" = "convex" ]; then
  ENV_KV+=("CONVEX_URL=$CONVEX_URL_VAL")
fi
if [ "$AUTH_ENV" = "clerk" ]; then
  ENV_KV+=("CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY:-}" "CLERK_SECRET_KEY=${CLERK_SECRET_KEY:-}")
elif [ "$AUTH_ENV" = "builtin" ]; then
  ENV_KV+=("BUILTIN_AUTH_SECRET=$BUILTIN_AUTH_SECRET")
  [ -n "${SMTP_HOST:-}" ] && ENV_KV+=(
    "SMTP_HOST=$SMTP_HOST" "SMTP_PORT=${SMTP_PORT:-587}"
    "SMTP_USER=${SMTP_USER:-}" "SMTP_PASS=${SMTP_PASS:-}"
    "SMTP_FROM=${SMTP_FROM:-}"
  )
fi
write_env "${ENV_KV[@]}"
say "Wrote .env ✓ (mode 600)"

# ------------------------------------------------------------- launch

set_compose_profile "$STORAGE_ENV"
say "Building and starting containers… (first build takes a few minutes)"
compose up -d --build

info "Waiting for the app to become healthy…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
  say "Tallyhand is up ✓"
else
  warn "The app didn't report healthy yet — check: docker compose -f $COMPOSE_FILE logs app"
fi

info ""
info "  App:        $APP_BASE_URL"
info "  Health:     $APP_BASE_URL/api/health"
if [ "$AUTH_ENV" = "builtin" ]; then
  info "  Sign in:    $APP_BASE_URL/login  (magic link → inbox, or server logs)"
  if [ -z "${SMTP_HOST:-}" ]; then
    warn "No SMTP: watch login links with: docker compose -f $COMPOSE_FILE logs -f app"
  fi
elif [ "$AUTH_ENV" = "clerk" ]; then
  info "  Sign in:    $APP_BASE_URL/login  (Clerk)"
fi
info "  Admin UI:   $APP_BASE_URL/settings/users"
info "  Share portal: $APP_BASE_URL/share/<token>"
info ""
info "Data persists in Docker volumes (pgdata, attachments). Re-run ./install.sh"
info "anytime to update settings without losing data."
