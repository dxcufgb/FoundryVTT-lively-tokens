#!/usr/bin/env bash
# Packages the module the way a release ships it. Used by release.yml and dry-run by ci.yml.
#
#   .github/ci/package.sh v1.2.3
#
# Stamps version and URLs into module.json from the tag, builds module.zip and checks that
# everything module.json references is in the zip and that no git/CI files are.
# Needs GITHUB_REPOSITORY (owner/repo), jq and zip.
set -euo pipefail

TAG="${1:?usage: package.sh <tag like v1.2.3>}"
case "$TAG" in v[0-9]*) ;; *) echo "Tag '$TAG' must look like v1.2.3" >&2; exit 1 ;; esac
VERSION="${TAG#v}"
REPO_URL="https://github.com/${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

jq \
  --arg version  "$VERSION" \
  --arg url      "$REPO_URL" \
  --arg manifest "${REPO_URL}/releases/latest/download/module.json" \
  --arg download "${REPO_URL}/releases/download/${TAG}/module.zip" \
  '.version = $version | .url = $url | .manifest = $manifest | .download = $download
   | .bugs = ($url + "/issues") | .readme = ($url + "#readme")' \
  module.json > module.tmp.json
jq -e --arg v "$VERSION" '.version == $v' module.tmp.json >/dev/null
mv module.tmp.json module.json

rm -f module.zip
zip -qr module.zip . -x ".git/*" ".github/*" ".gitignore" ".gitattributes" "module.zip" "*.tmp.json"
echo "Contents of module.zip:"
unzip -l module.zip

zipinfo -1 module.zip > "${RUNNER_TEMP:-/tmp}/zip-contents.txt"
missing=0
for f in module.json $(jq -r '[.esmodules[]?, .scripts[]?, (.styles[]? | if type == "object" then .src else . end), .languages[]?.path, .packs[]?.path] | .[]' module.json); do
  grep -qx "$f" "${RUNNER_TEMP:-/tmp}/zip-contents.txt" || grep -q "^$f/" "${RUNNER_TEMP:-/tmp}/zip-contents.txt" || { echo "missing from module.zip: $f"; missing=1; }
done
if grep -qE '^\.git(hub)?/' "${RUNNER_TEMP:-/tmp}/zip-contents.txt"; then echo ".git or .github ended up in module.zip"; missing=1; fi
exit $missing
