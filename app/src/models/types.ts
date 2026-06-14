export type CourseType = 'Grundkurs' | 'Windenkurs' | 'Höhenkurs';

export const courseTypes: CourseType[] = ['Grundkurs', 'Windenkurs', 'Höhenkurs'];

export type SyncEntityType = 'course' | 'student' | 'flight';

export type SyncOperationType =
  | 'course_upsert'
  | 'student_upsert'
  | 'student_delete'
  | 'flight_upsert'
  | 'flight_delete';

export type ShareSessionState = 'idle' | 'connecting' | 'connected' | 'error';

export interface SyncMetadata {
  syncId?: string;
  updatedAt?: string;
  updatedByDeviceId?: string;
}

export interface Course extends SyncMetadata {
  id?: number;
  name: string;
  courseType: CourseType;
  startDate: string;
  endDate: string;
  flightSchool: string;
  students: Student[];
  flightDefaults?: FlightDetails;
}

export interface Student extends SyncMetadata {
  id?: number;
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
  flightSchool: string;
  lastRatings?: ManeuverRatings;
  photoDataUrl?: string;
}

export interface FlightDetails {
  terrain?: string;       // Grundkurs, Windenkurs
  teacher?: string;       // Grundkurs, Windenkurs
  startLeiter?: string;   // Windenkurs
  startPlace?: string;    // Höhenkurs
  startTeacher?: string;  // Höhenkurs
  landPlace?: string;     // Höhenkurs
  landTeacher?: string;   // Höhenkurs
}

export interface Flight extends SyncMetadata {
  id?: number;
  courseId: number;
  studentId: number;
  maneuvers: string[];
  ratings?: ManeuverRatings;
  remarks?: string[];
  details?: FlightDetails;
  startTime: string;
  landingMarkedAt?: string;
  landingPendingUntil?: string;
  landingFinalizedAt?: string;
  endTime?: string;
}

export type ManeuverRatings = Record<string, number>;

export const startRatingKey = 'Start';
export const landingRatingKey = 'Landung';

export const maneuvers = [
  'Ohren anlegen',
  'Klapper',
  'Acht',
  'Rollen',
  'Nicken',
  'B-Stall',
  'Prüfungssimulation',
];

export interface RelaySyncEnvelope<TPayload = unknown> {
  version: 1;
  schemaVersion: 1;
  roomId: string;
  courseSyncId: string;
  deviceId: string;
  opId: string;
  opTs: string;
  operation: SyncOperationType;
  payload: TPayload;
}

export interface SyncEvent {
  id?: number;
  opId: string;
  roomId: string;
  courseSyncId: string;
  entityType: SyncEntityType;
  entitySyncId: string;
  operation: SyncOperationType;
  opTs: string;
  deviceId: string;
  payload: unknown;
}

export interface ShareSession {
  id?: number;
  courseSyncId: string;
  roomId: string;
  joinSecret: string;
  relayBaseUrl: string;
  deviceId: string;
  username: string;
  state: ShareSessionState;
  lastSyncedAt?: string;
  lastRelayQueueSeq?: number;
  pushSubscribedAt?: string;
  updatedAt: string;
}

export interface SharedStudentSnapshot extends SyncMetadata {
  syncId: string;
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
  flightSchool: string;
  lastRatings?: ManeuverRatings;
  photoDataUrl?: string;
}

export interface SharedFlightSnapshot extends SyncMetadata {
  syncId: string;
  studentSyncId: string;
  maneuvers: string[];
  ratings?: ManeuverRatings;
  remarks?: string[];
  details?: FlightDetails;
  startTime: string;
  landingMarkedAt?: string;
  landingPendingUntil?: string;
  landingFinalizedAt?: string;
  endTime?: string;
}

export interface CourseSyncSnapshot {
  snapshotVersion: 1;
  exportedAt: string;
  roomId?: string;
  course: {
    syncId: string;
    updatedAt?: string;
    updatedByDeviceId?: string;
    name: string;
    courseType: CourseType;
    startDate: string;
    endDate: string;
    flightSchool: string;
    flightDefaults?: FlightDetails;
    students: SharedStudentSnapshot[];
  };
  flights: SharedFlightSnapshot[];
}
