import { EventEmitter } from 'node:events';
import { runAgent } from './agents.js';
import { deleteJobFile, loadJobs, saveJob } from './store.js';
import { factsText, parseCoordinator, parseResearcher, parseReviewer } from './parse.js';
import { AGENT_KEYS, TEMPLATES, type AgentKey, type Job, type Note, type Route } from './types.js';

/* ---- floor geometry copied from index.html so walk times match the animation ---- */
const AG_POS: Record<AgentKey, { x: number; y: number }> = { coord: { x: 200, y: 130 }, research: { x: 450, y: 130 }, dev: { x: 700, y: 130 }, review: { x: 700, y: 390 } };
const SHIP = { x: 380, y: 470 }, AISLE = 265, LOW_AISLE = 495, WALK = 120;
type P = { x: number; y: number };
const inboxPos = (k: AgentKey): P => ({ x: AG_POS[k].x - 90, y: AG_POS[k].y + 30 });
const homePos = (k: AgentKey): P => ({ x: AG_POS[k].x, y: AG_POS[k].y + 48 });
const route = (a: P, b: P): P[] => { const mid = a.y > AISLE && b.y > AISLE ? LOW_AISLE : AISLE; return [{ x: a.x, y: mid }, { x: b.x, y: mid }, { x: b.x, y: b.y }]; };
const pathLen = (a: P, pts: P[]) => { let l = 0, p = a; for (const q of pts) { l += Math.hypot(q.x - p.x, q.y - p.y); p = q; } return l; };
function walkMs(from: AgentKey, to: AgentKey | 'ship') {
  const home = homePos(from), dest = to === 'ship' ? SHIP : inboxPos(to);
  return { out: pathLen(home, route(home, dest)) / WALK * 1000, back: pathLen(dest, route(dest, home)) / WALK * 1000 };
}
const HANDOFF_MIN_MS = 2000;
const DEFAULT_EST: Record<AgentKey, number> = { coord: 9000, research: 25000, dev: 35000, review: 15000 };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '\n[...cut for length]' : t);

export interface PageEvent { type: string; agent?: AgentKey; to?: AgentKey | 'ship'; job?: Job; [k: string]: unknown }

interface Station { busy: boolean; paused: boolean; boost: boolean; queue: { job: Job; go: () => void }[] }

export class Orchestrator extends EventEmitter {
  jobs = new Map<number, Job>();
  stations = {} as Record<AgentKey, Station>;
  private nextNum = 1;
  private stageStart: Partial<Record<number, number>> = {};

  constructor() {
    super();
    AGENT_KEYS.forEach(k => { this.stations[k] = { busy: false, paused: false, boost: false, queue: [] }; });
  }

  /* ---------- events ---------- */
  snap(job: Job): Job { return JSON.parse(JSON.stringify(job)); }
  emitEvent(e: PageEvent) { this.emit('event', e.job ? { ...e, job: this.snap(e.job) } : e); }
  private est(a: AgentKey) {
    const all: number[] = [];
    this.jobs.forEach(j => (j.timings[a] ?? []).forEach(t => all.push(t)));
    const r = all.slice(-10);
    return r.length ? r.reduce((x, y) => x + y, 0) / r.length : DEFAULT_EST[a];
  }
  private save(job: Job) { saveJob(job); }

  /** Events that rebuild the page's picture of the floor for a newly connected browser. */
  snapshotEvents(): PageEvent[] {
    const ev: PageEvent[] = [];
    AGENT_KEYS.forEach(k => {
      if (this.stations[k].paused) ev.push({ type: 'agent_paused', agent: k });
      if (this.stations[k].boost) ev.push({ type: 'agent_boost', agent: k, on: true });
    });
    for (const job of [...this.jobs.values()].sort((a, b) => a.num - b.num)) {
      if (job.status === 'shipped') continue;
      ev.push({ type: 'job_restored', job });
      if (job.status === 'awaiting') ev.push({ type: 'awaiting', job });
      else if (job.status === 'working') ev.push({ type: 'task_started', agent: job.stage, job, est: this.est(job.stage), real: true });
      else if (job.status === 'queued') ev.push({ type: 'queued', agent: job.stage, job });
    }
    return ev;
  }

