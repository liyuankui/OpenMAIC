import { setClassroomStore, setJobStore } from './index';
import { NodeClassroomStore } from './node-classroom-store';
import { NodeJobStore } from './node-job-store';

export function initNodeAdapters() {
  setClassroomStore(new NodeClassroomStore());
  setJobStore(new NodeJobStore());
}
