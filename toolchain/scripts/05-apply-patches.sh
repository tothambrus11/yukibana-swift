#!/usr/bin/env bash
# Stage 05 — apply Yukibana's patch series to the LLVM checkout.
#
# Every patch here exists because a POSIX facility LLVM assumes is simply absent on
# wasm32-wasip1 (processes, signals, sockets, resource limits, setjmp). They are
# deliberately small and guarded on __wasi__ so they stay upstreamable and so a native
# build of the same tree is bit-for-bit unaffected.
#
# Idempotent: patches already applied are skipped.
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"

PATCH_DIR="${YUKIBANA_ROOT}/toolchain/patches/llvm"
shopt -s nullglob
patches=("${PATCH_DIR}"/*.patch)
[[ ${#patches[@]} -gt 0 ]] || { log "no patches to apply"; exit 0; }

cd "$LLVM_SRC"
for patch in "${patches[@]}"; do
  name="$(basename "$patch")"
  if git apply --reverse --check "$patch" >/dev/null 2>&1; then
    log "already applied: ${name}"
  elif git apply --check "$patch" >/dev/null 2>&1; then
    git apply "$patch"
    log "applied: ${name}"
  else
    die "cannot apply ${name} to $(git -C "$LLVM_SRC" describe --tags --always)"
  fi
done
