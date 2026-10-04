import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AGENT_FILE, type AgentKey } from './types.js';

export const AGENTS_DIR = process.env.AGENT_LAB_AGENTS_DIR ?? path.join(homedir(), '.claude', 'agents');
export const WORK_DIR = path.resolve(process.env.AGENT_LAB_WORK_DIR ?? path.join(import.meta.dirname, '..', 'data', 'work'));
const STAGE_TIMEOUT_MS = Number(process.env.AGENT_LAB_STAGE_TIMEOUT_MS ?? 10 * 60 * 1000);
const ALLOW_BASH = process.env.AGENT_LAB_ALLOW_BASH === '1';
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/* Skills: every folder with a SKILL.md in these dirs is offered to the agents named in SKILL_AGENTS
 * (via the SDK's Skill tool). Set AGENT_LAB_SKILLS=off to disable. */
const PROJECT_SKILLS = path.resolve(import.meta.dirname, '..', 'skills');
const SKILL_DIRS = (process.env.AGENT_LAB_SKILLS_DIRS ?? [PROJECT_SKILLS, path.join(homedir(), '.claude', 'skills')].join(path.delimiter)).split(path.delimiter).filter(Boolean);
const FETCH_HOSTS = (process.env.AGENT_LAB_FETCH_HOSTS ?? 'raw.githubusercontent.com').split(',').map(s => s.trim());
const SKILLS_ON = process.env.AGENT_LAB_SKILLS !== 'off';
const SKILL_AGENTS = (process.env.AGENT_LAB_SKILL_AGENTS ?? 'dev,review').split(',').map(s => s.trim());

/** Links the skill folders into the job's work dir, which is where the SDK discovers project skills. */
function linkSkills(cwd: string): string[] {
  const dest = path.join(cwd, '.claude', 'skills');
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const dir of SKILL_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const src = path.join(dir, name);
      if (!existsSync(path.join(src, 'SKILL.md')) || names.includes(name)) continue;
      try { symlinkSync(src, path.join(dest, name), 'dir'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      names.push(name);
    }
  }
  return names;
}

export interface AgentDef { name: string; description: string; tools: string[] | null; model?: string; prompt: string }

/** Re-read on every run so edits to ~/.claude/agents/*.md apply to the next job. */
export async function loadAgent(key: AgentKey): Promise<AgentDef> {
  const file = path.join(AGENTS_DIR, `${AGENT_FILE[key]}.md`);
  const raw = await readFile(file, 'utf8').catch(() => { throw new Error(`Missing agent file: ${file}`); });
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`Agent file has no --- frontmatter: ${file}`);
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return {
    name: fm.name ?? AGENT_FILE[key],
    description: fm.description ?? '',
    tools: fm.tools ? fm.tools.split(',').map(t => t.trim()).filter(Boolean) : null,
    model: fm.model && fm.model !== 'inherit' ? fm.model : undefined,
    prompt: m[2].trim()
  };
}

export interface RunResult { text: string; ms: number; model?: string }

/**
 * Runs one agent as a headless Claude Agent SDK session whose system prompt and tool list
 * come from the agent's .md file. Tools are sandboxed: Read/Grep/Glob only inside the job's
 * work dir, Bash denied unless AGENT_LAB_ALLOW_BASH=1, and an agent with no `tools:` line
 * (the developer) gets no tools unless AGENT_LAB_DEV_TOOLS lists some.
 */
export interface RunHooks { onText?: (t: string) => void; onSkill?: (name: string) => void; onActivity?: (text: string) => void; signal?: AbortSignal }

/** One-line, human description of a tool call for the Agents tab. */
function describeTool(name: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Skill': return `Loading skill "${str(input.skill)}"`;
    case 'Read': return `Reading ${path.basename(str(input.file_path)) || 'a file'}`;
    case 'Grep': case 'Glob': return 'Searching files';
    case 'WebFetch': { try { return `Fetching ${new URL(str(input.url)).hostname}`; } catch { return 'Fetching a web page'; } }
    case 'WebSearch': return `Searching the web: ${str(input.query).slice(0, 80)}`;
    default: return `Using ${name}`;
  }
}

