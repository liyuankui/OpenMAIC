import type { ClassroomStore, PersistedClassroomData } from './classroom-store';
import type { JobStore, GenerationJob } from './job-store';

export type { ClassroomStore, PersistedClassroomData } from './classroom-store';
export type { JobStore, GenerationJob, JobStatus } from './job-store';

let _classroomStore: ClassroomStore | null = null;
let _jobStore: JobStore | null = null;

export function setClassroomStore(store: ClassroomStore) {
  _classroomStore = store;
}

export function getClassroomStore(): ClassroomStore {
  if (!_classroomStore) {
    throw new Error('ClassroomStore not initialized. Call setClassroomStore() first.');
  }
  return _classroomStore;
}

export function setJobStore(store: JobStore) {
  _jobStore = store;
}

export function getJobStore(): JobStore {
  if (!_jobStore) {
    throw new Error('JobStore not initialized. Call setJobStore() first.');
  }
  return _jobStore;
}
