export interface Course {
  id?: number;
  name: string;
  startDate: string;
  endDate: string;
  students: Student[];
}

export interface Student {
  id?: number;
  name: string;
  glider: string;
  color: string;
}

export interface Flight {
  id?: number;
  courseId: number;
  studentId: number;
  maneuvers: string[];
  startTime: string;
  endTime?: string;
}

export const maneuvers = [
  'Ohren anlegen',
  'Klapper',
  'Acht',
  // Add more as needed
];