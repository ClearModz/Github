import express from 'express';
import path from 'node:path';
import { Orchestrator, type PageEvent } from './orchestrator.js';
import { AGENT_KEYS, TEMPLATES } from './types.js';
import { AGENTS_DIR } from './agents.js';
import { DATA_DIR } from './store.js';

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
app.get('/health', (_req, res) => res.json({ ok: true, agentsDir: AGENTS_DIR, dataDir: DATA_DIR, jobs: orch.jobs.size }));

app.post('/jobs', (req, res) => {
  const b = req.body ?? {};
  const brief = str(b.brief, 20000).trim();
  if (!brief) return fail(res, 400, 'A brief is required.');
  if (b.template && !TEMPLATES[b.template as string]) return fail(res, 400, 'Unknown template.');
  const job = orch.createJob({ title: str(b.title, 80), brief, template: str(b.template, 20), priority: !!b.priority, effort: str(b.effort, 10), source: b.source });
  res.status(201).json(job);
});
app.delete('/jobs/:id', (req, res) => (orch.deleteJob(Number(req.params.id)) ? res.json({ ok: true }) : fail(res, 409, 'Only shipped, failed or waiting-for-input jobs can be deleted.')));
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
