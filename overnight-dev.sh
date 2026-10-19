#!/bin/bash
cd "$(dirname "$0")"

if [ "$(git branch --show-current)" != "dev" ]; then
  echo "refusing to run: not on the dev branch (run this from a dev checkout/worktree)" >&2
  exit 1
fi

PROMPT='You are continuing the project described in SPEC_DEV.md, working autonomously with no human available, on the `dev` branch only.

1. Read SPEC_DEV.md and PROGRESS_DEV.md (create PROGRESS_DEV.md if missing, with a phase plan derived from SPEC_DEV.md, continuing the phase numbers used there).
2. Confirm you are on the dev branch (git branch --show-current). Never touch main, never edit SPEC.md/PROGRESS.md/FINAL_REPORT.md/DONE (those belong to the frozen main-branch submission).
3. Pick the next unfinished phase and implement it completely.
4. Run npm test (and npm run build if it exists). Fix failures before moving on. All pre-existing tests must still pass.
5. Update PROGRESS_DEV.md: what you finished, test results, known issues, and the next step.
6. git add -A && git commit -m "<short summary>".
7. Never start a server that keeps running; if you need to check it, start it, test it, then kill it.
8. If a phase is listed under "Explicitly out of scope" in SPEC_DEV.md, do not implement it — leave a note in PROGRESS_DEV.md instead and move to the next phase.
9. When every phase in SPEC_DEV.md is done or documented as blocked, and npm test passes fully, write FINAL_REPORT_DEV.md containing the full npm test output and how to exercise each new feature manually. Then create an empty file named DONE_DEV.

Do not ask questions. If something in SPEC_DEV.md is ambiguous, choose the most reasonable option and note it in PROGRESS_DEV.md.'

while [ ! -f DONE_DEV ]; do
  echo "=== $(date): starting round ===" >> overnight-dev.log
  output=$(claude -p "$PROMPT" --dangerously-skip-permissions 2>&1)
  echo "$output" >> overnight-dev.log

  if echo "$output" | grep -qi "usage limit\|limit reached\|rate limit"; then
    echo "$(date): hit usage limit, sleeping 5 hours" >> overnight-dev.log
    sleep 18000
  else
    sleep 60
  fi
done

echo "$(date): DONE_DEV file found, stopping" >> overnight-dev.log
