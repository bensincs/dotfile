---
name: code-review
description: Review code changes for correctness, risk, maintainability, and missing tests. Use when asked to review a diff, PR, commit, or implementation.
---

# Code review

Be strict. Be specific. Do not praise.

## Goal
- Find real issues.
- Prioritize correctness, regressions, security, data loss, breaking changes, and maintainability.
- Ignore style nits unless they affect clarity or cause risk.

## Review mode
- Review only what was asked.
- Do not inspect unrelated files unless required to understand the change.
- Prefer diff-first review.
- If there is not enough context to verify something, say so plainly.

## Output
- Lead with findings.
- If there are no findings, say: `No material issues found.`
- Use this format:
  - `High:` blocking issue or likely bug
  - `Medium:` meaningful risk or maintainability problem
  - `Low:` minor issue worth fixing
- For each finding include:
  - what is wrong
  - why it matters
  - the exact file or area affected when known

## What to look for
- Broken logic
- Wrong assumptions
- Edge cases
- Missing error handling
- Unsafe shell usage
- Broken paths or quoting
- macOS or Homebrew compatibility issues
- Regressions in bootstrap or stow behavior
- Missing tests or missing manual verification when relevant

## Do not
- Rewrite the code unless asked.
- Invent issues.
- Pad the review.
- Turn the review into implementation work unless explicitly asked.
