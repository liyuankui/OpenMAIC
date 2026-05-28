import type { JobStore, GenerationJob } from './job-store';
import type { ClassroomGenerationProgress, GenerateClassroomInput, GenerateClassroomResult } from '@/lib/server/classroom-generation';

export class CFJobStore implements JobStore {
  constructor(private namespace: DurableObjectNamespace) {}

  private async getStub() {
    const id = this.namespace.idFromName('global');
    return this.namespace.get(id);
  }

  async create(jobId: string, input: GenerateClassroomInput): Promise<GenerationJob> {
    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: jobId, status: 'queued', step: 'queued', progress: 0,
      message: 'Queued', createdAt: now, updatedAt: now,
      inputSummary: {
        requirementPreview: input.requirement.length > 200 ? `${input.requirement.slice(0, 197)}...` : input.requirement,
        language: input.language || 'zh-CN',
        hasPdf: !!input.pdfContent,
        pdfTextLength: input.pdfContent?.text.length || 0,
        pdfImageCount: input.pdfContent?.images.length || 0,
      },
      scenesGenerated: 0,
    };
    const stub = await this.getStub();
    await stub.fetch(new Request('http://do/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    }));
    return job;
  }

  async read(jobId: string): Promise<GenerationJob | null> {
    const stub = await this.getStub();
    const res = await stub.fetch(new Request(`http://do/job/${jobId}`));
    if (res.status === 404) return null;
    return res.json() as Promise<GenerationJob>;
  }

  async update(jobId: string, patch: Partial<GenerationJob>): Promise<GenerationJob> {
    const stub = await this.getStub();
    const res = await stub.fetch(new Request(`http://do/job/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }));
    return res.json() as Promise<GenerationJob>;
  }

  async markRunning(jobId: string): Promise<GenerationJob> {
    return this.update(jobId, { status: 'running', startedAt: new Date().toISOString(), message: 'Running' });
  }

  async updateProgress(jobId: string, progress: ClassroomGenerationProgress): Promise<GenerationJob> {
    return this.update(jobId, {
      status: 'running', step: progress.step, progress: progress.progress,
      message: progress.message, scenesGenerated: progress.scenesGenerated, totalScenes: progress.totalScenes,
    });
  }

  async markSucceeded(jobId: string, result: GenerateClassroomResult): Promise<GenerationJob> {
    return this.update(jobId, {
      status: 'succeeded', step: 'completed', progress: 100, message: 'Completed',
      completedAt: new Date().toISOString(), scenesGenerated: result.scenesCount,
      result: { classroomId: result.id, url: result.url, scenesCount: result.scenesCount },
    });
  }

  async markFailed(jobId: string, error: string): Promise<GenerationJob> {
    return this.update(jobId, {
      status: 'failed', step: 'failed', message: 'Failed',
      completedAt: new Date().toISOString(), error,
    });
  }
}
