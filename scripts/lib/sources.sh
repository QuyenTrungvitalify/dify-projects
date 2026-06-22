#!/usr/bin/env bash
# Shared bash reader for corpus/sources.yml — the single source registry (spec 022 D1).
#
# The registry is real YAML but constrained to a grep/awk-parseable subset (flat scalars,
# `sparse` as a single-line list) so it can be read WITHOUT a venv or `yq` at bootstrap time
# (setup.sh clones corpus BEFORE the venv exists). Python consumers use tools/dify_base/sources.py;
# both read the same file. One schema, two parsers.
#
# Usage:
#   . scripts/lib/sources.sh
#   while IFS='|' read -r name repo ref sparse glob license; do ... ; done < <(sources_list corpus/sources.yml)
#
# sources_list <sources.yml>
#   Emits one pipe-delimited line per source: name|repo|ref|sparse|dsl_glob|license
#   `sparse` is comma-joined if multiple (e.g. "DSL,assets"). Comments + blank lines are ignored.

sources_list() {
    local file="${1:?usage: sources_list <sources.yml>}"
    [ -f "$file" ] || return 0
    awk '
        function val(line,   v) {
            v = line
            sub(/^[^:]*:[[:space:]]*/, "", v)     # strip "key:" + leading whitespace
            sub(/[[:space:]]+#.*$/, "", v)         # strip trailing " # comment" (YAML needs the space)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
            return v
        }
        function flush() {
            if (name != "")
                printf "%s|%s|%s|%s|%s|%s\n", name, repo, ref, sparse, glob, license
            name=""; repo=""; ref=""; sparse=""; glob=""; license=""
        }
        /^[[:space:]]*#/                  { next }
        /^[[:space:]]*-[[:space:]]*name:/ { flush(); name = val($0); next }
        /^[[:space:]]+repo:/              { repo = val($0); next }
        /^[[:space:]]+ref:/               { ref = val($0); next }
        /^[[:space:]]+sparse:/ {
            s = val($0); gsub(/[\[\]]/, "", s); gsub(/[[:space:]]*,[[:space:]]*/, ",", s); gsub(/[[:space:]]+/, "", s)
            sparse = s; next
        }
        /^[[:space:]]+dsl_glob:/ { g = val($0); gsub(/"/, "", g); glob = g; next }
        /^[[:space:]]+license:/  { license = val($0); next }
        END { flush() }
    ' "$file"
}
