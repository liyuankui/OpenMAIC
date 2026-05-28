import type { Scene, Stage } from '@/lib/types/stage';

export interface PersistedClassroomData {
  id: string;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
}

export interface ClassroomStore {
  read(id: string): Promise<PersistedClassroomData | null>;
  write(data: { id: string; stage: Stage; scenes: Scene[] }, baseUrl: string): Promise<PersistedClassroomData & { url: string }>;
}
