#!/usr/bin/env bash
# Verify the deployed contracts on MonadVision, Socialscan and Monadscan with one API call each.
# Usage: pnpm verify            (reads deployments/monad-testnet.json, needs `forge`, `jq`, `curl`)
set -euo pipefail
cd "$(dirname "$0")/.."
DEP=deployments/monad-testnet.json
CHAIN=$(jq -r .chainId "$DEP")
TOKEN=$(jq -r .token "$DEP"); ANNOUNCER=$(jq -r .announcer "$DEP"); SETTLEMENT=$(jq -r .settlement "$DEP")
COMPILER="v0.8.28+commit.7893614a"

(cd contracts && forge build >/dev/null)

verify() { # name address [constructor-args-hex-without-0x]
  local name=$1 addr=$2 args=${3:-}
  local std meta body
  std=$(mktemp); meta=$(mktemp); body=$(mktemp)
  (cd contracts && forge verify-contract "$addr" "src/$name.sol:$name" --chain "$CHAIN" --show-standard-json-input) > "$std"
  jq '.metadata' "contracts/out/$name.sol/$name.json" > "$meta"
  jq -n --argjson chain "$CHAIN" --arg addr "$addr" --arg name "src/$name.sol:$name" --arg cv "$COMPILER" \
        --arg args "$args" --slurpfile std "$std" --slurpfile meta "$meta" \
    '{chainId:$chain, contractAddress:$addr, contractName:$name, compilerVersion:$cv,
      standardJsonInput:$std[0], foundryMetadata:$meta[0]} + (if $args=="" then {} else {constructorArgs:$args} end)' > "$body"
  echo "== $name $addr"
  curl -sS -X POST https://agents.devnads.com/v1/verify -H "Content-Type: application/json" -d @"$body"
  echo
}

verify MockPermitToken "$TOKEN"
verify StealthAnnouncer "$ANNOUNCER"
ARGS=$(cast abi-encode "constructor(address,address)" "$TOKEN" "$ANNOUNCER")
verify Settlement "$SETTLEMENT" "${ARGS#0x}"
