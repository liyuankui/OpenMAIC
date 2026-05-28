import type {
  ClassroomGenerationProgress,
  ClassroomGenerationStep,
  GenerateClassroomInput,
  GenerateClassroomResult,
} from '@/lib/server/classroom-generation';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface GenerationJob {
  id: string;
  status: JobStatus;
  step: ClassroomGenerationStep | 'queued' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  inputSummary: {
    requirementPreview: string;
    language: string;
    hasPdf: boolean;
    pdfTextLength: number;
    pdfImageCount: number;
  };
  scenesGenerated: number;
  totalScenes?: number;
  result?: { classroomId: string; url: string; scenesCount: number };
  error?: string;
}

export interface JobStore {
  create(jobId: string, input: GenerateClassroomInput): Promise<GenerationJob>;
  read(jobId: string): Promise<GenerationJob | null>;
  update(jobId: string, patch: Partial<GenerationJob>): Promise<GenerationJob>;
  markRunning(jobId: string): Promise<GenerationJob>;
  updateProgress(jobId: string, progress: ClassroomGenerationProgress): Promise<GenerationJob>;
  markSucceeded(jobId: string, result: GenerateClassroomResult): Promise<GenerationJob>;
  markFailed(jobId: string, error: string): Promise<GenerationJob>;
}
