import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Job } from './types.js';

export const DATA_DIR = path.resolve(process.env.AGENT_LAB_DATA_DIR ?? path.join(import.meta.dirname, '..', 'data'));
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
mkdirSync(JOBS_DIR, { recursive: true });

const file = (num: number) => path.join(JOBS_DIR, `job_${num}.json`);

export function saveJob(job: Job): void {
  const tmp = file(job.num) + '.tmp';
  writeFileSync(tmp, JSON.stringify(job, null, 2));
  renameSync(tmp, file(job.num));
}

export function deleteJobFile(num: number): void { rmSync(file(num), { force: true }); }

export function loadJobs(): Job[] {
  const jobs: Job[] = [];
  for (const f of readdirSync(JOBS_DIR)) {
    if (!/^job_\d+\.json$/.test(f)) continue;
    try { jobs.push(JSON.parse(readFileSync(path.join(JOBS_DIR, f), 'utf8')) as Job); }
    catch (e) { console.warn(`Skipping unreadable ${f}: ${(e as Error).message}`); }
  }
  return jobs.sort((a, b) => a.num - b.num);
}