  /* ---------- job lifecycle ---------- */
  start() {
    for (const j of loadJobs()) {
      this.jobs.set(j.num, j);
      this.nextNum = Math.max(this.nextNum, j.num + 1);
    }
    for (const j of this.jobs.values()) {
      if (j.status === 'queued' || j.status === 'working') {
        console.log(`Resuming job #${j.num} at ${j.stage}`);
        void this.pipeline(j, j.stage);
      }
    }
  }

  createJob(o: { title?: string; brief: string; template?: string; priority?: boolean; effort?: string; source?: unknown }): Job {
    const num = this.nextNum++;
    const brief = o.brief.trim();
    const title = (o.title ?? '').trim() || brief.split('\n')[0].slice(0, 70);
    const job: Job = {
      kind: 'job', real: true, id: num, num, name: title, title, brief,
      template: o.template && TEMPLATES[o.template] ? o.template : 'custom',
      priority: !!o.priority, effort: o.effort === 'fast' || o.effort === 'max' ? o.effort : 'auto',
      status: 'queued', stage: 'coord', out: {}, notes: [], reviews: [], revisions: 0, changeRequests: 0, rejects: 0,
      timings: {}, usage: {}, createdAt: Date.now(), source: o.source ?? null, error: null
    };
    this.jobs.set(num, job);
    this.save(job);
    this.emitEvent({ type: 'job_created', job });
    setTimeout(() => void this.pipeline(job, 'coord'), 1800);
    return job;
  }

  deleteJob(num: number): boolean {
    const j = this.jobs.get(num);
    if (!j || !['shipped', 'error', 'input'].includes(j.status)) return false;
    this.jobs.delete(num); deleteJobFile(num); return true;
  }

  /* ---------- stations ---------- */
  private enter(a: AgentKey, job: Job): Promise<void> {
    return new Promise(go => {
      const st = this.stations[a];
      const item = { job, go };
      if (job.priority) { let i = 0; while (i < st.queue.length && st.queue[i].job.priority) i++; st.queue.splice(i, 0, item); } else st.queue.push(item);
      this.emitEvent({ type: 'queued', agent: a, job });
      this.tryStart(a);
    });
  }
  private tryStart(a: AgentKey) {
    const st = this.stations[a];
    if (st.busy || st.paused || !st.queue.length) return;
    const item = st.queue.shift()!;
    st.busy = true;
    item.go();
  }
  private release(a: AgentKey) { this.stations[a].busy = false; this.tryStart(a); }

  control(cmd: { type: string; agent?: AgentKey; id?: number; priority?: boolean }) {
    const a = cmd.agent;
    switch (cmd.type) {
      case 'pause_agent': {
        if (!a || !this.stations[a]) return;
        const st = this.stations[a]; st.paused = !st.paused;
        this.emitEvent({ type: st.paused ? 'agent_paused' : 'agent_resumed', agent: a });
        if (!st.paused) this.tryStart(a);
        break;
      }
      case 'boost_agent': {
        if (!a || !this.stations[a]) return;
        const st = this.stations[a]; st.boost = !st.boost;
        this.emitEvent({ type: 'agent_boost', agent: a, on: st.boost });
        break;
      }
      case 'rush': {
        const job = cmd.id != null ? this.jobs.get(cmd.id) : undefined;
        if (!job || job.priority) return;
        job.priority = true; this.save(job);
        const k = AGENT_KEYS.find(k => this.stations[k].queue.some(x => x.job === job));
        if (k) {
          const q = this.stations[k].queue; const item = q.splice(q.findIndex(x => x.job === job), 1)[0];
          let i = 0; while (i < q.length && q[i].job.priority) i++; q.splice(i, 0, item);
        }
        this.emitEvent({ type: 'prioritized', agent: k, job });
        break;
      }
      default: break; // add_job (demo batches) is intentionally not supported in live mode
    }
  }

