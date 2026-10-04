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

## Agents tab (live mode)
- **Live status**: for each agent, the exact job it is on (title, template, brief, time elapsed), what it is doing
  right now (e.g. `Loading skill "minimalist-ui"`, `Reading file`, `Fetching host`), the live output tail, its queue,
  and the last job it finished. Pause all / Resume all, per-agent Pause, Boost and Rush.
- **Instructions** edit the real agent files in `~/.claude/agents` (the previous version is kept as `<name>.md.bak`).
  "Reload from files" re-reads them.

## Deleting tasks
Every task has a Delete button (On the floor list, Results, the Agents tab queues, the 3D floor panel and the viewer).
The first click arms it ("Sure?"), the second deletes. Deleting a queued or running job cancels it: the agent
is stopped, its station is freed and the job file is removed. The viewer also has **Run again** for repeat jobs.
The browser tab title shows how many jobs are waiting for your approval.

## OmniRoute (save your Claude usage)
Agents tab -> **Model routing**: tick *Use OmniRoute*, paste the OmniRoute URL (default `http://localhost:20128`)
and your OmniRoute API key, pick a default model or combo (`auto` lets OmniRoute choose), and press Save, then
*Test it*. *Load models* lists what your OmniRoute offers. Optionally give each agent its own model
(for example a cheap combo for the Router and Reviewer, a stronger one for the Producer).
- OmniRoute must be running (`omniroute`). Agents then talk to it through `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`,
  so no Claude login is needed while it is on. Untick the box to go back to your Claude login.
- The key is stored in `data/settings.json` (private file, git-ignored) and is never sent back to the browser.
- In this mode the agents run with a clean environment and their own empty Claude config folder, so no Claude login
  or API key from your shell can be passed to the gateway.
- Environment overrides: `AGENT_LAB_OMNIROUTE=1|0`, `AGENT_LAB_OMNIROUTE_URL`, `AGENT_LAB_OMNIROUTE_KEY`, `AGENT_LAB_OMNIROUTE_MODEL`.
- Tool use (skills, file reads, web fetch) only works if the chosen model supports tool calling.
