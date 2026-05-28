import { promises as fs } from 'fs';
import path from 'path';
import type { JobStore, GenerationJob } from './job-store';
import type { ClassroomGenerationProgress, GenerateClassroomInput, GenerateClassroomResult } from '@/lib/server/classroom-generation';

const JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');
const jobLocks = new Map<string, Promise<void>>();
const STALE_MS = 30 * 60 * 1000;

async function ensureDir(dir: string) { await fs.mkdir(dir, { recursive: true }); }
function jobPath(id: string) { return path.join(JOBS_DIR, `${id}.json`); }

async function writeAtomic(filePath: string, data: unknown) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

async function withLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  jobLocks.set(jobId, next);
  try { await prev; return await fn(); } finally { resolve!(); if (jobLocks.get(jobId) === next) jobLocks.delete(jobId); }
}

function markStale(job: GenerationJob): GenerationJob {
  if (job.status !== 'running') return job;
  if (Date.now() - new Date(job.updatedAt).getTime() > STALE_MS) {
    return { ...job, status: 'failed', step: 'failed', message: 'Stale job', error: 'No progress for 30min', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  return job;
}

function inputSummary(input: GenerateClassroomInput): GenerationJob['inputSummary'] {
  return {
    requirementPreview: input.requirement.length > 200 ? `${input.requirement.slice(0, 197)}...` : input.requirement,
    language: input.language || 'zh-CN',
    hasPdf: !!input.pdfContent,
    pdfTextLength: input.pdfContent?.text.length || 0,
    pdfImageCount: input.pdfContent?.images.length || 0,
  };
}

export class NodeJobStore implements JobStore {
  async create(jobId: string, input: GenerateClassroomInput): Promise<GenerationJob> {
    const now = new Date().toISOString();
    const job: GenerationJob = { id: jobId, status: 'queued', step: 'queued', progress: 0, message: 'Queued', createdAt: now, updatedAt: now, inputSummary: inputSummary(input), scenesGenerated: 0 };
    await ensureDir(JOBS_DIR);
    await writeAtomic(jobPath(jobId), job);
    return job;
  }

  async read(jobId: string): Promise<GenerationJob | null> {
    try {
      const content = await fs.readFile(jobPath(jobId), 'utf-8');
      return markStale(JSON.parse(content) as GenerationJob);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async update(jobId: string, patch: Partial<GenerationJob>): Promise<GenerationJob> {
    return withLock(jobId, async () => {
      const existing = await this.read(jobId);
      if (!existing) throw new Error(`Job not found: ${jobId}`);
      const updated: GenerationJob = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await writeAtomic(jobPath(jobId), updated);
      return updated;
    });
  }

  async markRunning(jobId: string): Promise<GenerationJob> {
    return this.update(jobId, { status: 'running', startedAt: new Date().toISOString(), message: 'Running' });
  }

  async updateProgress(jobId: string, progress: ClassroomGenerationProgress): Promise<GenerationJob> {
    return this.update(jobId, { status: 'running', step: progress.step, progress: progress.progress, message: progress.message, scenesGenerated: progress.scenesGenerated, totalScenes: progress.totalScenes });
  }

  async markSucceeded(jobId: string, result: GenerateClassroomResult): Promise<GenerationJob> {
    return this.update(jobId, { status: 'succeeded', step: 'completed', progress: 100, message: 'Completed', completedAt: new Date().toISOString(), scenesGenerated: result.scenesCount, result: { classroomId: result.id, url: result.url, scenesCount: result.scenesCount } });
  }

  async markFailed(jobId: string, error: string): Promise<GenerationJob> {
    return this.update(jobId, { status: 'failed', step: 'failed', message: 'Failed', completedAt: new Date().toISOString(), error });
  }
}
