#!/usr/bin/env bash
# How many commits the pinned reviewer-MCP sha is behind the remote's current default
# branch — extracted from antagonistic-review.yml's "Pre-build the reviewer MCP" step so
# PIN_BEHIND is unit-testable against a real git fixture (tests/pin-staleness.test.ts)
# rather than only ever exercised inside a GitHub Actions runner.
#
# WHY THIS EXISTS. The workflow's clone of the reviewer MCP is not `git clone` — it is
# `git init` + `git remote add` + a depth-1 `git fetch origin <sha>` of one exact commit,
# which sets up no remote-tracking refs at all, `origin/HEAD` included. `git rev-list
# --count <sha>..origin/HEAD` against that clone therefore always failed with "unknown
# revision", falling into the caller's `2>/dev/null || echo '?'` on EVERY run — PIN_BEHIND
# read as unknown always, not only when it genuinely was. This script performs the fetch
# that clone never did, so the count can be real.
#
# HONEST FALLBACK, DELIBERATE. Any failure below — resolving the default branch, fetching
# it, or computing the count — prints '?' and exits 0. A pin whose staleness genuinely
# cannot be determined must read as unknown, never as a fabricated number, and never as 0
# (which would read as "up to date" and hide exactly the gap STDIO-661 exists to surface).
set -euo pipefail

clone_dir="${1:?usage: pin-staleness.sh <clone-dir> <pinned-sha>}"
pinned_sha="${2:?usage: pin-staleness.sh <clone-dir> <pinned-sha>}"

fail() {
  echo '?'
  exit 0
}

# The remote's default branch, resolved rather than assumed — ls-remote --symref reads
# it directly off the remote (HEAD -> refs/heads/<default>), so this works whatever the
# default branch is actually named, not only "main". Cheap: no objects transferred.
#
# `timeout 60`, matching every other outbound call in this script (both `git fetch`
# branches below) — this is the FIRST network call the script makes, and until now it
# was the one call left unwrapped: an unresponsive remote could hang this line
# indefinitely, defeating the "HONEST FALLBACK, DELIBERATE" contract above, which
# promises a bounded answer of either a real count or '?', never a hang.
#
# `|| true` on the assignment, deliberately — NOT a blanket error-swallow. Under
# `set -e`, a plain assignment `var="$(...)"` whose substitution fails aborts the script
# immediately, before the `[ -n "${symref:-}" ] || fail` check below ever runs (this is
# what produced the exit-128 crash this comment now documents: an unreachable remote or
# unresolvable pin killed the script outright instead of ever reaching the honest '?'
# fallback — the exact defect this script exists to prevent, reproduced in itself). A
# `timeout`-killed `git ls-remote` fails the exact same way (non-zero exit), so it takes
# the same `|| true` -> explicit-check -> `fail` path rather than reintroducing the
# abort. `|| true` only exempts THIS assignment from that abort so the explicit check on
# the very next line can run and route the failure to `fail` on purpose. `pipefail`
# still governs the pipe inside the substitution — a failed/timed-out `git ls-remote`
# piped into a succeeding `awk` is still reported as a failure, so this does not mask
# that either.
symref="$(cd "$clone_dir" && timeout 60 git ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/ {print $2; exit}')" || true
[ -n "${symref:-}" ] || fail
default_branch="${symref#refs/heads/}"
[ "$default_branch" != "$symref" ] || fail

# FULL history, not shallow — verified empirically against tests/pin-staleness.test.ts's
# fixture rather than assumed correct from memory. The clone this script runs against is
# already shallow (the caller's depth-1 fetch of $pinned_sha, which leaves $pinned_sha
# recorded in .git/shallow as a boundary with no known parents). A shallow fetch of the
# default branch on top of that (--depth 1, or any bounded depth chosen without knowing
# how far back $pinned_sha sits) produces a SECOND, disconnected shallow boundary at the
# branch tip: `git rev-list --count pinned_sha..new_tip` then cannot walk from new_tip
# back far enough to ever find pinned_sha, and silently undercounts (or fails) rather
# than reporting the real gap. `--unshallow` converts the clone to a complete repository
# first (deepening the existing shallow boundary as far back as the remote can go), then
# fetches the branch tip in the same operation, giving continuous, connected history from
# $pinned_sha through the branch tip. Costs more than a shallow fetch — the full history
# of the reviewer MCP's release branch, once, per gate run — but this is a small
# prose/config repository, not a monorepo: correctness of the reported number is worth
# more here than the extra seconds.
if [ -f "$clone_dir/.git/shallow" ]; then
  ( cd "$clone_dir" && timeout 60 git fetch --quiet --unshallow origin "$default_branch" ) 2>/dev/null || fail
else
  ( cd "$clone_dir" && timeout 60 git fetch --quiet origin "$default_branch" ) 2>/dev/null || fail
fi

# Same `|| true` reasoning as `symref` above: a non-existent `pinned_sha` makes
# `rev-list` fail, and without `|| true` that failure would abort the script here rather
# than reach the explicit numeric check on the next line.
count="$(cd "$clone_dir" && git rev-list --count "${pinned_sha}..FETCH_HEAD" 2>/dev/null)" || true
[ -n "${count:-}" ] || fail
# rev-list --count always prints a bare non-negative integer on success; anything else
# here means something upstream behaved unexpectedly, not that the count is genuinely
# unknown — still refuse to report it as fact.
case "$count" in
  *[!0-9]*) fail ;;
esac

echo "$count"
