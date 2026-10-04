# Agent Lab

3D Agent Lab page wired to your Claude Code subagents.

    npm install
    npm start          # http://localhost:3210/?live

- Agents are read on every run from `~/.claude/agents/{coordinator,researcher,developer,reviewer}.md`
  (override the folder with `AGENT_LAB_AGENTS_DIR`). Auth is whatever Claude Code uses on this machine
  (`claude` login or `ANTHROPIC_API_KEY`).
- Flow follows `~/.claude/commands/lab.md`: coordinator -> researcher (only if RESEARCH has items) ->
  developer -> reviewer (unless SKIP names it); one FIX loop max. Nothing ships until you approve in the page.
- Jobs are saved as JSON in `data/jobs/` and unfinished ones resume on restart.
- Safety defaults: Read/Grep/Glob are limited to `data/work/job-N/`; Bash is denied
  (`AGENT_LAB_ALLOW_BASH=1` to allow); the developer has no tools unless `AGENT_LAB_DEV_TOOLS=Read,...`.
- Other env: `PORT`, `AGENT_LAB_MODEL`, `AGENT_LAB_STAGE_TIMEOUT_MS`, `AGENT_LAB_MAX_TURNS`.
- `index.original.html` is the untouched page; `public/index.html` is it plus the `?live` bridge hooks.
