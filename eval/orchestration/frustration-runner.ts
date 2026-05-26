/**
 * Director Frustration-Handling Eval (#598 / #511 follow-up)
 *
 * Tests whether the director correctly responds to user frustration signals
 * ("你答非所问", "我没听懂", "重答一下", "You didn't answer" 等). Reads
 * synthesized scenarios where the user has expressed dissatisfaction after
 * agents drifted off-topic.
 *
 * Per-decision classification (deterministic, no LLM judge):
 *   - USER       → ✓ correct (cue user to clarify)
 *   - TEACHER    → ✓ acceptable (re-answer the original question)
 *   - OTHER_AGENT → ✗ wrong  (more "variety" routing, the bug)
 *   - END        → ✗ wrong
 *
 * A/B:
 *   - baseline      : current main director prompt
 *   - with_rule     : baseline + appended # Handling User Feedback rule
 *
 * Pass criterion: with_rule.correctRate − baseline.correctRate ≥ EVAL_DELTA
 * (default 0.3), AND with_rule.correctRate ≥ EVAL_PASS_THRESHOLD (default 0.7).
 *
 * Required env:
 *   EVAL_DIRECTOR_MODEL  (prod uses google:gemini-3-flash-preview)
 *
 * Optional env:
 *   EVAL_SAMPLES        Samples per (scenario, variant). Default 5.
 *   EVAL_DELTA          Min lift baseline → with_rule. Default 0.3.
 *   EVAL_PASS_THRESHOLD Min with_rule correct rate per scenario. Default 0.7.
 *   EVAL_SCENARIO       Filter to a single scenario by case_id.
 *
 * Output: eval/orchestration/results-frustration/<model>/<timestamp>/report.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '@/lib/ai/llm';
import { parseDirectorDecision } from '@/lib/orchestration/director-prompt';
import {
  summarizeConversation,
  type OpenAIMessage,
} from '@/lib/orchestration/summarizers/conversation-summary';
import {
  processSnippets,
  processConditionalBlocks,
  interpolateVariables,
} from '@/lib/prompts/loader';
import { resolveEvalModel } from '../shared/resolve-model';
import { createRunDir } from '../shared/run-dir';
import type { AgentTurnSummary } from '@/lib/orchestration/types';
import type { ScenarioAgent } from './types';

const OUTPUT_DIR = 'eval/orchestration/results-frustration';

// ==================== Frustration Rule ====================

/**
 * The rule we want to A/B test. Appended into the # Rules section of the
 * director system prompt for the with_rule variant.
 */
const FRUSTRATION_RULE = `13. **Handling User Feedback (CRITICAL)**: If the most recent \`[Student (Human)]\` / \`[User]\` line expresses frustration, confusion, or a request to redo (examples: "答非所问", "我没听懂", "重新说一遍", "我问的是 X 不是 Y", "You didn't answer my question"), do NOT route to the next agent for variety or differentiation. Instead, either:
    - Route to the teacher (role: teacher, highest priority) to acknowledge and re-answer the ORIGINAL question (the user's question BEFORE their feedback), OR
    - Output \`{"next_agent":"USER"}\` to let the user clarify what they meant
    This overrides rules 2, 3, and 6 (role diversity, no repeat, brevity).`;

// ==================== Types ====================

interface FrustrationScenario {
  case_id: string;
  description: string;
  agents: ScenarioAgent[];
  teacherAgentId: string;
  messages: OpenAIMessage[];
  agentResponses: AgentTurnSummary[];
  turnCount: number;
  whiteboardOpen?: boolean;
}

type Variant = 'baseline' | 'with_rule';
type DecisionClass = 'USER' | 'TEACHER' | 'OTHER_AGENT' | 'END' | 'ERROR';

interface SampleResult {
  variant: Variant;
  raw: string;
  classification: DecisionClass;
  rawAgentId: string | null;
  error?: string;
}

