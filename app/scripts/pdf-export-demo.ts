/* eslint-env node */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Course, CourseType, Flight, Student } from '../src/models/types';
import { maneuvers } from '../src/models/types';
import { createCoursePDFArrayBuffer } from '../src/utils/pdfExport';

type DemoCliOptions = {
  seed: number;
  output: string;
  days: number;
  students: number;
  courseType: CourseType;
};

type SeededRandom = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
};

const DEFAULTS: DemoCliOptions = {
  seed: 20260530,
  output: 'output/Kursbericht_Demo.pdf',
  days: 4,
  students: 6,
  courseType: 'Windenkurs',
};

const FLIGHT_SCHOOL = 'Demo Flugschule';
const BASE_DATE = new Date(2026, 4, 30, 0, 0, 0, 0);

const STUDENT_NAMES = [
  'Mia Bauer',
  'Lukas Neumann',
  'Hannah Wolf',
  'Noah Klein',
  'Emma Vogel',
  'Paul Richter',
  'Lea Braun',
  'Finn Hartmann',
  'Sophie Keller',
  'Jonas Schmitt',
  'Clara Weber',
  'Ben Hoffmann',
];

const GLIDERS = ['Nova Ion', 'Advance Alpha', 'Skywalk Mescal', 'UP Kibo', 'Ozone Mojo'];
const COLORS = ['rot', 'blau', 'gruen', 'orange', 'gelb', 'weiss'];
const TERRAINS = ['Wiese Nord', 'Hang Ost', 'Uebungshang Sued', 'Plateau West'];
const TEACHERS = ['M. Steiner', 'A. Keller', 'J. Vogt', 'S. Fischer'];

const createSeededRandom = (seed: number): SeededRandom => {
  let state = seed >>> 0;
  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  const int = (min: number, max: number) => {
    if (max < min) throw new Error(`Invalid range: ${min}..${max}`);
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]) => {
    if (!items.length) throw new Error('Cannot pick from empty list');
    return items[int(0, items.length - 1)];
  };

  return { next, int, pick };
};