  /* ---------- user decisions ---------- */
  approve(num: number): Job | null {
    const job = this.jobs.get(num);
    if (!job || job.status !== 'awaiting') return null;
    job.status = 'shipped'; job.shippedAt = Date.now(); this.save(job);
    this.emitEvent({ type: 'job_shipped', job });
    return job;
  }
  requestChanges(num: number, text: string): Job | null {
    const job = this.jobs.get(num);
    if (!job || job.status !== 'awaiting') return null;
    job.notes.push({ by: 'you', at: Date.now(), text });
    job.changeRequests++; job.rejects++;
    this.emitEvent({ type: 'released', job });
    job.status = 'queued'; job.stage = 'dev'; this.save(job);
    void this.pipeline(job, 'dev');
    return job;
  }
  answer(num: number, text: string): Job | null {
    const job = this.jobs.get(num);
    if (!job || job.status !== 'input') return null;
    job.brief += `\n\nANSWERS:\n${text}`; job.clarified = true;
    this.emitEvent({ type: 'answered', job });
    job.status = 'queued'; job.stage = 'coord'; this.save(job);
    void this.pipeline(job, 'coord');
    return job;
  }
  retry(num: number): Job | null {
    const job = this.jobs.get(num);
    if (!job || job.status !== 'error') return null;
    const st = job.error?.stage ?? 'coord';
    job.error = null; job.status = 'queued'; job.stage = st; this.save(job);
    void this.pipeline(job, st);
    return job;
  }

  /* ---------- pipeline: coordinator -> researcher? -> developer -> reviewer? ---------- */
  private async pipeline(job: Job, first: AgentKey) {
    let stage: AgentKey | null = first;
    while (stage) {
      const a: AgentKey = stage;
      job.stage = a; job.status = 'queued'; this.save(job);
      await this.enter(a, job);
      job.status = 'working'; this.save(job);
      this.emitEvent({ type: 'task_started', agent: a, job, est: this.est(a), real: true });
      const t0 = Date.now();
      let res: unknown;
      try {
        res = await this.runStage(a, job);
      } catch (e) {
        const msg = (e as Error).message || 'The agent call failed.';
        console.error(`Job #${job.num} ${a} failed: ${msg}`);
        job.status = 'error'; job.error = { stage: a, msg }; this.save(job);
        this.emitEvent({ type: 'task_failed', agent: a, job, msg });
        this.release(a);
        return;
      }
      (job.timings[a] ??= []).push(Date.now() - t0);
      this.save(job);
      this.emitEvent({ type: 'task_finished', agent: a, job });

      let to: AgentKey | 'ship'; let hold = false; let reject = false;
      if (a === 'coord') {
        const r: Route = job.route!;
        if (r.needs_input) { job.status = 'input'; this.save(job); this.emitEvent({ type: 'needs_input', agent: a, job }); this.release(a); return; }
        this.emitEvent({ type: 'routed', agent: a, job });
        to = r.needs_research ? 'research' : 'dev';
      } else if (a === 'research') to = 'dev';
      else if (a === 'dev') { if (!job.route || job.route.needs_review) to = 'review'; else { to = 'ship'; hold = true; } }
      else {
        const rv = res as { verdict: string; defects: string[] };
        if (rv.verdict === 'revise' && job.revisions < 1) {
          to = 'dev'; reject = true; job.revisions++; job.rejects++;
          job.pendingDefects = rv.defects.length ? rv.defects : ['Fix the failed done-conditions.'];
          job.notes.push({ by: 'reviewer', at: Date.now(), text: job.pendingDefects.join('; ') });
        } else { to = 'ship'; hold = true; job.caveats = rv.verdict === 'revise' ? rv.defects : []; }
      }
      this.save(job);

      const { out, back } = walkMs(a, to);
      this.emitEvent({ type: 'handoff', agent: a, to, hold, reject, job });
      await sleep(Math.max(HANDOFF_MIN_MS, out));
      setTimeout(() => this.release(a), Math.max(0, back));
      if (to === 'ship') {
        job.status = 'awaiting'; this.save(job);
        this.emitEvent({ type: 'awaiting', job });
        return;
      }
      stage = to;
    }
  }