interface ScenarioResult {
  case_id: string;
  description: string;
  samples: number;
  baseline: { samples: SampleResult[]; rates: Record<DecisionClass, number>; correctRate: number };
  withRule: { samples: SampleResult[]; rates: Record<DecisionClass, number>; correctRate: number };
  delta: number;
  passes: boolean;
}

// ==================== Prompt building ====================

function readDirectorTemplate(): string {
  const p = path.join(process.cwd(), 'lib', 'prompts', 'templates', 'director', 'system.md');
  return fs.readFileSync(p, 'utf-8').trim();
}

/** Append the frustration rule into the # Rules section, before # Routing Quality. */
function withFrustrationRule(template: string): string {
  const marker = '# Routing Quality (CRITICAL)';
  if (!template.includes(marker)) {
    throw new Error('director template missing "# Routing Quality" marker; can\'t inject rule');
  }
  return template.replace(marker, `${FRUSTRATION_RULE}\n\n${marker}`);
}

function buildPromptFromTemplate(
  template: string,
  scenario: FrustrationScenario,
  conversationSummary: string,
): string {
  const agentList = scenario.agents
    .map((a) => `- id: "${a.id}", name: "${a.name}", role: ${a.role}, priority: ${a.priority}`)
    .join('\n');

  const respondedList =
    scenario.agentResponses.length > 0
      ? scenario.agentResponses
          .map(
            (r) =>
              `- ${r.agentName} (${r.agentId}): "${r.contentPreview}" [${r.actionCount} actions]`,
          )
          .join('\n')
      : 'None yet.';

  const rule1 =
    "1. The teacher (role: teacher, highest priority) should usually speak first to address the user's question or topic.";

  const vars: Record<string, unknown> = {
    agentList,
    respondedList,
    conversationSummary,
    discussionSection: '',
    whiteboardSection: '',
    studentProfileSection: '',
    rule1,
    turnCountPlusOne: scenario.turnCount + 1,
    whiteboardOpenText: scenario.whiteboardOpen
      ? 'OPEN (slide canvas is hidden — spotlight/laser will not work)'
      : 'CLOSED (slide canvas is visible)',
  };

  const withSnippets = processSnippets(template);
  const withConditionals = processConditionalBlocks(withSnippets, vars);
  return interpolateVariables(withConditionals, vars);
}

function buildVariants(scenario: FrustrationScenario): { baseline: string; with_rule: string } {
  const base = readDirectorTemplate();
  const summary = summarizeConversation(scenario.messages);
  return {
    baseline: buildPromptFromTemplate(base, scenario, summary),
    with_rule: buildPromptFromTemplate(withFrustrationRule(base), scenario, summary),
  };
}

// ==================== Classifier ====================

function classify(
  raw: string,
  scenario: FrustrationScenario,
): {
  classification: DecisionClass;
  rawAgentId: string | null;
} {
  const parsed = parseDirectorDecision(raw);
  if (parsed.shouldEnd || !parsed.nextAgentId) {
    return { classification: 'END', rawAgentId: null };
  }
  if (parsed.nextAgentId === 'USER') {
    return { classification: 'USER', rawAgentId: 'USER' };
  }
  if (parsed.nextAgentId === scenario.teacherAgentId) {
    return { classification: 'TEACHER', rawAgentId: parsed.nextAgentId };
  }
  // Some other agent id (could be valid student/assistant agent or unknown)
  return { classification: 'OTHER_AGENT', rawAgentId: parsed.nextAgentId };
}

function emptyRates(): Record<DecisionClass, number> {
  return { USER: 0, TEACHER: 0, OTHER_AGENT: 0, END: 0, ERROR: 0 };
}

function computeRates(samples: SampleResult[]): {
  rates: Record<DecisionClass, number>;
  correctRate: number;
} {
  const rates = emptyRates();
  const usable = samples.filter((s) => !s.error);
  for (const s of usable) rates[s.classification]++;
  // Convert counts to rates over usable samples
  const total = usable.length || 1;
  for (const k of Object.keys(rates) as DecisionClass[]) {
    rates[k] = rates[k] / total;
  }
  // ERROR rate is tracked separately (samples with error are excluded above)
  rates.ERROR = (samples.length - usable.length) / samples.length;
  const correctRate = rates.USER + rates.TEACHER;
  return { rates, correctRate };
}

