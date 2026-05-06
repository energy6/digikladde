import Dexie, { type Table } from 'dexie';
import type { Course, Student, Flight } from '../models/types';

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
  }
}

export const db = new DigiKladdeDB();