#!/usr/bin/env bash
# (1.4.3) Signs the iPhone app's script update (update-manifest.cjs) with the project's own key - the keystore the Android
# app and module are signed with (release.yml: MODULE_KEYSTORE, and MODULE_KEYSTORE_PASSWORD, MODULE_KEY_ALIAS,
# MODULE_KEY_PASSWORD from the repository's secrets) - and checks the signature with the certificate built into the app
# (ios/update-cert.pem, or the one given) before anything is published. RSA PKCS#1 v1.5 over SHA-256: what the app
# checks (ios/App/ScriptStore.swift). The key's files made here are in a folder of their own, removed whatever happens.
# usage: ios/sign-update.sh <update.json> <out.sig> [certificate.pem]
set -euo pipefail
IN="$1"; OUT="$2"; CERT="${3:-$(cd "$(dirname "$0")" && pwd)/update-cert.pem}"
: "${MODULE_KEYSTORE:?}" "${MODULE_KEYSTORE_PASSWORD:?}" "${MODULE_KEY_ALIAS:?}" "${MODULE_KEY_PASSWORD:?}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
TL_P12_PASS="$(openssl rand -hex 24)"; export TL_P12_PASS
keytool -importkeystore -noprompt -srckeystore "$MODULE_KEYSTORE" -srcstorepass:env MODULE_KEYSTORE_PASSWORD -srcalias "$MODULE_KEY_ALIAS" \
  -srckeypass:env MODULE_KEY_PASSWORD -destkeystore "$T/k.p12" -deststoretype PKCS12 -deststorepass:env TL_P12_PASS -destkeypass:env TL_P12_PASS >/dev/null 2>&1
openssl pkcs12 -in "$T/k.p12" -nocerts -nodes -passin env:TL_P12_PASS -out "$T/k.pem" 2>/dev/null
openssl dgst -sha256 -sign "$T/k.pem" -out "$OUT" "$IN"
openssl x509 -in "$CERT" -pubkey -noout > "$T/pub.pem"
openssl dgst -sha256 -verify "$T/pub.pem" -signature "$OUT" "$IN" >/dev/null 2>&1 || { rm -f "$OUT"; echo "the update's signature does not match $CERT: not published"; exit 1; }
echo "signed $(basename "$IN") ($(wc -c < "$IN") bytes)"
