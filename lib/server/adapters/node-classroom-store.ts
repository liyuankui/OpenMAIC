import { promises as fs } from 'fs';
import path from 'path';
import type { ClassroomStore, PersistedClassroomData } from './classroom-store';
import type { Scene, Stage } from '@/lib/types/stage';

const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export class NodeClassroomStore implements ClassroomStore {
  async read(id: string): Promise<PersistedClassroomData | null> {
    const filePath = path.join(CLASSROOMS_DIR, `${id}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as PersistedClassroomData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(data: { id: string; stage: Stage; scenes: Scene[] }, baseUrl: string): Promise<PersistedClassroomData & { url: string }> {
    const classroomData: PersistedClassroomData = {
      id: data.id,
      stage: data.stage,
      scenes: data.scenes,
      createdAt: new Date().toISOString(),
    };
    await ensureDir(CLASSROOMS_DIR);
    const filePath = path.join(CLASSROOMS_DIR, `${data.id}.json`);
    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFilePath, JSON.stringify(classroomData, null, 2), 'utf-8');
    await fs.rename(tempFilePath, filePath);
    return { ...classroomData, url: `${baseUrl}/classroom/${data.id}` };
  }
}
