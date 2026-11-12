#!/usr/bin/env bash
# Checks a pull request's branch name, commits and text against the
# contribution rules in AGENTS.md.
#
# Error messages name the rule that failed, never the text that matched,
# because CI logs on a public repository are public.
#
# Inputs (environment): BASE_SHA, HEAD_SHA, BRANCH, PR_TITLE, PR_BODY, and
# optionally BLOCKED_TERMS, an extended regular expression (for example
# `one|two|three`). It is kept in a repository secret, not in this file and
# not in a repository variable: Actions prints a step's environment in its
# log, and only secrets are masked there.
set -euo pipefail

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
: "${BRANCH:?BRANCH is required}"

failed=0
fail() {
  echo "::error::$1"
  failed=1
}

range="$BASE_SHA..$HEAD_SHA"

# Dependabot names its own branches and lists real package names in its
# titles, so it is held to the commit rules only.
dependabot=false
case "$BRANCH" in dependabot/*) dependabot=true ;; esac
messages=$(git log --format='%B' "$range")
pr_text=$(printf '%s\n%s\n' "${PR_TITLE:-}" "${PR_BODY:-}")

# Branch names follow <issue-number>-<slug> or <type>/<slug>.
if [ "$dependabot" = false ] &&
  ! grep -qE '^([0-9]+-[a-z0-9][a-z0-9-]*|(feat|fix|chore|docs|test|ci|refactor|perf|build|deps)/[a-z0-9][a-z0-9._-]*)$' <<<"$BRANCH"; then
  fail "The branch name does not follow <issue-number>-<slug> or <type>/<slug>. Rename the branch and open a new pull request."
fi

# Rebase onto main; never merge main into the branch.
if [ -n "$(git rev-list --merges "$range")" ]; then
  fail "The branch contains a merge commit. Rebase onto main instead of merging main into the branch."
fi

# Every commit is authored with a GitHub no-reply address.
while IFS= read -r email; do
  case "$email" in
    *@users.noreply.github.com) ;;
    *)
      fail "A commit is authored with an email address that is not a GitHub no-reply address."
      break
      ;;
  esac
done < <(git log --format='%ae' "$range")

# No attribution lines in commits or pull request text.
# Match whole attribution lines, not prose that mentions them: a trailer, or
# a line that opens with "generated with" after any emoji or punctuation.
attribution='^[[:space:]]*co-authored-by:|^[^[:alnum:]]*generated with'
if grep -qiE "$attribution" <<<"$messages"; then
  fail "A commit message contains a co-author trailer or a 'generated with' line."
fi
if grep -qiE "$attribution" <<<"$pr_text"; then
  fail "The pull request title or description contains a co-author trailer or a 'generated with' line."
fi

# Blocked terms, from a repository secret so this file does not list them.
if [ "$dependabot" = true ]; then
  :
elif [ -z "${BLOCKED_TERMS:-}" ]; then
  echo "::warning::The BLOCKED_TERMS secret is not available, so blocked terms were not checked."
else
  if grep -qiE "$BLOCKED_TERMS" <<<"$BRANCH"; then
    fail "The branch name contains a blocked term."
  fi
  if grep -qiE "$BLOCKED_TERMS" <<<"$messages"; then
    fail "A commit message contains a blocked term."
  fi
  if grep -qiE "$BLOCKED_TERMS" <<<"$pr_text"; then
    fail "The pull request title or description contains a blocked term."
  fi
fi

if [ "$failed" -eq 0 ]; then
  echo "Branch name, commits and pull request text follow the contribution rules."
fi
exit "$failed"