  private track(job: Job, a: AgentKey, input: string, output: string) {
    const u = (job.usage[a] ??= { inChars: 0, outChars: 0, calls: 0, tiers: [] });
    u.inChars += input.length; u.outChars += output.length; u.calls++; u.tiers.push('default');
  }
  private live(job: Job, a: AgentKey) {
    let last = 0;
    return (text: string) => {
      const now = Date.now();
      if (now - last < 250) return;
      last = now;
      this.emit('event', { type: 'live_text', agent: a, id: job.id, text: text.slice(-1500) });
    };
  }

  private async runStage(a: AgentKey, job: Job): Promise<unknown> {
    const t = TEMPLATES[job.template] ?? TEMPLATES.custom;
    const onText = this.live(job, a);
    const call = async (prompt: string) => {
      const r = await runAgent(a, prompt, job.num, onText, skill => {
        console.log(`Job #${job.num}: ${a} used skill "${skill}"`);
        job.skillsUsed = [...(job.skillsUsed ?? []), { agent: a, skill }];
      });
      this.track(job, a, prompt, r.text);
      return r.text;
    };
    const plan = job.route?.raw ?? '(no plan)';
    if (a === 'coord') {
      const text = await call(`JOB TYPE: ${t.name}. ${t.guide}\nFINAL FORMAT: ${t.deliverable}\n\nREQUEST:\n${clip(job.brief, 12000)}`);
      const r = parseCoordinator(text, job.title);
      if (t.review) r.needs_review = true;
      if (job.effort === 'fast') { r.needs_research = false; r.research_questions = []; r.needs_review = !!t.review; }
      if (job.effort === 'max') { r.needs_research = true; r.needs_review = true; if (!r.research_questions.length) r.research_questions = [`Facts needed for: ${r.brief}`]; }
      job.route = r; job.out.plan = r;
      return r;
    }
    if (a === 'research') {
      const r = job.route!;
      const text = await call(`REQUEST:\n${clip(job.brief, 5000)}\n\nCOORDINATOR PLAN:\n${plan}\n\nRESEARCH ITEMS (resolve only these):\n${r.research_questions.map(q => '- ' + q).join('\n')}`);
      job.out.research = parseResearcher(text);
      return job.out.research;
    }
    if (a === 'dev') {
      const fixes = [...(job.pendingDefects ?? []), ...job.notes.filter((n: Note) => n.by === 'you' && !n.used).map(n => 'From the user: ' + n.text)];
      const prompt = job.out.final && fixes.length
        ? `REQUEST:\n${clip(job.brief, 12000)}\n\nCOORDINATOR PLAN:\n${plan}\n\nFORMAT: ${t.deliverable}\n\nCURRENT DELIVERABLE:\n${clip(job.out.final, 12000)}\n\nFIX THESE, and change nothing else that already works:\n${fixes.map(d => '- ' + d).join('\n')}\n\nOutput the complete revised deliverable only, as text in your reply (you cannot save files or run commands).`
        : `JOB TYPE: ${t.name}. ${t.guide}\nFORMAT: ${t.deliverable}\n\nREQUEST:\n${clip(job.brief, 12000)}\n\nCOORDINATOR PLAN:\n${plan}${job.out.research ? `\n\nVERIFIED FINDINGS FROM THE RESEARCHER:\n${factsText(job.out.research)}` : ''}\n\nOutput only the finished deliverable, as text in your reply (you cannot save files or run commands).`;
      const text = await call(prompt);
      job.notes.forEach(n => { if (n.by === 'you') n.used = true; });
      job.pendingDefects = [];
      job.out.final = text;
      return text;
    }
    const text = await call(`REQUEST:\n${clip(job.brief, 5000)}\n\nCOORDINATOR PLAN (what done means):\n${plan}${job.out.research ? `\n\nVERIFIED FINDINGS:\n${factsText(job.out.research)}` : ''}\n\nDELIVERABLE TO CHECK:\n${clip(job.out.final ?? '', 14000)}`);
    const rv = parseReviewer(text);
    job.reviews.push(rv); job.out.review = rv;
    return rv;
  }
}
