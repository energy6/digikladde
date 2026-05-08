export type CourseType = 'Grundkurs' | 'Windenkurs' | 'Höhenkurs';

export const courseTypes: CourseType[] = ['Grundkurs', 'Windenkurs', 'Höhenkurs'];

export interface Course {
  id?: number;
  name: string;
  courseType: CourseType;
  startDate: string;
  endDate: string;
  students: Student[];
  flightDefaults?: FlightDetails;
}

export interface Student {
  id?: number;
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
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

export interface Flight {
  id?: number;
  courseId: number;
  studentId: number;
  maneuvers: string[];
  remarks?: string[];
  details?: FlightDetails;
  startTime: string;
  landingMarkedAt?: string;
  landingPendingUntil?: string;
  landingFinalizedAt?: string;
  endTime?: string;
}

export const maneuvers = [
  'Ohren anlegen',
  'Klapper',
  'Acht',
  'Rollen',
  'Nicken',
  'B-Stall',
];
