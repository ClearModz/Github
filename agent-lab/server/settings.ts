import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';
import type { AgentKey } from './types.js';

export interface OmniSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: Partial<Record<AgentKey, string>>;
}

const FILE = path.join(DATA_DIR, 'settings.json');   // data/ is gitignored, so the key never reaches the repo
const DEFAULTS: OmniSettings = { enabled: false, baseUrl: 'http://localhost:20128', apiKey: '', model: 'auto', models: {} };

function readFile(): Partial<OmniSettings> {
  if (!existsSync(FILE)) return {};
  try { return (JSON.parse(readFileSync(FILE, 'utf8')) as { omniroute?: Partial<OmniSettings> }).omniroute ?? {}; }
  catch { return {}; }
}

/** Saved settings, with environment variables taking precedence (handy for scripts and shortcuts). */
export function getOmni(): OmniSettings {
  const f = readFile();
  const o: OmniSettings = { ...DEFAULTS, ...f, models: { ...(f.models ?? {}) } };
  if (process.env.AGENT_LAB_OMNIROUTE === '1') o.enabled = true;
  if (process.env.AGENT_LAB_OMNIROUTE === '0') o.enabled = false;
  if (process.env.AGENT_LAB_OMNIROUTE_URL) o.baseUrl = process.env.AGENT_LAB_OMNIROUTE_URL;
  if (process.env.AGENT_LAB_OMNIROUTE_KEY) o.apiKey = process.env.AGENT_LAB_OMNIROUTE_KEY;
  if (process.env.AGENT_LAB_OMNIROUTE_MODEL) o.model = process.env.AGENT_LAB_OMNIROUTE_MODEL;
  return o;
}

/** Normalised to what Claude Code wants: no trailing slash and no /v1 suffix. */
export const normaliseBase = (u: string) => u.trim().replace(/\/+$/, '').replace(/\/v1$/, '');

export function saveOmni(patch: { enabled?: boolean; baseUrl?: string; apiKey?: string; clearKey?: boolean; model?: string; models?: Partial<Record<AgentKey, string>> }): void {
  const cur = readFile();
  const next: Partial<OmniSettings> = { ...cur };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim()) {
    const u = normaliseBase(patch.baseUrl);
    if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error('The OmniRoute URL must start with http:// or https://');
    next.baseUrl = u;
  }
  if (patch.clearKey) next.apiKey = '';
  else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  if (typeof patch.model === 'string') next.model = patch.model.trim().slice(0, 200);
  if (patch.models) {
    const m: Partial<Record<AgentKey, string>> = {};
    for (const k of ['coord', 'research', 'dev', 'review'] as AgentKey[]) { const v = (patch.models[k] ?? '').trim().slice(0, 200); if (v) m[k] = v; }
    next.models = m;
  }
  const tmp = FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify({ omniroute: next }, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE);
  try { chmodSync(FILE, 0o600); } catch { /* best effort */ }
}

/** What the browser may see: everything except the key itself. */
export function publicOmni() {
  const o = getOmni();
  return { enabled: o.enabled, baseUrl: o.baseUrl, hasKey: !!o.apiKey, model: o.model, models: o.models };
}

export interface Route { env?: Record<string, string>; model?: string; label: string; isolated?: boolean }

/** Variables a child process may inherit when it talks to OmniRoute. Nothing else from this shell is passed on,
 *  so no Anthropic login token or API key in your environment can be sent to the gateway. */
const SAFE_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

/** Environment + model that make the Claude Code process under the SDK talk to OmniRoute. */
export function routeFor(agent: AgentKey): Route {
  const o = getOmni();
  if (!o.enabled) return { label: 'Claude login' };
  const model = (o.models[agent] || o.model || 'auto').trim();
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: normaliseBase(o.baseUrl),
    ANTHROPIC_AUTH_TOKEN: o.apiKey,
    // aliases and the background "small" model also go through the gateway, to the same model
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model
  };
  const clean: Record<string, string> = {};
  for (const k of SAFE_ENV) if (process.env[k] !== undefined) clean[k] = process.env[k]!;
  // a private, empty Claude config folder keeps any stored Claude login out of the picture
  const cfg = path.join(DATA_DIR, 'omniroute-claude-config');
  mkdirSync(cfg, { recursive: true });
  return { env: { ...clean, ...env, CLAUDE_CONFIG_DIR: cfg, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, model, label: `OmniRoute (${model})`, isolated: true };
}