// ==================== Sampling ====================

async function sampleVariant(
  scenario: FrustrationScenario,
  variant: Variant,
  systemPrompt: string,
  model: Awaited<ReturnType<typeof resolveEvalModel>>['model'],
  samples: number,
): Promise<SampleResult[]> {
  const tasks = Array.from({ length: samples }, async (): Promise<SampleResult> => {
    try {
      const result = await callLLM(
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Decide which agent should speak next.' },
          ],
        },
        'eval-orchestration-frustration',
      );
      const raw = result.text;
      const { classification, rawAgentId } = classify(raw, scenario);
      return { variant, raw, classification, rawAgentId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        variant,
        raw: '',
        classification: 'ERROR',
        rawAgentId: null,
        error: msg,
      };
    }
  });
  return Promise.all(tasks);
}

// ==================== Reporting ====================

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function writeReport(
  runDir: string,
  results: ScenarioResult[],
  modelStr: string,
  samples: number,
  delta: number,
  threshold: number,
): string {
  const lines: string[] = [];
  const overallPass = results.every((r) => r.passes);
  const meanBaseline = results.reduce((acc, r) => acc + r.baseline.correctRate, 0) / results.length;
  const meanWithRule = results.reduce((acc, r) => acc + r.withRule.correctRate, 0) / results.length;

  lines.push(`# Director Frustration-Handling Eval`, ``);
  lines.push(`- **Date**: ${new Date().toISOString()}`);
  lines.push(`- **Model**: ${modelStr}`);
  lines.push(`- **Samples per (scenario, variant)**: ${samples}`);
  lines.push(`- **Lift threshold (Δ)**: ${pct(delta)}`);
  lines.push(`- **with_rule correct-rate threshold**: ${pct(threshold)}`);
  lines.push(``);
  lines.push(`## Aggregate`);
  lines.push(``);
  lines.push(`| Variant | Mean correct rate (USER + TEACHER) |`);
  lines.push(`|---|---|`);
  lines.push(`| baseline | ${pct(meanBaseline)} |`);
  lines.push(`| with_rule | ${pct(meanWithRule)} |`);
  lines.push(`| Δ | ${pct(meanWithRule - meanBaseline)} |`);
  lines.push(``);
  lines.push(`Overall verdict: **${overallPass ? 'PASS' : 'FAIL'}**`);
  lines.push(``);

  lines.push(`## Per scenario`);
  lines.push(``);
  lines.push(
    `| # | Scenario | Baseline USER% TEACHER% OTHER% END% | with_rule USER% TEACHER% OTHER% END% | Δ correct | pass? |`,
  );
  lines.push(`|---|---|---|---|---|---|`);
  results.forEach((r, i) => {
    const b = r.baseline.rates;
    const w = r.withRule.rates;
    const bStr = `${pct(b.USER)}/${pct(b.TEACHER)}/${pct(b.OTHER_AGENT)}/${pct(b.END)}`;
    const wStr = `${pct(w.USER)}/${pct(w.TEACHER)}/${pct(w.OTHER_AGENT)}/${pct(w.END)}`;
    lines.push(
      `| ${i + 1} | ${r.case_id} | ${bStr} | ${wStr} | ${pct(r.delta)} | ${r.passes ? '✓' : '✗'} |`,
    );
  });
  lines.push(``);

  lines.push(`## Detail`);
  for (const r of results) {
    lines.push(``, `### ${r.case_id} ${r.passes ? '✓' : '✗'}`, ``);
    lines.push(`- ${r.description}`);
    lines.push(
      `- Baseline correct: ${pct(r.baseline.correctRate)}; with_rule correct: ${pct(r.withRule.correctRate)}; Δ: ${pct(r.delta)}`,
    );
    lines.push(``);
    lines.push(`<details><summary>baseline samples</summary>`, ``);
    for (const s of r.baseline.samples) {
      const label = s.error
        ? `ERROR: ${s.error}`
        : `${s.classification}${s.rawAgentId && s.classification === 'OTHER_AGENT' ? ` (${s.rawAgentId})` : ''}`;
      lines.push(`- ${label}`);
    }
    lines.push(``, `</details>`, ``);
    lines.push(`<details><summary>with_rule samples</summary>`, ``);
    for (const s of r.withRule.samples) {
      const label = s.error
        ? `ERROR: ${s.error}`
        : `${s.classification}${s.rawAgentId && s.classification === 'OTHER_AGENT' ? ` (${s.rawAgentId})` : ''}`;
      lines.push(`- ${label}`);
    }
    lines.push(``, `</details>`, ``);
  }

  const reportPath = path.join(runDir, 'report.md');
  fs.writeFileSync(reportPath, lines.join('\n'));
  return reportPath;
}

