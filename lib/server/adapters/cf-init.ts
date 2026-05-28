import { setClassroomStore, setJobStore } from './index';
import { CFClassroomStore } from './cf-classroom-store';
import { CFJobStore } from './cf-job-store';

export function initCFAdapters(namespace: DurableObjectNamespace) {
  setClassroomStore(new CFClassroomStore(namespace));
  setJobStore(new CFJobStore(namespace));
}
