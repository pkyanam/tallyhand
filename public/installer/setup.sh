#!/usr/bin/env bash
# Install or update the Tallyhand CLI. Never changes your configuration or data.
# Inspect first: curl -fsSL https://tallyhand.xyz/setup.sh -o setup.sh
# Run: curl -fsSL https://tallyhand.xyz/setup.sh | bash
set -euo pipefail
main() (
  local repo='https://github.com/pkyanam/tallyhand' dest="${TALLY_BIN_DIR:-$HOME/.local/bin}"
  local target version="${TALLY_VERSION:-}" url tmp expected actual current
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) target=tally-linux-x64 ;;
    Linux/aarch64|Linux/arm64) target=tally-linux-arm64 ;;
    Darwin/arm64) target=tally-macos-arm64 ;;
    Darwin/x86_64) target=tally-macos-x64 ;;
    *) printf 'Unsupported platform. See https://tallyhand.xyz/docs for source installation.\n' >&2; return 1 ;;
  esac
  command -v curl >/dev/null || { echo 'curl is required.' >&2; return 1; }
  if command -v sha256sum >/dev/null; then hash() { sha256sum "$1" | awk '{print $1}'; }
  elif command -v shasum >/dev/null; then hash() { shasum -a 256 "$1" | awk '{print $1}'; }
  else echo 'sha256sum or shasum is required.' >&2; return 1; fi
  if [ -z "$version" ]; then
    url=$(curl --proto '=https' --proto-redir '=https' -fsSL --retry 2 --connect-timeout 15 --max-time 60 -o /dev/null -w '%{url_effective}' "$repo/releases/latest")
    case "$url" in "$repo/releases/tag/"*) version="${url##*/}" ;; *) echo 'Could not resolve latest release.' >&2; return 1 ;; esac
  fi
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || { echo 'Invalid release version.' >&2; return 1; }
  mkdir -p "$dest"
  [ ! -L "$dest/tally" ] || { echo 'Existing tally is a symlink. Update it with its original package manager or choose TALLY_BIN_DIR.' >&2; return 1; }
  mkdir "$dest/.tally-install-lock" 2>/dev/null || { echo 'Another install is running. If interrupted, remove .tally-install-lock from the install directory.' >&2; return 1; }
  tmp=$(mktemp -d "$dest/.tally-install.XXXXXX") || { rmdir "$dest/.tally-install-lock"; return 1; }
  trap 'rm -rf -- "$tmp"; rmdir "$dest/.tally-install-lock" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  url="$repo/releases/download/$version"
  printf 'Installing Tallyhand %s (%s)…\n' "$version" "$target"
  curl --proto '=https' --proto-redir '=https' -fsSL --retry 2 --connect-timeout 15 --max-time 60 "$url/SHA256SUMS" -o "$tmp/SHA256SUMS"
  expected=$(awk -v target="$target" '$2 == target || $2 == "*" target {print $1}' "$tmp/SHA256SUMS")
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Missing or invalid release checksum. Existing installation preserved.' >&2; return 1; }
  current=''
  if [ -f "$dest/tally" ]; then current=$(hash "$dest/tally"); fi
  if [ "$current" = "$expected" ] && [ -x "$dest/tally" ]; then
    echo 'Already up to date.'
  else
    curl --proto '=https' --proto-redir '=https' -fsSL --retry 2 --connect-timeout 15 --max-time 300 "$url/$target" -o "$tmp/tally"
    actual=$(hash "$tmp/tally")
    [ "$actual" = "$expected" ] || { echo 'Checksum mismatch. Existing installation preserved.' >&2; return 1; }
    chmod 755 "$tmp/tally"
    "$tmp/tally" --help > "$tmp/help"
    grep -q 'Usage:' "$tmp/help" || { echo 'CLI smoke check failed. Existing installation preserved.' >&2; return 1; }
    mv -f "$tmp/tally" "$dest/tally"
    echo 'CLI installed successfully.'
  fi
  rm -rf -- "$tmp"; rmdir "$dest/.tally-install-lock"; trap - EXIT INT TERM
  printf '\nYour saved credentials and workspace data were left untouched.\n'
  case ":$PATH:" in *":$dest:"*) ;; *) printf 'Add this directory to PATH in your shell profile:\n  export PATH="%s:$PATH"\n' "$dest" ;; esac
  printf '\nNext: tally config set api-url https://tallyhand.xyz\nThen: tally login\nCheck: tally doctor\nHelp: https://tallyhand.xyz/docs\n'
)
# Parse the complete script before executing, so interrupted downloads do not partially install.
main "$@"
