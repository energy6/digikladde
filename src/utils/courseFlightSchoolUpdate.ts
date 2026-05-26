import { db } from '../db/database';
import type { Course } from '../models/types';
import { isUnknownFlightSchool, sanitizeFlightSchoolName } from './flightSchool';

type CourseUpdateInput = {
  name: string;
  courseType: Course['courseType'];
  startDate: string;
  endDate: string;
  flightSchool: string;
};

export const updateCourseWithFlightSchoolRules = async (
  courseId: number,
  update: CourseUpdateInput,
): Promise<Course | null> => {
  const normalizedTargetSchool = sanitizeFlightSchoolName(update.flightSchool);
  let updatedCourse: Course | null = null;

  await db.transaction('rw', db.courses, db.students, async () => {
    const currentCourse = await db.courses.get(courseId);
    if (!currentCourse) return;

    const previousCourseSchool = sanitizeFlightSchoolName(currentCourse.flightSchool);

    await db.courses.update(courseId, {
      name: update.name,
      courseType: update.courseType,
      startDate: update.startDate,
      endDate: update.endDate,
      flightSchool: normalizedTargetSchool,
    });

    const shouldPromoteUnknownStudents =
      isUnknownFlightSchool(previousCourseSchool)
      && !isUnknownFlightSchool(normalizedTargetSchool)
      && previousCourseSchool !== normalizedTargetSchool;

    if (shouldPromoteUnknownStudents) {
      const promotedIds = new Set<number>();

      for (const courseStudent of currentCourse.students) {
        if (!courseStudent.id) continue;

        const dbStudent = await db.students.get(courseStudent.id);
        if (!dbStudent || !isUnknownFlightSchool(dbStudent.flightSchool)) continue;

        await db.students.update(dbStudent.id!, { flightSchool: normalizedTargetSchool });
        promotedIds.add(dbStudent.id!);
      }

      const latestCourse = await db.courses.get(courseId);
      if (latestCourse) {
        const updatedSnapshot = latestCourse.students.map((student) => {
          const hasNoPersistentId = !student.id;
          const isPromotedStudent = student.id ? promotedIds.has(student.id) : false;
          const shouldUpdateSnapshot = isUnknownFlightSchool(student.flightSchool)
            && (hasNoPersistentId || isPromotedStudent);

          if (!shouldUpdateSnapshot) return student;
          return { ...student, flightSchool: normalizedTargetSchool };
        });

        await db.courses.update(courseId, {
          students: updatedSnapshot,
          flightSchool: normalizedTargetSchool,
        });
      }
    }

    const finalCourse = await db.courses.get(courseId);
    updatedCourse = finalCourse ?? null;
  });

  return updatedCourse;
};
