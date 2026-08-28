#!/usr/bin/env bash
# Repo-pinned toolchain: where it lives, how the PATH is built, and which of the user's
# environment variables must NOT be allowed to reach it (spec 110 S1/S6).
#
# SOURCED, never executed:  . "$REPO_ROOT/scripts/lib/toolchain.sh"
# Callers: bootstrap.sh, update-and-run.sh, doctor.sh.
#
# The whole point of this file is that a machine which already has node/python installed for OTHER
# projects must neither be disturbed by this repo, nor able to disturb it. Both directions matter;
# the second one is the one that is easy to forget.

# BASH 3.2 — macOS ships 3.2 and the .command launcher runs /bin/bash, so everything here must work
# there. One trap in particular, hit for real on 2026-08-27: a bare `$VAR` immediately followed by a
# MULTIBYTE character (e.g. the fullwidth `）` used in the Japanese messages) is parsed by bash 3.2 as
# part of the variable NAME — `$NODE_VERSION）` became the variable `NODE_VERSION\357\274\211`, and
# `set -u` killed the launcher before it could start. ALWAYS brace it: `${NODE_VERSION}）`.
#
# ── The pin. ONE place. `bump-node.sh` rewrites these two lines together with the checksums. ──────
NODE_VERSION="22.23.2"     # LTS "Krypton". Must stay >= the `engines` field of BOTH package.json.
UV_VERSION="0.9.22"
PYTHON_VERSION="3.12"      # fetched BY uv, always a precompiled build — never compiled on this machine

# ── Layout — everything this repo installs lives under .toolchain/, so `rm -rf .toolchain` is a
#    complete uninstall. That promise is why UV_PYTHON_INSTALL_DIR is set below: uv's default
#    (~/.local/share/uv/python) is OUTSIDE the repo and would silently break it. ──────────────────
toolchain_dir() { printf '%s/.toolchain' "$1"; }

# Which prebuilt Node tarball this machine needs. Prints e.g. `darwin-arm64`, or fails with a
# message naming the platform we could not match.
node_platform() {
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64)   echo "darwin-arm64" ;;
        Darwin-x86_64)  echo "darwin-x64"   ;;
        Linux-x86_64)   echo "linux-x64"    ;;
        Linux-aarch64)  echo "linux-arm64"  ;;
        *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; return 1 ;;
    esac
}

# uv publishes per-target archives under a different naming scheme than Node's.
uv_target() {
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64)   echo "aarch64-apple-darwin"       ;;
        Darwin-x86_64)  echo "x86_64-apple-darwin"        ;;
        Linux-x86_64)   echo "x86_64-unknown-linux-gnu"   ;;
        Linux-aarch64)  echo "aarch64-unknown-linux-gnu"  ;;
        *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; return 1 ;;
    esac
}

# Is this shell running under Rosetta on Apple Silicon? Then `uname -m` says x86_64 and we would
# fetch the Intel build — it runs, just slowly, and nothing would ever say why (spec 110 Q7:
# report it, do not silently override the user's choice of shell).
under_rosetta() {
    [ "$(uname -s)" = "Darwin" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]
}

# ── S6 — the user's environment must not decide how this repo builds. ─────────────────────────────
# Every name here is on the list because it was REPRODUCED breaking this repo (spec 110 §1.8), not
# because it looked risky. Do not "tidy this away": it is load-bearing.
#
#   NODE_ENV=production  → `npm config get omit` returns `dev` → npm ci drops devDependencies →
#                          tsx/typescript/vite/vitest vanish → both builds fail with an error that
#                          never mentions NODE_ENV.                              (§1.8 R1)
#   PYTHONHOME           → .venv/bin/python dies in C with no Python traceback.  (§1.8 R2)
#   PYTHONPATH           → a sitecustomize.py anywhere on it is executed by the venv python. (§1.8 R3)
#   VIRTUAL_ENV/PYTHONSTARTUP/NODE_OPTIONS/npm_config_* → same class, not individually reproduced.
#
# `unset` rather than `export …=<value>`: clearing a variable restores the tool's own default, while
# picking a value would be choosing on the user's behalf — which is the habit this whole spec exists
# to break.
scrub_user_env() {
    unset NODE_ENV NODE_OPTIONS npm_config_prefix npm_config_production
    unset PYTHONHOME PYTHONPATH PYTHONSTARTUP VIRTUAL_ENV
    # A few machines set this globally; uv pip then refuses to touch our venv.
    export PIP_REQUIRE_VIRTUALENV=false
}
# NOT scrubbed on purpose: ~/.npmrc (registry / proxy / strict-ssl). A corporate machine may be
# REQUIRED to go through an internal registry, so overriding it silently would break a working
# machine to fix a hypothetical one. doctor.sh prints the effective registry instead (spec 110 Q6).