// ==================== Main ====================

function getCurrentDir(): string {
  return typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
}

function loadScenarios(): FrustrationScenario[] {
  const p = path.join(getCurrentDir(), 'scenarios/frustration.json');
  const scenarios = JSON.parse(fs.readFileSync(p, 'utf-8')) as FrustrationScenario[];
  const filter = process.env.EVAL_SCENARIO;
  return filter ? scenarios.filter((s) => s.case_id === filter) : scenarios;
}

async function main() {
  const modelStr = process.env.EVAL_DIRECTOR_MODEL || process.env.DEFAULT_MODEL;
  if (!modelStr) {
    console.error(
      'Error: EVAL_DIRECTOR_MODEL must be set. Example: EVAL_DIRECTOR_MODEL=google:gemini-3-flash-preview',
    );
    process.exit(1);
  }
  const samples = Number(process.env.EVAL_SAMPLES || '5');
  const delta = Number(process.env.EVAL_DELTA || '0.3');
  const threshold = Number(process.env.EVAL_PASS_THRESHOLD || '0.7');

  console.log('=== Director Frustration-Handling Eval ===');
  console.log(
    `Model: ${modelStr} | Samples/variant: ${samples} | Δ: ${delta} | pass threshold: ${threshold}`,
  );

  const { model } = await resolveEvalModel('EVAL_DIRECTOR_MODEL', process.env.DEFAULT_MODEL);
  const scenarios = loadScenarios();
  console.log(`Loaded ${scenarios.length} scenario(s)`);
  const runDir = createRunDir(OUTPUT_DIR, modelStr);
  console.log(`Output: ${runDir}`);

  const results: ScenarioResult[] = [];
  for (const sc of scenarios) {
    process.stdout.write(`  - ${sc.case_id} ... `);
    const variants = buildVariants(sc);
    const [bs, ws] = await Promise.all([
      sampleVariant(sc, 'baseline', variants.baseline, model, samples),
      sampleVariant(sc, 'with_rule', variants.with_rule, model, samples),
    ]);
    const bAgg = computeRates(bs);
    const wAgg = computeRates(ws);
    const lift = wAgg.correctRate - bAgg.correctRate;
    const passes = wAgg.correctRate >= threshold && lift >= delta;
    results.push({
      case_id: sc.case_id,
      description: sc.description,
      samples,
      baseline: { samples: bs, rates: bAgg.rates, correctRate: bAgg.correctRate },
      withRule: { samples: ws, rates: wAgg.rates, correctRate: wAgg.correctRate },
      delta: lift,
      passes,
    });
    console.log(
      `baseline=${pct(bAgg.correctRate)} with_rule=${pct(wAgg.correctRate)} Δ=${pct(lift)} ${passes ? 'PASS' : 'FAIL'}`,
    );
  }

  const reportPath = writeReport(runDir, results, modelStr, samples, delta, threshold);
  const overallPass = results.every((r) => r.passes);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Verdict: ${overallPass ? 'PASS' : 'FAIL'}`);
  process.exit(overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
