#!/usr/bin/env bash
# CI-only fixtures verify reruns, updates, preservation and failed-download safety.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/tools" "$tmp/home/.tallyhand" "$tmp/release"
printf '{"token":"fixture-not-a-real-key"}\n' > "$tmp/home/.tallyhand/config.json"
cp "$tmp/home/.tallyhand/config.json" "$tmp/config-before"
cat > "$tmp/tools/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
url=''; out=''
while [ "$#" -gt 0 ]; do
 case "$1" in
   -o) out="$2"; shift 2 ;;
   --proto|--proto-redir|--retry|--connect-timeout|--max-time|-w) shift 2 ;;
   https://*) url="$1"; shift ;;
   *) shift ;;
 esac
done
if [[ "$url" == */releases/latest ]]; then printf 'https://github.com/pkyanam/tallyhand/releases/tag/v0.2.0'; exit; fi
if [[ "$url" == */SHA256SUMS ]]; then
  if [ "${BAD_CHECKSUM:-0}" = 1 ]; then printf '%064d  tally-linux-x64\n' 0 > "$out"; else cp "$FIXTURE/SHA256SUMS" "$out"; fi
else cp "$FIXTURE/tally-linux-x64" "$out"; fi
CURL
cat > "$tmp/tools/uname" <<'UNAME'
#!/usr/bin/env bash
if [ "$1" = -s ]; then echo Linux; else echo x86_64; fi
UNAME
chmod +x "$tmp/tools/"*
export HOME="$tmp/home" PATH="$tmp/tools:$PATH" FIXTURE="$tmp/release" TALLY_BIN_DIR="$tmp/bin space"
make_release() {
 printf '#!/usr/bin/env bash\necho "Usage: tally %s"\n' "$1" > "$FIXTURE/tally-linux-x64"
 (cd "$FIXTURE"; sha256sum tally-linux-x64 > SHA256SUMS)
}
make_release first
bash "$root/public/setup.sh"
cmp "$TALLY_BIN_DIR/tally" "$FIXTURE/tally-linux-x64"
bash "$root/public/setup.sh" > "$tmp/rerun"
grep -q 'Already up to date' "$tmp/rerun"
make_release updated
bash "$root/public/setup.sh"
cmp "$TALLY_BIN_DIR/tally" "$FIXTURE/tally-linux-x64"
cp "$TALLY_BIN_DIR/tally" "$tmp/before-failure"
if BAD_CHECKSUM=1 bash "$root/public/setup.sh"; then echo 'Bad checksum accepted'; exit 1; fi
cmp "$TALLY_BIN_DIR/tally" "$tmp/before-failure"
cmp "$HOME/.tallyhand/config.json" "$tmp/config-before"
[ ! -d "$TALLY_BIN_DIR/.tally-install-lock" ]
cmp "$root/public/setup.sh" "$root/public/installer/setup.sh"
echo 'Installer regression checks passed.'
