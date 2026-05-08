import Dexie, { type Table } from 'dexie';
import type { Course, Flight, Student } from '../models/types';

export class DigiKladdeDB extends Dexie {
  courses!: Table<Course>;
  students!: Table<Student>;
  flights!: Table<Flight>;

  constructor() {
    super('DigiKladdeDB');
    this.version(1).stores({
      courses: '++id, name, startDate, endDate',
      students: '++id, name, glider, color',
      flights: '++id, courseId, studentId, startTime, endTime',
    });
    this.version(2).stores({
      courses: '++id, name, startDate, endDate',
      students: '++id, name, glider, color',
      flights: '++id, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt',
    });
  }
}

export const db = new DigiKladdeDB();