# Put the repo's own toolchain in front of everything, for THIS PROCESS ONLY. No rc file is touched,
# no global PATH is changed; the user's nvm/pyenv/brew keep owning their shell.
# `~/.local/bin` is appended for `claude`, which is deliberately NOT vendored (it self-updates and
# has no per-project version conflict — spec 110 S1).
use_toolchain() {
    local root="$1" tc; tc="$(toolchain_dir "$root")"
    scrub_user_env
    export PATH="$tc/node/bin:$tc/bin:$HOME/.local/bin:$PATH"
    export UV_PYTHON_INSTALL_DIR="$tc/python"   # keep `rm -rf .toolchain` a complete uninstall
}

# ── Single-instance lock ──────────────────────────────────────────────────────────────────────────
# Double-clicking the launcher twice is normal behaviour, not user error: the first run is slow and
# silent for a while. Two concurrent runs would write .toolchain/ and node_modules/ at once.
#
# SCOPE — read this before moving the lock. It guards the SETUP phase only (fetching the toolchain,
# npm ci, the builds). It must be released with `toolchain_unlock` before the app starts, because the
# launcher's whole restart story is "double-click again": step 1 kills whatever holds port 4123 and
# starts fresh. Holding the lock for the app's lifetime turns that into a refusal, and the user is
# left with a running app they cannot restart — measured for real on 2026-08-27, when the lock's
# first version wrapped `npm start` too.
# mkdir is the atomic primitive available in plain bash on both macOS and Linux.
# REENTRANT. The launcher takes the lock and then calls bootstrap.sh, which asks for the SAME lock —
# a non-reentrant version deadlocks the tool against itself, and does it on exactly the path that only
# runs when .toolchain/ is missing: every brand-new machine, and every existing machine updating for
# the first time. (Shipped that way on 2026-08-27 and it reached a user before any test did — the
# author machine was already bootstrapped, so the launcher always SKIPPED the bootstrap call.)
#
# Ownership rides in an exported pid rather than in the lock dir, so a child can tell "held by my own
# parent" from "held by another window". A child that inherits the lock must NOT release it: the
# owner's trap does that, and an early rm would unlock the parent while it is still working.
toolchain_lock() {
    local root="$1" tc lockdir pid tries=0
    if [ -n "${TOOLCHAIN_LOCK_OWNER:-}" ] && kill -0 "$TOOLCHAIN_LOCK_OWNER" 2>/dev/null; then
        return 0                       # inherited from a parent that already holds it
    fi

    tc="$(toolchain_dir "$root")"
    mkdir -p "$tc" 2>/dev/null || true
    lockdir="$tc/.lock"

    # Bounded, so a lock dir we can never create (read-only disk, wrong owner) fails loudly instead of
    # spinning forever.
    while [ "$tries" -lt 3 ]; do
        if mkdir "$lockdir" 2>/dev/null; then
            echo "$$" > "$lockdir/pid" 2>/dev/null || true
            export TOOLCHAIN_LOCK_OWNER=$$
            trap 'toolchain_unlock "'"$root"'"' EXIT INT TERM
            return 0
        fi
        pid="$(cat "$lockdir/pid" 2>/dev/null || echo '')"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 1                   # genuinely running in another window
        fi
        rm -rf "$lockdir" 2>/dev/null || true   # stale lock from a killed run
        tries=$((tries + 1))
    done
    return 1
}

# Release it early — see SCOPE above. Safe to call when no lock is held, and a NO-OP in a child that
# merely inherited the lock (only the owning process may release it).
toolchain_unlock() {
    local root="$1" tc
    [ "${TOOLCHAIN_LOCK_OWNER:-}" = "$$" ] || return 0
    tc="$(toolchain_dir "$root")"
    rm -rf "$tc/.lock" 2>/dev/null || true
    unset TOOLCHAIN_LOCK_OWNER
    trap - EXIT INT TERM
}
