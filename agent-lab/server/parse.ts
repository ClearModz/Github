import type { Fact, Research, Review, Route } from './types.js';

const EMPTY = /^(none|n\/a|na|nil|no|nothing|-+|—|skip(ped)?|no research( needed)?|not needed|not required)\.?$/i;
const bullets = (s: string) =>
  s.split('\n').map(l => l.trim()).filter(l => /^([-*•]|\d+[.)])\s+/.test(l)).map(l => l.replace(/^([-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
const isEmptySection = (s: string) => {
  const t = s.replace(/\*+/g, '').trim();
  if (!t || EMPTY.test(t)) return true;
  const b = bullets(t);
  return b.length > 0 && b.every(x => EMPTY.test(x.replace(/\*+/g, '').trim()));
};

/** Split "HEAD: text" style output into sections keyed by upper-case heading. */
export function sections(text: string, heads: string[]): Record<string, string> {
  const re = new RegExp(`^\\s*[#>*_\\s]*(${heads.join('|')})[*_\\s]*:[*_\\s]*(.*)$`, 'i');
  const out: Record<string, string> = {};
  let cur: string | null = null;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = re.exec(line);
    if (m) { cur = m[1].toUpperCase(); out[cur] = (out[cur] ? out[cur] + '\n' : '') + m[2]; }
    else if (cur) out[cur] += '\n' + line;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

export function parseCoordinator(text: string, fallbackTitle: string): Route {
  const s = sections(text, ['GOAL', 'NEEDS', 'RESEARCH', 'PLAN', 'SKIP']);
  const goal = s.GOAL ?? '';
  const goalLine = goal.split('\n').map(l => l.trim()).find(l => l && !/^([-*•]|\d+[.)])\s+/.test(l)) ?? bullets(goal)[0] ?? fallbackTitle;
  let criteria = bullets(goal);
  if (!criteria.length) criteria = bullets(s.NEEDS ?? '');
  if (!criteria.length) criteria = ['Fully meets the brief', 'Uses the requested format'];
  const research = s.RESEARCH ?? '';
  const needsResearch = !isEmptySection(research);
  const rq = bullets(research);
  const skip = s.SKIP ?? '';
  return {
    task_type: 'deliverable',
    complexity: 'med',
    needs_research: needsResearch,
    needs_review: !/\breview(er)?\b/i.test(skip),
    needs_input: false,
    questions: [],
    brief: goalLine.replace(/\*+/g, '').slice(0, 400),
    criteria: criteria.slice(0, 6),
    research_questions: needsResearch ? (rq.length ? rq : [research.replace(/\n+/g, ' ').trim()]).slice(0, 6) : [],
    raw: text.trim()
  };
}

const conf = (s: string): Fact['confidence'] => (/^high/i.test(s) ? 'high' : /^low/i.test(s) ? 'low' : 'med');
export function parseResearcher(text: string): Research {
  const s = sections(text, ['FACTS', 'GAPS']);
  const facts: Fact[] = bullets(s.FACTS ?? '').slice(0, 30).map(line => {
    const [claim, evidence, c] = line.split('|').map(x => x.trim());
    const confidence = conf(c ?? '');
    return { claim: evidence ? `${claim} (${evidence})` : claim, confidence, verify: confidence !== 'high' };
  }).filter(f => f.claim);
  return { facts, gaps: bullets(s.GAPS ?? '').slice(0, 8), raw: text.trim() };
}

export function factsText(r?: Research): string {
  if (!r) return '(none)';
  return r.raw || r.facts.map(f => `- ${f.claim} [${f.confidence}]`).join('\n');
}

/** Reviewer contract: exactly "PASS", or "FIX:" followed by "- problem -> correction" bullets.
 *  The agent returns no score, so the page's N/10 is derived from the verdict: pass = 10, fix = 5. */
export function parseReviewer(text: string): Review {
  const t = text.trim();
  if (/^\W*PASS\b/i.test(t) && !/\bFIX\s*:/i.test(t)) {
    return { verdict: 'pass', score: 10, criteria: [], defects: [], issues: [], fix_notes: '', raw: t };
  }
  const s = sections(t, ['FIX']);
  const defects = bullets(s.FIX ?? '').slice(0, 8);
  if (defects.length) return { verdict: 'revise', score: 5, criteria: [], defects, issues: defects, fix_notes: '', raw: t };
  throw new Error('The reviewer returned neither PASS nor a FIX list.');
}
