#!/usr/bin/env bash
set -euo pipefail
version=8.30.0
sha=79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e
install_dir="${RUNNER_TEMP:-$(mktemp -d)}/gitleaks-install"
mkdir -p "$install_dir"
curl --fail --location --silent --show-error "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz" --output "$install_dir/archive.tar.gz"
echo "$sha  $install_dir/archive.tar.gz" | sha256sum --check --status
sudo tar --extract --gzip --file "$install_dir/archive.tar.gz" --directory /usr/local/bin gitleaks
gitleaks version
