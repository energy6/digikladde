export type CourseType = 'Grundkurs' | 'Windenkurs' | 'Höhenkurs';

export const courseTypes: CourseType[] = ['Grundkurs', 'Windenkurs', 'Höhenkurs'];

export interface Course {
  id?: number;
  name: string;
  courseType: CourseType;
  startDate: string;
  endDate: string;
  students: Student[];
}

export interface Student {
  id?: number;
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
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
