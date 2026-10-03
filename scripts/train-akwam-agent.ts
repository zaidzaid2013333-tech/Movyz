import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { adminSupabase } from '../server/supabase';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const JOB_KEY = 'akwam-learning-memory';
const PLAYBOOK_PATH = new URL('../docs/AKWAM-EXTRACTION-PLAYBOOK.md', import.meta.url);

type Lesson = {
  id: string;
  rule: string;
  trigger: string;
  nextAction: string;
  avoid: string;
  confidence: number;
};

type LearningMemory = {
  version: string;
  generatedAt: string;
  model: string;
  lessons: Lesson[];
  strategyOrder: string[];
  queryVariants: string[];
  extractorSignals: string[];
  stopConditions: string[];
};

async function loadPlaybook() {
  return readFile(PLAYBOOK_PATH, 'utf8');
}

function compact(value: unknown, max = 9000) {
  return JSON.stringify(value).slice(0, max);
}

async function gatherEvidence() {
  const [states, failures, sourceCounts] = await Promise.all([
    adminSupabase
      .from('maintenance_state')
      .select('job_key,last_run_at,last_success_at,last_error,stats,updated_at')
      .ilike('job_key', '%akwam%')
      .order('updated_at', { ascending: false })
      .limit(20),
    adminSupabase
      .from('maintenance_failures')
      .select('job_key,content_type,content_id,failed_at,attempts,last_error')
      .ilike('job_key', '%akwam%')
      .order('failed_at', { ascending: false })
      .limit(30),
    Promise.all([
      adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true })
        .eq('provider_reference', 'akwam').eq('content_type', 'movie').eq('is_working', true),
      adminSupabase.from('playback_sources').select('id', { count: 'exact', head: true })
        .eq('provider_reference', 'akwam').eq('content_type', 'episode').eq('is_working', true),
    ]),
  ]);

  return {
    states: states.data || [],
    failures: failures.data || [],
    workingMovieSources: sourceCounts[0].count ?? 0,
    workingEpisodeSources: sourceCounts[1].count ?? 0,
  };
}

async function callGroq(input: {
  playbook: string;
  evidence: unknown;
  previous: unknown;
}) {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('Missing GROQ_API_KEY');

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      reasoning_effort: 'low',
      max_tokens: 1200,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'akwam_learning_memory',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              version: { type: 'string' },
              lessons: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    rule: { type: 'string' },
                    trigger: { type: 'string' },
                    nextAction: { type: 'string' },
                    avoid: { type: 'string' },
                    confidence: { type: 'number' },
                  },
                  required: ['id', 'rule', 'trigger', 'nextAction', 'avoid', 'confidence'],
                  additionalProperties: false,
                },
              },
              strategyOrder: { type: 'array', items: { type: 'string' } },
              queryVariants: { type: 'array', items: { type: 'string' } },
              extractorSignals: { type: 'array', items: { type: 'string' } },
              stopConditions: { type: 'array', items: { type: 'string' } },
            },
            required: ['version', 'lessons', 'strategyOrder', 'queryVariants', 'extractorSignals', 'stopConditions'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are the Movyz continual-learning trainer for the Akwam preparation robot.',
            'Do not invent facts or URLs.',
            'Preserve the hard invariants in the playbook.',
            'Learn only from verified evidence and the playbook.',
            'Your output becomes durable machine memory for the next run.',
            'Prefer compact, actionable lessons over prose.',
            'Do not recommend browser automation or playback-time discovery.',
            'Do not erase proven working strategies merely because one attempt failed.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            'PLAYBOOK:',
            playbook.slice(0, 20000),
            '',
            'RECENT EVIDENCE:',
            compact(input.evidence, 13000),
            '',
            'PREVIOUS MEMORY:',
            compact(input.previous, 7000),
          ].join('\n'),
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const body = await response.text();
  if (!response.ok) throw new Error('Groq training HTTP ' + response.status + ': ' + body.slice(0, 800));
  const payload = JSON.parse(body);
  const content = String(payload.choices?.[0]?.message?.content || '{}');
  return JSON.parse(content) as LearningMemory;
}

async function loadPreviousMemory() {
  const { data } = await adminSupabase
    .from('maintenance_state')
    .select('stats')
    .eq('job_key', JOB_KEY)
    .maybeSingle();
  return data?.stats || null;
}

async function persist(memory: LearningMemory, evidence: unknown) {
  const bounded: LearningMemory = {
    version: memory.version || '1',
    generatedAt: new Date().toISOString(),
    model: MODEL,
    lessons: memory.lessons.slice(0, 16).map(lesson => ({
      ...lesson,
      confidence: Math.max(0, Math.min(1, Number(lesson.confidence) || 0)),
    })),
    strategyOrder: memory.strategyOrder.slice(0, 16),
    queryVariants: memory.queryVariants.slice(0, 20),
    extractorSignals: memory.extractorSignals.slice(0, 20),
    stopConditions: memory.stopConditions.slice(0, 12),
  };

  const { error } = await adminSupabase.from('maintenance_state').upsert({
    job_key: JOB_KEY,
    last_run_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    last_error: null,
    stats: {
      state: 'trained',
      ...bounded,
      evidenceSummary: {
        workingMovieSources: (evidence as any).workingMovieSources,
        workingEpisodeSources: (evidence as any).workingEpisodeSources,
        stateCount: Array.isArray((evidence as any).states) ? (evidence as any).states.length : 0,
        failureCount: Array.isArray((evidence as any).failures) ? (evidence as any).failures.length : 0,
      },
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_key' });
  if (error) throw error;

  return bounded;
}

async function main() {
  const [playbook, evidence, previous] = await Promise.all([
    loadPlaybook(),
    gatherEvidence(),
    loadPreviousMemory(),
  ]);

  const memory = await callGroq({ playbook, evidence, previous });
  const saved = await persist(memory, evidence);

  console.log(JSON.stringify({
    ok: true,
    trainer: 'movyz-akwam-continual-learning',
    model: MODEL,
    lessons: saved.lessons.length,
    strategyOrder: saved.strategyOrder,
    queryVariants: saved.queryVariants.length,
    extractorSignals: saved.extractorSignals.length,
    stopConditions: saved.stopConditions.length,
    generatedAt: saved.generatedAt,
  }));
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const { data: previous } = await adminSupabase
    .from('maintenance_state')
    .select('stats')
    .eq('job_key', JOB_KEY)
    .maybeSingle();

  await adminSupabase.from('maintenance_state').upsert({
    job_key: JOB_KEY,
    last_run_at: new Date().toISOString(),
    last_success_at: previous?.stats ? null : null,
    last_error: message,
    stats: {
      ...(previous?.stats || {}),
      state: 'training-failed-preserved',
      trainingError: message,
      model: previous?.stats?.model || MODEL,
      at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_key' });

  console.error('[akwam-trainer]', message);
  // Preserve the previous learned memory and let the next workflow cycle retry training.
  process.exitCode = 0;
}
