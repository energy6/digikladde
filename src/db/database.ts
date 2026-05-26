import Dexie, { type Table } from 'dexie';
import type { Course, Flight, Student } from '../models/types';
import { sanitizeFlightSchoolName } from '../utils/flightSchool';

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
    this.version(3)
      .stores({
        courses: '++id, name, startDate, endDate, flightSchool',
        students: '++id, name, glider, color, flightSchool',
        flights: '++id, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt',
      })
      .upgrade(async (tx) => {
        await tx.table<Course>('courses').toCollection().modify((course) => {
          const nextSchool = sanitizeFlightSchoolName(course.flightSchool);
          const nextStudents = (course.students ?? []).map((student) => ({
            ...student,
            flightSchool: sanitizeFlightSchoolName(student.flightSchool ?? nextSchool),
          }));

          course.flightSchool = nextSchool;
          course.students = nextStudents;
        });

        await tx.table<Student>('students').toCollection().modify((student) => {
          student.flightSchool = sanitizeFlightSchoolName(student.flightSchool);
        });
      });
  }
}

export const db = new DigiKladdeDB();
