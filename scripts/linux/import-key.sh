#!/usr/bin/env bash
# Imports $KEY (armored private key) and $PASSPHRASE for prompt-free gpg and rpmsign.
set -euo pipefail
: "${KEY:?LINUX_REPO_GPG_KEY is not set for this environment}"
install -d -m 700 ~/.gnupg
printf '%s' "${PASSPHRASE:-}" > ~/.gnupg/passphrase
# In gpg.conf rather than on the command line so rpmsign's gpg calls get it too.
printf 'pinentry-mode loopback\npassphrase-file %s\n' ~/.gnupg/passphrase > ~/.gnupg/gpg.conf
gpg --batch --import <<< "$KEY"
fpr=$(gpg --list-secret-keys --with-colons | awk -F: '$1 == "fpr" { print $10; exit }')
printf '%%_gpg_name %s\n%%_gpg_digest_algo sha256\n' "$fpr" > ~/.rpmmacros
