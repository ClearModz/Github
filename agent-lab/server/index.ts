import express from 'express';
import path from 'node:path';
import { Orchestrator, type PageEvent } from './orchestrator.js';
import { AGENT_KEYS, TEMPLATES } from './types.js';
import { AGENTS_DIR, preflight, readAgentFile, writeAgentPrompt } from './agents.js';
import { DATA_DIR } from './store.js';
import { getOmni, normaliseBase, publicOmni, routeFor, saveOmni } from './settings.js';

const PORT = Number(process.env.PORT ?? 3210);
const orch = new Orchestrator();
orch.start();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(import.meta.dirname, '..', 'public')));

/* ---- Server-Sent Events ---- */
const clients = new Set<express.Response>();
const send = (res: express.Response, e: PageEvent | Record<string, unknown>) => res.write(`data: ${JSON.stringify(e)}\n\n`);
orch.on('event', (e: PageEvent) => clients.forEach(c => send(c, e)));
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  orch.snapshotEvents().forEach(e => send(res, { ...e, job: e.job ? orch.snap(e.job) : undefined }));
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

/* ---- API ---- */
const id = (body: unknown) => Number((body as { id?: unknown })?.id);
const fail = (res: express.Response, code: number, error: string) => res.status(code).json({ error });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

app.get('/jobs', (_req, res) => res.json([...orch.jobs.values()].sort((a, b) => a.num - b.num)));
let claudeStatus = 'checking';
const checkClaude = () => { claudeStatus = 'checking'; return preflight().then(r => { claudeStatus = r; console.log(r === 'ok' ? 'Claude login: ok' : `Claude login PROBLEM: ${r}`); }); };
void checkClaude();
app.get('/health', (_req, res) => res.json({ ok: true, claude: claudeStatus, route: routeFor('coord').label, omniroute: getOmni().enabled, agentsDir: AGENTS_DIR, dataDir: DATA_DIR, jobs: orch.jobs.size }));
app.post('/health/recheck', async (_req, res) => { await checkClaude(); res.json({ claude: claudeStatus }); });

/* ---- model routing (OmniRoute) ---- */
app.get('/settings', (_req, res) => res.json({ omniroute: publicOmni() }));
app.put('/settings', (req, res) => {
  const o = req.body?.omniroute ?? {};
  try {
    saveOmni({ enabled: typeof o.enabled === 'boolean' ? o.enabled : undefined, baseUrl: str(o.baseUrl, 300), apiKey: str(o.apiKey, 500), clearKey: o.clearKey === true, model: typeof o.model === 'string' ? str(o.model, 200) : undefined, models: o.models && typeof o.models === 'object' ? o.models : undefined });
  } catch (e) { return fail(res, 400, (e as Error).message); }
  void checkClaude();
  res.json({ omniroute: publicOmni() });
});
app.post('/settings/test', async (_req, res) => { await checkClaude(); res.json({ ok: claudeStatus === 'ok', message: claudeStatus === 'ok' ? `Working through ${routeFor('coord').label}.` : claudeStatus }); });
app.get('/settings/models', async (_req, res) => {
  const o = getOmni();
  try {
    const r = await fetch(`${normaliseBase(o.baseUrl)}/v1/models`, { headers: o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return fail(res, 502, `OmniRoute answered ${r.status} when listing models. Check the key.`);
    const j = (await r.json()) as { data?: { id?: string }[] };
    res.json({ models: (j.data ?? []).map(m => m.id).filter((x): x is string => !!x).slice(0, 400) });
  } catch (e) { fail(res, 502, `Could not reach OmniRoute at ${o.baseUrl}: ${(e as Error).message}`); }
});

app.post('/jobs', (req, res) => {
  const b = req.body ?? {};
  const brief = str(b.brief, 20000).trim();
  if (!brief) return fail(res, 400, 'A brief is required.');
  if (b.template && !TEMPLATES[b.template as string]) return fail(res, 400, 'Unknown template.');
  const job = orch.createJob({ title: str(b.title, 80), brief, template: str(b.template, 20), priority: !!b.priority, effort: str(b.effort, 10), source: b.source });
  res.status(201).json(job);
});
app.delete('/jobs/:id', (req, res) => (orch.deleteJob(Number(req.params.id)) ? res.json({ ok: true }) : fail(res, 404, 'No such job.')));
app.get('/agents', async (_req, res) => {
  try { res.json(await Promise.all(AGENT_KEYS.map(k => readAgentFile(k)))); }
  catch (e) { fail(res, 500, (e as Error).message); }
});
app.put('/agents/:key', async (req, res) => {
  const key = req.params.key as (typeof AGENT_KEYS)[number];
  const prompt = str(req.body?.prompt, 20000).trim();
  if (!AGENT_KEYS.includes(key)) return fail(res, 404, 'Unknown agent.');
  if (!prompt) return fail(res, 400, 'Instructions cannot be empty.');
  try { await writeAgentPrompt(key, prompt); res.json({ ok: true }); }
  catch (e) { fail(res, 500, (e as Error).message); }
});
app.post('/control', (req, res) => {
  const c = req.body ?? {};
  if (typeof c.type !== 'string' || (c.agent && !AGENT_KEYS.includes(c.agent))) return fail(res, 400, 'Bad command.');
  orch.control(c);
  res.json({ ok: true });
});
const decision = (fn: (n: number, text: string) => unknown, needText: boolean) => (req: express.Request, res: express.Response) => {
  const text = str(req.body?.text, 10000).trim();
  if (needText && !text) return fail(res, 400, 'Notes are required.');
  const job = fn(id(req.body), text);
  return job ? res.json(job) : fail(res, 409, 'That job is not in a state that allows this.');
};
app.post('/approve', decision(n => orch.approve(n), false));
app.post('/changes', decision((n, t) => orch.requestChanges(n, t), true));
app.post('/answer', decision((n, t) => orch.answer(n, t), true));
app.post('/retry', decision(n => orch.retry(n), false));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Lab bridge: http://localhost:${PORT}/?live`);
  console.log(`Agents: ${AGENTS_DIR}\nData:   ${DATA_DIR}`);
});
