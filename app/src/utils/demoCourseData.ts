import type { Course, CourseSyncSnapshot, CourseType, Flight, Student } from '../models/types';
import { maneuvers } from '../models/types';

export type DemoCourseOptions = {
  seed: number;
  days: number;
  students: number;
  courseType: CourseType;
};

type SeededRandom = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
};

export type DemoCourseDataset = {
  course: Course;
  flights: Flight[];
  seed: number;
  days: number;
  students: Student[];
  courseType: CourseType;
};

export const defaultDemoCourseOptions: DemoCourseOptions = {
  seed: 20260530,
  days: 4,
  students: 6,
  courseType: 'Windenkurs',
};

const flightSchool = 'Demo Flugschule';
const baseDate = new Date(2026, 4, 30, 0, 0, 0, 0);

const studentNames = [
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

const gliders = ['Nova Ion', 'Advance Alpha', 'Skywalk Mescal', 'UP Kibo', 'Ozone Mojo'];
const colors = ['rot', 'blau', 'gruen', 'orange', 'gelb', 'weiss'];
const terrains = ['Wiese Nord', 'Hang Ost', 'Uebungshang Sued', 'Plateau West'];
const teachers = ['M. Steiner', 'A. Keller', 'J. Vogt', 'S. Fischer'];

export const parseDemoCourseType = (raw: string): CourseType => {
  if (raw === 'Grundkurs' || raw === 'Windenkurs' || raw === 'Hoehenkurs' || raw === 'Höhenkurs') {
    return raw === 'Hoehenkurs' ? 'Höhenkurs' : raw;
  }
  throw new Error(`Unbekannter courseType: ${raw}. Erlaubt: Grundkurs, Windenkurs, Hoehenkurs`);
};

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
  const date = new Date(baseDate);
  date.setDate(baseDate.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
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

const buildStudents = (count: number, random: SeededRandom, seed: number): Student[] => {
  const namePool = [...studentNames];
  const students: Student[] = [];

  for (let index = 0; index < count; index += 1) {
    const fallbackName = `Schueler ${index + 1}`;
    const name = namePool.length ? namePool.splice(random.int(0, namePool.length - 1), 1)[0] : fallbackName;

    students.push({
      id: index + 1,
      syncId: `student_demo_${seed}_${index + 1}`,
      updatedAt: toIso(0, 0, 0),
      updatedByDeviceId: 'demo-generator',
      name,
      glider: random.pick(gliders),
      color: random.pick(colors),
      totalFlights: random.int(0, 20),
      totalAltitudeMeters: 0,
      flightSchool,
    });
  }

  return students;
};

const buildFlights = (
  courseId: number,
  students: Student[],
  days: number,
  random: SeededRandom,
  courseType: CourseType,
  seed: number,
): Flight[] => {
  const flights: Flight[] = [];
  let flightId = 1;

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
              startTeacher: random.pick(teachers),
              landPlace: random.pick(['Landeplatz Nord', 'Landeplatz Tal', 'Landeplatz Wiese']),
              landTeacher: random.pick(teachers),
              altitudeDifferenceMeters: random.pick([350, 420, 500, 650, 780]),
            }
          : {
              terrain: random.pick(terrains),
              teacher: random.pick(teachers),
              startLeiter: random.pick(students).name,
            };

        flights.push({
          id: flightId,
          syncId: `flight_demo_${seed}_${flightId}`,
          updatedAt: toIso(dayIndex, 0, 0),
          updatedByDeviceId: 'demo-generator',
          courseId,
          studentId: student.id ?? 0,
          startTime: toIso(dayIndex, startHour, startMinute),
          endTime: toIso(dayIndex, endHour, endMinute),
          landingFinalizedAt: toIso(dayIndex, endHour, endMinute),
          maneuvers: courseType === 'Grundkurs' ? [] : pickManeuvers(random),
          remarks: [`Seed ${random.int(1000, 9999)} - Demoeintrag`],
          details,
        });

        flightId += 1;
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
    const refDate = new Date(baseDate);
    refDate.setDate(baseDate.getDate() + day);
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

const buildCourse = (courseId: number, students: Student[], days: number, courseType: CourseType, seed: number): Course => {
  const startDate = toIso(0, 0, 0);
  const endDate = toIso(days - 1, 23, 59);

  return {
    id: courseId,
    syncId: `course_demo_${seed}`,
    updatedAt: startDate,
    updatedByDeviceId: 'demo-generator',
    name: `Demo ${courseType} Seed ${seed}`,
    courseType,
    startDate,
    endDate,
    flightSchool,
    students,
  };
};

export const buildDemoCourseDataset = (options: DemoCourseOptions): DemoCourseDataset => {
  const random = createSeededRandom(options.seed);
  const courseId = 1;
  const students = buildStudents(options.students, random, options.seed);
  const course = buildCourse(courseId, students, options.days, options.courseType, options.seed);
  const flights = buildFlights(courseId, students, options.days, random, options.courseType, options.seed);

  const courseFlightCountByStudentId = new Map<number, number>();
  const courseAltitudeByStudentId = new Map<number, number>();
  for (const flight of flights) {
    courseFlightCountByStudentId.set(flight.studentId, (courseFlightCountByStudentId.get(flight.studentId) ?? 0) + 1);
    courseAltitudeByStudentId.set(
      flight.studentId,
      (courseAltitudeByStudentId.get(flight.studentId) ?? 0) + (flight.details?.altitudeDifferenceMeters ?? 0),
    );
  }

  for (const student of students) {
    student.totalFlights += courseFlightCountByStudentId.get(student.id ?? 0) ?? 0;
    student.totalAltitudeMeters += courseAltitudeByStudentId.get(student.id ?? 0) ?? 0;
  }

  course.students = students;
  validateDataset(flights, students, options.days);

  return {
    course,
    flights,
    seed: options.seed,
    days: options.days,
    students,
    courseType: options.courseType,
  };
};

export const buildDemoCourseSnapshot = (options: DemoCourseOptions, exportedAt = new Date().toISOString()): CourseSyncSnapshot => {
  const dataset = buildDemoCourseDataset(options);
  const studentSyncIdById = new Map(
    dataset.students.map((student) => [student.id ?? 0, student.syncId ?? `student_demo_${options.seed}_${student.id ?? 0}`]),
  );

  return {
    snapshotVersion: 1,
    exportedAt,
    course: {
      syncId: dataset.course.syncId ?? `course_demo_${options.seed}`,
      updatedAt: dataset.course.updatedAt,
      updatedByDeviceId: dataset.course.updatedByDeviceId,
      name: dataset.course.name,
      courseType: dataset.course.courseType,
      startDate: dataset.course.startDate,
      endDate: dataset.course.endDate,
      flightSchool: dataset.course.flightSchool,
      flightDefaults: dataset.course.flightDefaults,
      students: dataset.students.map((student) => ({
        syncId: student.syncId ?? `student_demo_${options.seed}_${student.id ?? 0}`,
        updatedAt: student.updatedAt,
        updatedByDeviceId: student.updatedByDeviceId,
        name: student.name,
        glider: student.glider,
        color: student.color,
        totalFlights: student.totalFlights,
        totalAltitudeMeters: student.totalAltitudeMeters,
        flightSchool: student.flightSchool,
        lastRatings: student.lastRatings,
        photoDataUrl: student.photoDataUrl,
      })),
    },
    flights: dataset.flights.map((flight) => ({
      syncId: flight.syncId ?? `flight_demo_${options.seed}_${flight.id ?? 0}`,
      studentSyncId: studentSyncIdById.get(flight.studentId) ?? `student_demo_${options.seed}_${flight.studentId}`,
      updatedAt: flight.updatedAt,
      updatedByDeviceId: flight.updatedByDeviceId,
      maneuvers: [...flight.maneuvers],
      ratings: flight.ratings,
      remarks: flight.remarks ? [...flight.remarks] : undefined,
      details: flight.details,
      startTime: flight.startTime,
      landingMarkedAt: flight.landingMarkedAt,
      landingPendingUntil: flight.landingPendingUntil,
      landingFinalizedAt: flight.landingFinalizedAt,
      endTime: flight.endTime,
    })),
  };
};