const toIso = (dayOffset: number, hour: number, minute: number) => {
  const date = new Date(BASE_DATE);
  date.setDate(BASE_DATE.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

const parseCourseType = (raw: string): CourseType => {
  if (raw === 'Grundkurs' || raw === 'Windenkurs' || raw === 'Hoehenkurs' || raw === 'Höhenkurs') {
    return raw === 'Hoehenkurs' ? 'Höhenkurs' : raw;
  }
  throw new Error(`Unbekannter courseType: ${raw}. Erlaubt: Grundkurs, Windenkurs, Hoehenkurs`);
};

const parseCliOptions = (): DemoCliOptions => {
  const args = process.argv.slice(2);
  const options: DemoCliOptions = { ...DEFAULTS };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--seed') {
      options.seed = Number.parseInt(args[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg === '--output') {
      options.output = args[index + 1] ?? DEFAULTS.output;
      index += 1;
      continue;
    }

    if (arg === '--days') {
      options.days = Number.parseInt(args[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg === '--students') {
      options.students = Number.parseInt(args[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg === '--course-type') {
      options.courseType = parseCourseType(args[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run demo:pdf-export -- [--seed 42] [--output output/demo.pdf] [--days 4] [--students 6] [--course-type Windenkurs]');
      process.exit(0);
    }

    throw new Error(`Unbekanntes Argument: ${arg}`);
  }

  if (!Number.isInteger(options.seed)) throw new Error('seed muss eine Ganzzahl sein');
  if (!Number.isInteger(options.days) || options.days < 1) throw new Error('days muss >= 1 sein');
  if (!Number.isInteger(options.students) || options.students < 1) throw new Error('students muss >= 1 sein');

  return options;
};

const pickManeuvers = (random: SeededRandom) => {
  const count = random.int(1, 3);
  const copy = [...maneuvers];
  const selected: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const position = random.int(0, copy.length - 1);
    selected.push(copy[position]);
    copy.splice(position, 1);
  }

  return selected;
};

const buildStudents = (count: number, random: SeededRandom): Student[] => {
  const namePool = [...STUDENT_NAMES];
  const students: Student[] = [];

  for (let index = 0; index < count; index += 1) {
    const fallbackName = `Schueler ${index + 1}`;
    const name = namePool.length ? namePool.splice(random.int(0, namePool.length - 1), 1)[0] : fallbackName;

    students.push({
      id: index + 1,
      name,
      glider: random.pick(GLIDERS),
      color: random.pick(COLORS),
      totalFlights: random.int(0, 20),
      flightSchool: FLIGHT_SCHOOL,
    });
  }

  return students;
};

const buildFlights = (courseId: number, students: Student[], days: number, random: SeededRandom, courseType: CourseType): Flight[] => {
  const flights: Flight[] = [];

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    for (const student of students) {
      const flightsPerStudent = random.int(3, 5);
      let minuteCursor = 8 * 60 + random.int(0, 30);

      for (let flightIndex = 0; flightIndex < flightsPerStudent; flightIndex += 1) {
        const durationMinutes = random.int(10, 20);
        const startHour = Math.floor(minuteCursor / 60);
        const startMinute = minuteCursor % 60;
        const endTotalMinutes = minuteCursor + durationMinutes;
        const endHour = Math.floor(endTotalMinutes / 60);
        const endMinute = endTotalMinutes % 60;

        const details = courseType === 'Höhenkurs'
          ? {
              startPlace: random.pick(['Startplatz A', 'Startplatz B', 'Startplatz C']),
              startTeacher: random.pick(TEACHERS),
              landPlace: random.pick(['Landeplatz Nord', 'Landeplatz Tal', 'Landeplatz Wiese']),
              landTeacher: random.pick(TEACHERS),
            }
          : {
              terrain: random.pick(TERRAINS),
              teacher: random.pick(TEACHERS),
              startLeiter: random.pick(students).name,
            };

        flights.push({
          courseId,
          studentId: student.id ?? 0,
          startTime: toIso(dayIndex, startHour, startMinute),
          endTime: toIso(dayIndex, endHour, endMinute),
          maneuvers: courseType === 'Grundkurs' ? [] : pickManeuvers(random),
          remarks: [`Seed ${random.int(1000, 9999)} - Demoeintrag`],
          details,
        });

        minuteCursor = endTotalMinutes + random.int(12, 28);
      }
    }
  }

  return flights;
};

const validateDataset = (flights: Flight[], students: Student[], days: number) => {
  const byDayStudent = new Map<string, number>();

  for (const flight of flights) {
    const start = new Date(flight.startTime);
    const end = new Date(flight.endTime ?? flight.startTime);
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

    if (durationMinutes < 10 || durationMinutes > 20) {
      throw new Error(`Ungueltige Flugdauer (${durationMinutes} min) fuer studentId=${flight.studentId}`);
    }

    const dayKey = `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
    const key = `${dayKey}::${flight.studentId}`;
    byDayStudent.set(key, (byDayStudent.get(key) ?? 0) + 1);
  }

  for (let day = 0; day < days; day += 1) {
    const refDate = new Date(BASE_DATE);
    refDate.setDate(BASE_DATE.getDate() + day);
    const dayKey = `${refDate.getFullYear()}-${refDate.getMonth() + 1}-${refDate.getDate()}`;

    for (const student of students) {
      const key = `${dayKey}::${student.id ?? 0}`;
      const count = byDayStudent.get(key) ?? 0;
      if (count < 3 || count > 5) {
        throw new Error(`Regel verletzt: ${student.name} hat am Tag ${day + 1} ${count} Fluege (erwartet 3-5)`);
      }
    }
  }
};

const buildCourse = (courseId: number, students: Student[], days: number, courseType: CourseType): Course => {
  const startDate = toIso(0, 0, 0);
  const endDate = toIso(days - 1, 23, 59);

  return {
    id: courseId,
    name: `Demo ${courseType} Seed`,
    courseType,
    startDate,
    endDate,
    flightSchool: FLIGHT_SCHOOL,
    students,
  };
};

const main = async () => {
  const options = parseCliOptions();
  const random = createSeededRandom(options.seed);
  const courseId = 1;

  const students = buildStudents(options.students, random);
  const course = buildCourse(courseId, students, options.days, options.courseType);
  const flights = buildFlights(courseId, students, options.days, random, options.courseType);

  const courseFlightCountByStudentId = new Map<number, number>();
  for (const flight of flights) {
    courseFlightCountByStudentId.set(flight.studentId, (courseFlightCountByStudentId.get(flight.studentId) ?? 0) + 1);
  }
  for (const student of students) {
    student.totalFlights += courseFlightCountByStudentId.get(student.id ?? 0) ?? 0;
  }
  course.students = students;

  validateDataset(flights, students, options.days);

  const outputPath = resolve(process.cwd(), options.output);
  await mkdir(dirname(outputPath), { recursive: true });

  const arrayBuffer = createCoursePDFArrayBuffer(course, flights, {
    appVersion: `demo-seed-${options.seed}`,
    locale: 'de-DE',
  });

  await writeFile(outputPath, Buffer.from(arrayBuffer));

  console.log(`PDF Demo erstellt: ${outputPath}`);
  console.log(`Seed: ${options.seed}`);
  console.log(`Kurstyp: ${options.courseType}`);
  console.log(`Tage: ${options.days}`);
  console.log(`Schueler: ${students.length}`);
  console.log(`Fluege gesamt: ${flights.length}`);
};

void main();
