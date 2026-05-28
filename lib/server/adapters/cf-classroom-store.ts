/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import type { ClassroomStore, PersistedClassroomData } from './classroom-store';
import type { Scene, Stage } from '@/lib/types/stage';

export class ClassroomDO extends DurableObject<Env> {
  private sqlReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private ensureSchema() {
    if (this.sqlReady) return;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      stage_json TEXT NOT NULL,
      scenes_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      step TEXT NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      input_summary_json TEXT NOT NULL DEFAULT '{}',
      scenes_generated INTEGER NOT NULL DEFAULT 0,
      total_scenes INTEGER,
      result_json TEXT,
      error TEXT
    )`);
    this.sqlReady = true;
  }

  // ── Classroom CRUD ──

  async getClassroom(id: string): Promise<PersistedClassroomData | null> {
    this.ensureSchema();
    const row = this.ctx.storage.sql.exec(`SELECT * FROM classrooms WHERE id = ?`, id).one() as any;
    if (!row) return null;
    return { id: row.id, stage: JSON.parse(row.stage_json), scenes: JSON.parse(row.scenes_json), createdAt: row.created_at };
  }

  async putClassroom(data: { id: string; stage: Stage; scenes: Scene[] }, baseUrl: string): Promise<PersistedClassroomData & { url: string }> {
    this.ensureSchema();
    const now = new Date().toISOString();
    const stageJson = JSON.stringify(data.stage);
    const scenesJson = JSON.stringify(data.scenes);
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO classrooms (id, stage_json, scenes_json, created_at) VALUES (?, ?, ?, ?)`,
      data.id, stageJson, scenesJson, now
    );
    return { id: data.id, stage: data.stage, scenes: data.scenes, createdAt: now, url: `${baseUrl}/classroom/${data.id}` };
  }

  // ── Job CRUD ──

  async getJob(jobId: string): Promise<any | null> {
    this.ensureSchema();
    const row = this.ctx.storage.sql.exec(`SELECT * FROM jobs WHERE id = ?`, jobId).one() as any;
    if (!row) return null;
    return {
      id: row.id, status: row.status, step: row.step, progress: row.progress,
      message: row.message, createdAt: row.created_at, updatedAt: row.updated_at,
      startedAt: row.started_at, completedAt: row.completed_at,
      inputSummary: JSON.parse(row.input_summary_json),
      scenesGenerated: row.scenes_generated, totalScenes: row.total_scenes,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error,
    };
  }

  async putJob(job: any): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO jobs (id, status, step, progress, message, created_at, updated_at, started_at, completed_at, input_summary_json, scenes_generated, total_scenes, result_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      job.id, job.status, job.step, job.progress, job.message,
      job.createdAt, job.updatedAt, job.startedAt ?? null, job.completedAt ?? null,
      JSON.stringify(job.inputSummary), job.scenesGenerated, job.totalScenes ?? null,
      job.result ? JSON.stringify(job.result) : null, job.error ?? null
    );
  }

  // ── HTTP fetch handler ──

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Classroom endpoints
    if (path === '/classroom' && request.method === 'POST') {
      const body = await request.json() as { id: string; stage: Stage; scenes: Scene[]; baseUrl: string };
      const result = await this.putClassroom(body, body.baseUrl);
      return Response.json(result);
    }

    const classroomMatch = path.match(/^\/classroom\/([a-zA-Z0-9_-]+)$/);
    if (classroomMatch && request.method === 'GET') {
      const data = await this.getClassroom(classroomMatch[1]);
      if (!data) return new Response('Not found', { status: 404 });
      return Response.json(data);
    }

    // Job endpoints
    if (path === '/job' && request.method === 'POST') {
      const job = await request.json();
      await this.putJob(job);
      return Response.json(job);
    }

    const jobMatch = path.match(/^\/job\/([a-zA-Z0-9_-]+)$/);
    if (jobMatch && request.method === 'GET') {
      const job = await this.getJob(jobMatch[1]);
      if (!job) return new Response('Not found', { status: 404 });
      return Response.json(job);
    }

    if (jobMatch && request.method === 'PATCH') {
      const patch = await request.json();
      const existing = await this.getJob(jobMatch[1]);
      if (!existing) return new Response('Not found', { status: 404 });
      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await this.putJob(updated);
      return Response.json(updated);
    }

    return new Response('Not found', { status: 404 });
  }
}

// CF adapter that delegates to ClassroomDO via RPC
export class CFClassroomStore implements ClassroomStore {
  private getStub(id: string) {
    const doId = this.namespace.idFromName('global');
    return this.namespace.get(doId);
  }

  constructor(private namespace: DurableObjectNamespace) {}

  async read(id: string): Promise<PersistedClassroomData | null> {
    const stub = this.getStub(id);
    const res = await stub.fetch(new Request(`http://do/classroom/${id}`));
    if (res.status === 404) return null;
    return res.json() as Promise<PersistedClassroomData>;
  }

  async write(data: { id: string; stage: Stage; scenes: Scene[] }, baseUrl: string): Promise<PersistedClassroomData & { url: string }> {
    const stub = this.getStub(data.id);
    const res = await stub.fetch(new Request('http://do/classroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, baseUrl }),
    }));
    return res.json() as Promise<PersistedClassroomData & { url: string }>;
  }
}