export async function runAgent(key: AgentKey, prompt: string, jobId: number, hooks: RunHooks = {}): Promise<RunResult> {
  const onText = hooks.onText ?? (() => {});
  const onSkill = hooks.onSkill ?? (() => {});
  const onActivity = hooks.onActivity ?? (() => {});
  const def = await loadAgent(key);
  let tools = def.tools ?? (process.env.AGENT_LAB_DEV_TOOLS ? process.env.AGENT_LAB_DEV_TOOLS.split(',').map(s => s.trim()).filter(Boolean) : []);
  if (!ALLOW_BASH) tools = tools.filter(t => t !== 'Bash');
  const cwd = path.join(WORK_DIR, `job-${jobId}`);
  mkdirSync(cwd, { recursive: true });
  const useSkills = SKILLS_ON && SKILL_AGENTS.includes(key) && linkSkills(cwd).length > 0;
  const declared = new Set(tools);
  // Skills may need to read their own files and (web-design-guidelines) fetch rules from a pinned host.
  if (useSkills) tools = [...new Set([...tools, 'Skill', 'Read', 'WebFetch'])];
  const ac = new AbortController();
  if (hooks.signal) { if (hooks.signal.aborted) ac.abort(); else hooks.signal.addEventListener('abort', () => ac.abort(), { once: true }); }
  const timer = setTimeout(() => ac.abort(), STAGE_TIMEOUT_MS);
  const t0 = Date.now();
  let streamed = '';
  let final: string | null = null;
  let model: string | undefined;
  try {
    const q = query({
      prompt,
      options: {
        systemPrompt: def.prompt,
        tools,
        cwd,
        settingSources: useSkills ? ['project'] : [],
        ...(useSkills ? { skills: 'all' as const } : {}),
        persistSession: false,
        includePartialMessages: true,
        maxTurns: Number(process.env.AGENT_LAB_MAX_TURNS ?? 25),
        model: def.model ?? process.env.AGENT_LAB_MODEL,
        abortController: ac,
        permissionMode: 'default',
        canUseTool: async (name, input) => {
          if (!tools.includes(name)) return { behavior: 'deny', message: `${name} is not enabled for ${def.name}.` };
          if (name === 'WebFetch' && !declared.has('WebFetch')) {
            let host = '';
            try { host = new URL(String(input.url)).hostname; } catch { /* denied below */ }
            if (!FETCH_HOSTS.includes(host)) return { behavior: 'deny', message: `WebFetch is limited to: ${FETCH_HOSTS.join(', ')}.` };
          }
          if (READ_TOOLS.has(name)) {
            const p = (input.file_path ?? input.path) as string | undefined;
            if (p && !path.resolve(cwd, p).startsWith(cwd + path.sep) && path.resolve(cwd, p) !== cwd)
              return { behavior: 'deny', message: 'Reads are limited to the job work folder.' };
          }
          return { behavior: 'allow', updatedInput: input };
        }
      }
    });
    for await (const m of q) {
      if (m.type === 'stream_event') {
        const ev = m.event as { type?: string; delta?: { type?: string; text?: string } };
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) { streamed += ev.delta.text; onText(streamed); }
        else if (ev.type === 'message_start') streamed = '';
      } else if (m.type === 'assistant') {
        for (const b of (m.message?.content ?? []) as { type: string; name?: string; input?: Record<string, unknown> }[])
          if (b.type === 'tool_use' && b.name) {
            onActivity(describeTool(b.name, b.input ?? {}));
            if (b.name === 'Skill' && typeof b.input?.skill === 'string') onSkill(b.input.skill);
          }
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && !m.is_error) final = m.result;
        else throw new Error(`Agent ${def.name} failed: ${m.subtype}${'errors' in m && Array.isArray(m.errors) ? ' ' + m.errors.join('; ') : ''}`);
      }
    }
  } catch (e) {
    if (hooks.signal?.aborted) throw new Error('Cancelled.');
    if (ac.signal.aborted) throw new Error(`Agent ${def.name} timed out after ${Math.round(STAGE_TIMEOUT_MS / 1000)}s.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = (final ?? streamed).trim();
  if (!text) throw new Error(`Agent ${def.name} returned nothing.`);
  return { text, ms: Date.now() - t0, model };
}

export interface AgentFileInfo { key: AgentKey; file: string; name: string; description: string; tools: string[] | null; prompt: string }
export async function readAgentFile(key: AgentKey): Promise<AgentFileInfo> {
  const d = await loadAgent(key);
  return { key, file: path.join(AGENTS_DIR, `${AGENT_FILE[key]}.md`), name: d.name, description: d.description, tools: d.tools, prompt: d.prompt };
}
/** Replaces only the body of the agent file; frontmatter is kept. The previous file is saved as <name>.md.bak. */
export async function writeAgentPrompt(key: AgentKey, prompt: string): Promise<void> {
  const file = path.join(AGENTS_DIR, `${AGENT_FILE[key]}.md`);
  const raw = await readFile(file, 'utf8');
  const m = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)[\s\S]*$/.exec(raw);
  if (!m) throw new Error('Agent file has no frontmatter.');
  await writeFile(file + '.bak', raw);
  await writeFile(file, m[1] + prompt.trim() + '\n');
}
