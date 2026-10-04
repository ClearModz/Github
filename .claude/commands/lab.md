---
description: Run a task through the Agent Lab crew (coordinator -> researcher -> developer -> reviewer)
argument-hint: <task>
---
Run this task through the Agent Lab crew: $ARGUMENTS

1. Use the coordinator subagent to plan it.
2. If the plan's RESEARCH section has items, use the researcher subagent on only those items. Otherwise skip it.
3. Use the developer subagent to produce the deliverable from the request, plan and findings.
4. Unless the plan's SKIP section skips review, use the reviewer subagent on the result. If it returns FIX, send the fixes to the developer once, then review once more. Never loop more than once.
5. Stop and present to me: the deliverable, the reviewer's verdict, and any remaining FIX items. I make the final go/no-go call. Do not commit, push, send or publish anything until I approve.
