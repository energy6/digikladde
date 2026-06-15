import { PlusOutlined } from '@ant-design/icons';
import { faTrashCan, faSortDown, faSortUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, List, Modal, Popconfirm, Space, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFlightSchool } from '../context/FlightSchoolContext';
import { useRelaySync } from '../context/RelaySyncContext';
import { db } from '../db/database';
import type { Course, Flight, FlightDetails, ManeuverRatings, Student } from '../models/types';
import { getFlightDetailOptions, rememberFlightDetails } from '../utils/flightDetailHistory';
import { ALL_FLIGHT_SCHOOLS, extractFlightSchools, sanitizeFlightSchoolName } from '../utils/flightSchool';
import { createId } from '../utils/idGenerator';
import { buildRatings, hasSameRatings, normalizeRating } from '../utils/maneuverRatings';
import CourseHeader from './CourseHeader';
import CourseSyncFooter from './CourseSyncFooter';
import { ActiveStudentListItem, IdleStudentListItem, PendingStudentListItem } from './courseStudentList';
import { AddStudentModal, EditStudentModal, RemarksModal, StartFlightModal } from './modals';

const { Text } = Typography;
const LANDING_PENDING_MS = 5 * 60 * 1000;

const createNewStudentDraft = (flightSchool: string): Student => ({
  name: '',
  glider: '',
  color: '',
  totalFlights: 0,
  flightSchool,
});

const createSyncNotification = (body: string, courseName?: string) => ({
  title: 'DigiKladde',
  body: courseName ? `${body} (${courseName})` : body,
});

const hasSameManeuverSelection = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();

  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

type ActiveEntry = {
  kind: 'active';
  student: Student;
  flight: Flight;
};

type PendingEntry = {
  kind: 'pending';
  student: Student;
  flight: Flight;
};

type IdleEntry = {
  kind: 'idle';
  student: Student;
};

type StudentListEntry = ActiveEntry | PendingEntry | IdleEntry;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

const CourseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { activeFlightSchool } = useFlightSchool();
  const { deviceId, logCourseDelta, subscribeCourseChanges, subscribeSnapshotImports } = useRelaySync();
  const [course, setCourse] = useState<Course | null>(null);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [newStudent, setNewStudent] = useState<Student>(createNewStudentDraft(sanitizeFlightSchoolName(activeFlightSchool)));
  const [selectedFlightStudent, setSelectedFlightStudent] = useState<Student | null>(null);
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);
  const [flightDetails, setFlightDetails] = useState<FlightDetails>({});
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [nowTs, setNowTs] = useState(0);
  const [remarksModalVisible, setRemarksModalVisible] = useState(false);
  const [selectedRemarkFlight, setSelectedRemarkFlight] = useState<{ flightId: number; studentName: string } | null>(null);
  const [existingRemarks, setExistingRemarks] = useState<string[]>([]);
  const [selectedRemarkManeuvers, setSelectedRemarkManeuvers] = useState<string[]>([]);
  const [initialRemarkManeuvers, setInitialRemarkManeuvers] = useState<string[]>([]);
  const [selectedRemarkRatings, setSelectedRemarkRatings] = useState<ManeuverRatings>({});
  const [initialRemarkRatings, setInitialRemarkRatings] = useState<ManeuverRatings>({});
  const [selectedRemarkStudentLastRatings, setSelectedRemarkStudentLastRatings] = useState<ManeuverRatings>({});
  const [newRemark, setNewRemark] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [remarksReadOnly, setRemarksReadOnly] = useState(false);
  const [remarksContextText, setRemarksContextText] = useState('');
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const isPendingLanding = (flight: Flight) => Boolean(flight.landingPendingUntil && !flight.landingFinalizedAt);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [currentCourse, students, courseFlights] = await Promise.all([
      db.courses.get(Number(id)),
      db.students.toArray(),
      db.flights.where('courseId').equals(Number(id)).toArray(),
    ]);

    // Ensure embedded students have local IDs resolved from students table
    if (currentCourse) {
      const needsResolution = currentCourse.students.some((s) => !s.id && s.syncId);
      if (needsResolution) {
        const syncIdToId = new Map(
          students.filter((s) => s.id && s.syncId).map((s) => [s.syncId!, s.id!]),
        );
        currentCourse.students = currentCourse.students.map((s) => {
          if (s.id || !s.syncId) return s;
          const localId = syncIdToId.get(s.syncId);
          return localId ? { ...s, id: localId } : s;
        });
      }
    }

    setCourse(currentCourse || null);
    setAllStudents(students);
    setFlights(courseFlights);
  }, [id]);

  const finalizePendingFlights = useCallback(async () => {
    if (!id) return false;
    const courseId = Number(id);
    const courseFlights = await db.flights.where('courseId').equals(courseId).toArray();
    const pendingToFinalize = courseFlights.filter((flight) => {
      if (!flight.id || !flight.landingPendingUntil || flight.landingFinalizedAt) return false;
      return Date.parse(flight.landingPendingUntil) <= Date.now();
    });

    if (!pendingToFinalize.length) return false;

    for (const pendingFlight of pendingToFinalize) {
      if (!pendingFlight.id) continue;
      let finalizedFlightSyncId: string | undefined;
      let finalizedFlightStudentId: number | undefined;

      await db.transaction('rw', db.flights, db.students, db.courses, async () => {
        const freshFlight = await db.flights.get(pendingFlight.id!);
        if (!freshFlight || !freshFlight.landingPendingUntil || freshFlight.landingFinalizedAt) return;
        if (Date.parse(freshFlight.landingPendingUntil) > Date.now()) return;

        const finalizedAt = new Date().toISOString();
        const finalizedEndTime = freshFlight.endTime ?? freshFlight.landingMarkedAt ?? finalizedAt;

        await db.flights.update(freshFlight.id!, {
          updatedAt: finalizedAt,
          updatedByDeviceId: deviceId,
          endTime: finalizedEndTime,
          landingFinalizedAt: finalizedAt,
          landingPendingUntil: undefined,
        });

        finalizedFlightSyncId = freshFlight.syncId;
        finalizedFlightStudentId = freshFlight.studentId;

        const student = await db.students.get(freshFlight.studentId);
        if (!student || !student.id) return;

        const newTotal = (student.totalFlights ?? 0) + 1;
        await db.students.update(student.id, {
          totalFlights: newTotal,
          updatedAt: finalizedAt,
          updatedByDeviceId: deviceId,
        });

        const currentCourse = await db.courses.get(freshFlight.courseId);
        if (!currentCourse) return;

        const updatedStudents = currentCourse.students.map((s) =>
          s.id === student.id
            ? {
                ...s,
                totalFlights: newTotal,
                updatedAt: finalizedAt,
                updatedByDeviceId: deviceId,
              }
            : s,
        );
        await db.courses.update(freshFlight.courseId, { students: updatedStudents });
      });

      if (finalizedFlightSyncId && finalizedFlightStudentId) {
        const finalizedFlight = await db.flights.where('syncId').equals(finalizedFlightSyncId).first();
        const finalizedStudent = await db.students.get(finalizedFlightStudentId);
        const studentSyncId = finalizedStudent?.syncId;

        if (finalizedFlight) {
          await logCourseDelta({
            courseId,
            operation: 'flight_upsert',
            entitySyncId: finalizedFlightSyncId,
            payload: {
              syncId: finalizedFlightSyncId,
              studentSyncId,
              studentId: finalizedFlight.studentId,
              endTime: finalizedFlight.endTime,
              landingPendingUntil: finalizedFlight.landingPendingUntil,
              landingFinalizedAt: finalizedFlight.landingFinalizedAt,
              updatedAt: finalizedFlight.updatedAt,
              updatedByDeviceId: finalizedFlight.updatedByDeviceId,
            },
          });
        }

        if (finalizedStudent) {
          await logCourseDelta({
            courseId,
            operation: 'student_upsert',
            entitySyncId: finalizedStudent.syncId ?? createId('student'),
            payload: {
              syncId: finalizedStudent.syncId,
              name: finalizedStudent.name,
              glider: finalizedStudent.glider,
              color: finalizedStudent.color,
              totalFlights: finalizedStudent.totalFlights,
              flightSchool: finalizedStudent.flightSchool,
              lastRatings: finalizedStudent.lastRatings,
              photoDataUrl: finalizedStudent.photoDataUrl ?? null,
              updatedAt: finalizedStudent.updatedAt,
              updatedByDeviceId: finalizedStudent.updatedByDeviceId,
            },
          });
        }
      }
    }

    return true;
  }, [deviceId, id, logCourseDelta]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!id) return;

      const hadFinalizedFlights = await finalizePendingFlights();

      const [currentCourse, students, courseFlights] = await Promise.all([
        db.courses.get(Number(id)),
        db.students.toArray(),
        db.flights.where('courseId').equals(Number(id)).toArray(),
      ]);

      if (cancelled) return;

      setCourse(currentCourse || null);
      setAllStudents(students);
      setFlights(courseFlights);

      if (hadFinalizedFlights && !cancelled) {
        const [updatedCourse, updatedStudents, updatedFlights] = await Promise.all([
          db.courses.get(Number(id)),
          db.students.toArray(),
          db.flights.where('courseId').equals(Number(id)).toArray(),
        ]);
        setCourse(updatedCourse || null);
        setAllStudents(updatedStudents);
        setFlights(updatedFlights);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, finalizePendingFlights]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void (async () => {
        const didFinalize = await finalizePendingFlights();
        if (didFinalize) {
          await refresh();
        }
      })();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [finalizePendingFlights, refresh]);

  useEffect(() => {
    if (!id) return;
    const courseId = Number(id);
    return subscribeSnapshotImports(courseId, () => {
      void refresh();
    });
  }, [id, refresh, subscribeSnapshotImports]);

  useEffect(() => {
    if (!id) return;
    const courseId = Number(id);
    return subscribeCourseChanges(courseId, () => {
      void refresh();
    });
  }, [id, refresh, subscribeCourseChanges]);

  const activeFlights = useMemo(
    () => flights
      .filter((flight) => !flight.endTime && !isPendingLanding(flight))
      .sort((a, b) => {
        const aStart = Date.parse(a.startTime);
        const bStart = Date.parse(b.startTime);
        return sortOrder === 'asc' ? aStart - bStart : bStart - aStart;
      }),
    [flights, sortOrder],
  );

  const pendingFlights = useMemo(
    () => flights
      .filter((flight) => !flight.endTime && isPendingLanding(flight))
      .sort((a, b) => {
        const aPending = Date.parse(a.landingPendingUntil ?? a.startTime);
        const bPending = Date.parse(b.landingPendingUntil ?? b.startTime);
        return bPending - aPending;
      }),
    [flights],
  );

  const activeEntries = useMemo<ActiveEntry[]>(() => {
    if (!course) return [];
    return activeFlights
      .map((flight) => {
        const student = course.students.find((s) => s.id === flight.studentId);
        return student ? { kind: 'active', flight, student } : null;
      })
      .filter((entry): entry is ActiveEntry => entry !== null);
  }, [activeFlights, course]);

  const pendingEntries = useMemo<PendingEntry[]>(() => {
    if (!course) return [];
    return pendingFlights
      .map((flight) => {
        const student = course.students.find((s) => s.id === flight.studentId);
        return student ? { kind: 'pending', flight, student } : null;
      })
      .filter((entry): entry is PendingEntry => entry !== null);
  }, [pendingFlights, course]);

  const notFlyingStudents = useMemo(() => {
    if (!course) return [];
    return course.students
      .filter((student) => !activeFlights.some((flight) => flight.studentId === student.id))
      .filter((student) => !pendingFlights.some((flight) => flight.studentId === student.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFlights, pendingFlights, course]);

  const combinedStudentEntries = useMemo<StudentListEntry[]>(() => {
    const notFlying: IdleEntry[] = notFlyingStudents.map((student) => ({
      kind: 'idle',
      student,
    }));

    return [...activeEntries, ...pendingEntries, ...notFlying];
  }, [activeEntries, pendingEntries, notFlyingStudents]);

  const hasRemarksOnLastFlightByStudentId = useMemo(() => {
    const latestByStudent = new Map<number, Flight>();

    flights.forEach((flight) => {
      const currentLatest = latestByStudent.get(flight.studentId);
      if (!currentLatest || flight.startTime > currentLatest.startTime) {
        latestByStudent.set(flight.studentId, flight);
      }
    });

    const hasRemarksMap = new Map<number, boolean>();
    latestByStudent.forEach((flight, studentId) => {
      hasRemarksMap.set(studentId, Boolean(flight.remarks?.length));
    });

    return hasRemarksMap;
  }, [flights]);

  const effectiveFlightSchool = useMemo(() => {
    if (!course) {
      return sanitizeFlightSchoolName(activeFlightSchool);
    }

    if (activeFlightSchool === ALL_FLIGHT_SCHOOLS) {
      return sanitizeFlightSchoolName(course.flightSchool);
    }

    return sanitizeFlightSchoolName(activeFlightSchool);
  }, [activeFlightSchool, course]);

  const flightSchoolOptions = useMemo(() => extractFlightSchools([
    ...allStudents.map((student) => student.flightSchool),
    ...(course?.students ?? []).map((student) => student.flightSchool),
    course?.flightSchool,
    effectiveFlightSchool,
  ]), [allStudents, course, effectiveFlightSchool]);

  const flightDetailOptions = useMemo(() => (
    getFlightDetailOptions(effectiveFlightSchool, course?.flightDefaults)
  ), [course?.flightDefaults, effectiveFlightSchool]);

  const availableExistingStudents = useMemo(() => {
    if (!course) return [];
    return allStudents
      .filter((student) => sanitizeFlightSchoolName(student.flightSchool) === effectiveFlightSchool)
      .filter((student) => !course.students.some((courseStudent) => courseStudent.id === student.id));
  }, [allStudents, course, effectiveFlightSchool]);

  const startLeiterOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [];
    if (flightDetails.teacher) opts.push({ label: `${flightDetails.teacher} (Lehrer)`, value: flightDetails.teacher });
    if (course) {
      course.students.forEach((s) => {
        if (!opts.some((o) => o.value === s.name)) {
          opts.push({ label: s.name, value: s.name });
        }
      });
    }
    return opts;
  }, [flightDetails.teacher, course]);

  const maneuversEnabled = course?.courseType !== 'Grundkurs';
  const hasManeuverChanges = maneuversEnabled
    ? !hasSameManeuverSelection(selectedRemarkManeuvers, initialRemarkManeuvers)
    : false;
  const hasRatingChanges = !hasSameRatings(selectedRemarkRatings, initialRemarkRatings, selectedRemarkManeuvers);
  const canSaveRemarkChanges = newRemark.trim().length > 0 || hasManeuverChanges || hasRatingChanges;

  const resolveStudentSyncId = useCallback(async (studentId: number): Promise<string | undefined> => {
    const embeddedStudent = course?.students.find((student) => student.id === studentId);
    if (embeddedStudent?.syncId) return embeddedStudent.syncId;

    const storedStudent = await db.students.get(studentId);
    if (!storedStudent) return undefined;

    const now = new Date().toISOString();
    const syncId = storedStudent.syncId ?? createId('student');
    const updatedAt = storedStudent.updatedAt ?? now;
    const updatedByDeviceId = storedStudent.updatedByDeviceId ?? deviceId;

    if (!storedStudent.syncId || !storedStudent.updatedAt || !storedStudent.updatedByDeviceId) {
      await db.students.update(studentId, {
        syncId,
        updatedAt,
        updatedByDeviceId,
      });
    }

    if (course?.id) {
      const existsInCourse = course.students.some((student) => student.id === studentId);
      if (existsInCourse) {
        const nextStudents = course.students.map((student) => (
          student.id === studentId
            ? {
                ...student,
                syncId: student.syncId ?? syncId,
                updatedAt: student.updatedAt ?? updatedAt,
                updatedByDeviceId: student.updatedByDeviceId ?? updatedByDeviceId,
              }
            : student
        ));

        await db.courses.update(course.id, { students: nextStudents });
        setCourse((currentCourse) => (
          currentCourse && currentCourse.id === course.id
            ? { ...currentCourse, students: nextStudents }
            : currentCourse
        ));
      }
    }

    return syncId;
  }, [course, deviceId]);

  const logStudentUpsertDelta = useCallback(async (courseId: number, student: Student, body?: string) => {
    if (!student.syncId) return;

    await logCourseDelta({
      courseId,
      operation: 'student_upsert',
      entitySyncId: student.syncId,
      notification: createSyncNotification(body ?? `${student.name} wurde aktualisiert.`, course?.name),
      payload: {
        syncId: student.syncId,
        name: student.name,
        glider: student.glider,
        color: student.color,
        totalFlights: student.totalFlights,
        flightSchool: student.flightSchool,
        lastRatings: student.lastRatings,
        photoDataUrl: student.photoDataUrl ?? null,
        updatedAt: student.updatedAt,
        updatedByDeviceId: student.updatedByDeviceId,
      },
    });
  }, [course?.name, logCourseDelta]);

  const handleAddStudent = async () => {
    if (!course || !id) return;
    const courseId = Number(id);
    const now = new Date().toISOString();

    if (addMode === 'existing' && selectedStudentId) {
      const student = allStudents.find((item) => item.id === selectedStudentId);
      if (!student) return;
      const studentSyncId = student.syncId ?? createId('student');
      const normalizedStudent: Student = {
        ...student,
        syncId: studentSyncId,
        updatedAt: student.updatedAt ?? now,
        updatedByDeviceId: student.updatedByDeviceId ?? deviceId,
      };

      if (student.id) {
        await db.students.update(student.id, {
          syncId: normalizedStudent.syncId,
          updatedAt: normalizedStudent.updatedAt,
          updatedByDeviceId: normalizedStudent.updatedByDeviceId,
        });
      }

      await db.courses.update(courseId, { students: [...course.students, normalizedStudent] });
      await logCourseDelta({
        courseId,
        operation: 'student_upsert',
        entitySyncId: studentSyncId,
        notification: createSyncNotification(`${normalizedStudent.name} wurde hinzugefügt.`, course.name),
        payload: {
          syncId: studentSyncId,
          name: normalizedStudent.name,
          glider: normalizedStudent.glider,
          color: normalizedStudent.color,
          totalFlights: normalizedStudent.totalFlights,
          flightSchool: normalizedStudent.flightSchool,
          lastRatings: normalizedStudent.lastRatings,
          photoDataUrl: normalizedStudent.photoDataUrl ?? null,
          updatedAt: normalizedStudent.updatedAt,
          updatedByDeviceId: normalizedStudent.updatedByDeviceId,
        },
      });
    }

    if (addMode === 'new') {
      const studentToCreate: Student = {
        ...newStudent,
        flightSchool: effectiveFlightSchool,
        syncId: createId('student'),
        updatedAt: now,
        updatedByDeviceId: deviceId,
      };
      const studentId = Number(await db.students.add(studentToCreate));
      const createdStudent = { ...studentToCreate, id: studentId };
      await db.courses.update(courseId, { students: [...course.students, createdStudent] });
      await logCourseDelta({
        courseId,
        operation: 'student_upsert',
        entitySyncId: createdStudent.syncId ?? createId('student'),
        notification: createSyncNotification(`${createdStudent.name} wurde hinzugefügt.`, course.name),
        payload: {
          syncId: createdStudent.syncId,
          name: createdStudent.name,
          glider: createdStudent.glider,
          color: createdStudent.color,
          totalFlights: createdStudent.totalFlights,
          flightSchool: createdStudent.flightSchool,
          lastRatings: createdStudent.lastRatings,
          photoDataUrl: createdStudent.photoDataUrl ?? null,
          updatedAt: createdStudent.updatedAt,
          updatedByDeviceId: createdStudent.updatedByDeviceId,
        },
      });
    }

    setAddModalVisible(false);
    setSelectedStudentId(null);
    setNewStudent(createNewStudentDraft(effectiveFlightSchool));
    await refresh();
  };

  const handleStartFlight = async () => {
    if (!selectedFlightStudent?.id || !id) return;
    const courseId = Number(id);
    const now = new Date().toISOString();
    const studentSyncId = await resolveStudentSyncId(selectedFlightStudent.id);
    const flight: Flight = {
      syncId: createId('flight'),
      updatedAt: now,
      updatedByDeviceId: deviceId,
      courseId,
      studentId: selectedFlightStudent.id,
      maneuvers: maneuversEnabled ? selectedManeuvers : [],
      details: flightDetails,
      startTime: now,
    };
    await db.flights.add(flight);
    await db.courses.update(courseId, { flightDefaults: flightDetails });
    rememberFlightDetails(effectiveFlightSchool, flightDetails);

    await logCourseDelta({
      courseId,
      operation: 'flight_upsert',
      entitySyncId: flight.syncId ?? createId('flight'),
      notification: createSyncNotification(`${selectedFlightStudent.name} wurde gestartet.`, course?.name),
      payload: {
        syncId: flight.syncId,
        studentSyncId,
        studentId: flight.studentId,
        maneuvers: flight.maneuvers,
        details: flight.details,
        startTime: flight.startTime,
        landingMarkedAt: flight.landingMarkedAt,
        landingPendingUntil: flight.landingPendingUntil,
        landingFinalizedAt: flight.landingFinalizedAt,
        endTime: flight.endTime,
        updatedAt: flight.updatedAt,
        updatedByDeviceId: flight.updatedByDeviceId,
      },
    });

    setStartModalVisible(false);
    setSelectedFlightStudent(null);
    setSelectedManeuvers([]);
    setFlightDetails({});
    await refresh();
  };

  const handleSwapStartAndLandTeachers = useCallback(() => {
    setFlightDetails((currentDetails) => ({
      ...currentDetails,
      startTeacher: currentDetails.landTeacher,
      landTeacher: currentDetails.startTeacher,
    }));
  }, []);

  const handleEditStudent = async () => {
    if (!editStudent || !editStudent.id || !course || !id) return;
    const courseId = Number(id);
    const now = new Date().toISOString();
    const studentSyncId = editStudent.syncId ?? createId('student');
    await db.students.update(editStudent.id, {
      syncId: studentSyncId,
      updatedAt: now,
      updatedByDeviceId: deviceId,
      name: editStudent.name,
      glider: editStudent.glider,
      color: editStudent.color,
      totalFlights: editStudent.totalFlights,
      flightSchool: sanitizeFlightSchoolName(editStudent.flightSchool),
      photoDataUrl: editStudent.photoDataUrl,
    });
    const updatedStudents = course.students.map((s) =>
      s.id === editStudent.id
        ? {
            ...editStudent,
            syncId: studentSyncId,
            updatedAt: now,
            updatedByDeviceId: deviceId,
            flightSchool: sanitizeFlightSchoolName(editStudent.flightSchool),
          }
        : s,
    );
    await db.courses.update(courseId, { students: updatedStudents });

    await logCourseDelta({
      courseId,
      operation: 'student_upsert',
      entitySyncId: studentSyncId,
      notification: createSyncNotification(`${editStudent.name} wurde aktualisiert.`, course.name),
      payload: {
        syncId: studentSyncId,
        name: editStudent.name,
        glider: editStudent.glider,
        color: editStudent.color,
        totalFlights: editStudent.totalFlights,
        flightSchool: sanitizeFlightSchoolName(editStudent.flightSchool),
        lastRatings: editStudent.lastRatings,
        photoDataUrl: editStudent.photoDataUrl ?? null,
        updatedAt: now,
        updatedByDeviceId: deviceId,
      },
    });

    setEditModalVisible(false);
    setEditStudent(null);
    await refresh();
  };

  const handleLandFlight = async (flightId: number) => {
    if (!id) return;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const pendingUntilIso = new Date(now + LANDING_PENDING_MS).toISOString();
    await db.flights.update(flightId, {
      updatedAt: nowIso,
      updatedByDeviceId: deviceId,
      landingMarkedAt: new Date(now).toISOString(),
      landingPendingUntil: pendingUntilIso,
      landingFinalizedAt: undefined,
    });
    const flight = await db.flights.get(flightId);
    if (flight?.syncId) {
      const studentSyncId = await resolveStudentSyncId(flight.studentId);
      const studentName = course?.students.find((student) => student.id === flight.studentId)?.name ?? 'Ein Schüler';
      await logCourseDelta({
        courseId: Number(id),
        operation: 'flight_upsert',
        entitySyncId: flight.syncId,
        notification: createSyncNotification(`Landung von ${studentName} wurde markiert.`, course?.name),
        payload: {
          syncId: flight.syncId,
          studentSyncId,
          studentId: flight.studentId,
          landingMarkedAt: nowIso,
          landingPendingUntil: pendingUntilIso,
          landingFinalizedAt: undefined,
          updatedAt: nowIso,
          updatedByDeviceId: deviceId,
        },
      });
    }
    await refresh();
  };

  const handleResumeFlight = async (flightId: number) => {
    if (!id) return;
    const now = new Date().toISOString();
    await db.flights.update(flightId, {
      updatedAt: now,
      updatedByDeviceId: deviceId,
      landingMarkedAt: undefined,
      landingPendingUntil: undefined,
      landingFinalizedAt: undefined,
    });
    const flight = await db.flights.get(flightId);
    if (flight?.syncId) {
      const studentSyncId = await resolveStudentSyncId(flight.studentId);
      const studentName = course?.students.find((student) => student.id === flight.studentId)?.name ?? 'Ein Schüler';
      await logCourseDelta({
        courseId: Number(id),
        operation: 'flight_upsert',
        entitySyncId: flight.syncId,
        notification: createSyncNotification(`Landung von ${studentName} wurde zurückgenommen.`, course?.name),
        payload: {
          syncId: flight.syncId,
          studentSyncId,
          studentId: flight.studentId,
          landingMarkedAt: undefined,
          landingPendingUntil: undefined,
          landingFinalizedAt: undefined,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        },
      });
    }
    await refresh();
  };

  const handleTerminateFlight = async (flightId: number) => {
    if (!id) return;
    const courseId = Number(id);
    let finalizedFlightSyncId: string | undefined;
    let finalizedFlightStudentId: number | undefined;

    await db.transaction('rw', db.flights, db.students, db.courses, async () => {
      const flight = await db.flights.get(flightId);
      if (!flight || !flight.id || flight.landingFinalizedAt) return;

      const finalizedAt = new Date().toISOString();
      const finalizedEndTime = flight.endTime ?? flight.landingMarkedAt ?? finalizedAt;

      await db.flights.update(flight.id, {
        updatedAt: finalizedAt,
        updatedByDeviceId: deviceId,
        endTime: finalizedEndTime,
        landingFinalizedAt: finalizedAt,
        landingPendingUntil: undefined,
      });

      finalizedFlightSyncId = flight.syncId;
      finalizedFlightStudentId = flight.studentId;

      const student = await db.students.get(flight.studentId);
      if (!student || !student.id) return;

      const newTotal = (student.totalFlights ?? 0) + 1;
      await db.students.update(student.id, {
        totalFlights: newTotal,
        updatedAt: finalizedAt,
        updatedByDeviceId: deviceId,
      });

      const currentCourse = await db.courses.get(flight.courseId);
      if (!currentCourse) return;

      const updatedStudents = currentCourse.students.map((s) =>
        s.id === student.id
          ? {
              ...s,
              totalFlights: newTotal,
              updatedAt: finalizedAt,
              updatedByDeviceId: deviceId,
            }
          : s,
      );
      await db.courses.update(flight.courseId, { students: updatedStudents });
    });

    if (finalizedFlightSyncId && finalizedFlightStudentId) {
      const finalizedFlight = await db.flights.where('syncId').equals(finalizedFlightSyncId).first();
      const finalizedStudent = await db.students.get(finalizedFlightStudentId);
      const studentSyncId = await resolveStudentSyncId(finalizedFlightStudentId);

      if (finalizedFlight) {
        await logCourseDelta({
          courseId,
          operation: 'flight_upsert',
          entitySyncId: finalizedFlightSyncId,
          notification: createSyncNotification(`Flug von ${finalizedStudent?.name ?? 'einem Schüler'} wurde abgeschlossen.`, course?.name),
          payload: {
            syncId: finalizedFlightSyncId,
            studentSyncId,
            studentId: finalizedFlight.studentId,
            endTime: finalizedFlight.endTime,
            landingPendingUntil: finalizedFlight.landingPendingUntil,
            landingFinalizedAt: finalizedFlight.landingFinalizedAt,
            updatedAt: finalizedFlight.updatedAt,
            updatedByDeviceId: finalizedFlight.updatedByDeviceId,
          },
        });
      }

      if (finalizedStudent) {
        await logStudentUpsertDelta(courseId, finalizedStudent, `Fluganzahl von ${finalizedStudent.name} wurde aktualisiert.`);
      }
    }

    await refresh();
  };

  const handleAbortFlight = async (flightId: number) => {
    if (!id) return;
    const flight = await db.flights.get(flightId);
    const now = new Date().toISOString();
    const studentSyncId = flight ? await resolveStudentSyncId(flight.studentId) : undefined;
    const studentName = flight
      ? course?.students.find((student) => student.id === flight.studentId)?.name ?? 'Ein Schüler'
      : 'Ein Schüler';
    await db.flights.delete(flightId);
    if (flight?.syncId) {
      await logCourseDelta({
        courseId: Number(id),
        operation: 'flight_delete',
        entitySyncId: flight.syncId,
        notification: createSyncNotification(`Flug von ${studentName} wurde abgebrochen.`, course?.name),
        payload: {
          syncId: flight.syncId,
          studentSyncId,
          studentId: flight.studentId,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        },
      });
    }
    await refresh();
  };

  const handleToggleDeleteMode = () => {
    if (deleteMode) {
      setDeleteMode(false);
      setSelectedStudentIds([]);
      return;
    }
    setDeleteMode(true);
    setSelectedStudentIds([]);
  };

  const handleToggleStudentSelection = (studentId: number) => {
    setSelectedStudentIds((current) => (
      current.includes(studentId)
        ? current.filter((idValue) => idValue !== studentId)
        : [...current, studentId]
    ));
  };

  const handleDeleteSelectedStudents = async () => {
    if (!course || !id || selectedStudentIds.length === 0) return;
    const courseId = Number(id);
    const toDelete = course.students.filter((student) => selectedStudentIds.includes(student.id ?? -1));
    const updatedStudents = course.students.filter((student) => !selectedStudentIds.includes(student.id ?? -1));
    await db.courses.update(courseId, { students: updatedStudents });

    for (const student of toDelete) {
      if (!student.syncId) continue;
      await logCourseDelta({
        courseId,
        operation: 'student_delete',
        entitySyncId: student.syncId,
        notification: createSyncNotification(`${student.name} wurde entfernt.`, course.name),
        payload: {
          syncId: student.syncId,
          deletedAt: new Date().toISOString(),
        },
      });
    }

    setDeleteMode(false);
    setSelectedStudentIds([]);
    await refresh();
  };

  const openRemarksModal = (flight: Flight, student: Student) => {
    if (!flight.id) return;
    const initialRatings = buildRatings(flight.maneuvers ?? [], flight.ratings, student.lastRatings);
    setRemarksReadOnly(false);
    setRemarksContextText('');
    setSelectedRemarkFlight({ flightId: flight.id, studentName: student.name });
    setExistingRemarks(flight.remarks ?? []);
    setSelectedRemarkManeuvers(flight.maneuvers ?? []);
    setInitialRemarkManeuvers(flight.maneuvers ?? []);
    setSelectedRemarkRatings(initialRatings);
    setInitialRemarkRatings(initialRatings);
    setSelectedRemarkStudentLastRatings(student.lastRatings ?? {});
    setNewRemark('');
    setRemarksModalVisible(true);
  };

  const openLastFlightRemarksModal = async (student: Student) => {
    if (!id || !student.id) return;

    const courseFlights = await db.flights.where('courseId').equals(Number(id)).toArray();
    const latestFlight = courseFlights
      .filter((flight) => flight.studentId === student.id)
      .sort((a, b) => b.startTime.localeCompare(a.startTime))[0];

    setRemarksReadOnly(true);
    setNewRemark('');
    setSelectedRemarkManeuvers([]);
    setInitialRemarkManeuvers([]);
    setSelectedRemarkRatings({});
    setInitialRemarkRatings({});
    setSelectedRemarkStudentLastRatings(student.lastRatings ?? {});
    setSelectedRemarkFlight(null);

    if (!latestFlight) {
      setRemarksContextText('Kein Flug vorhanden.');
      setExistingRemarks([]);
      setRemarksModalVisible(true);
      return;
    }

    const flightTime = new Date(latestFlight.startTime).toLocaleString();
    const latestRatings = buildRatings(latestFlight.maneuvers ?? [], latestFlight.ratings, student.lastRatings);
    setRemarksContextText(`Letzter Flug: ${flightTime}`);
    setExistingRemarks(latestFlight.remarks ?? []);
    setSelectedRemarkManeuvers(latestFlight.maneuvers ?? []);
    setInitialRemarkManeuvers(latestFlight.maneuvers ?? []);
    setSelectedRemarkRatings(latestRatings);
    setInitialRemarkRatings(latestRatings);
    setRemarksModalVisible(true);
  };

  const closeRemarksModal = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsListening(false);
    setRemarksModalVisible(false);
    setSelectedRemarkFlight(null);
    setExistingRemarks([]);
    setSelectedRemarkManeuvers([]);
    setInitialRemarkManeuvers([]);
    setSelectedRemarkRatings({});
    setInitialRemarkRatings({});
    setSelectedRemarkStudentLastRatings({});
    setNewRemark('');
    setRemarksReadOnly(false);
    setRemarksContextText('');
  };

  const handleSelectedRemarkManeuversChange = (values: string[]) => {
    setSelectedRemarkManeuvers(values);
    setSelectedRemarkRatings((currentRatings) => (
      buildRatings(values, currentRatings, selectedRemarkStudentLastRatings)
    ));
  };

  const handleRemarkRatingChange = (ratingKey: string, value: number) => {
    setSelectedRemarkRatings((currentRatings) => ({
      ...currentRatings,
      [ratingKey]: normalizeRating(value),
    }));
  };

  const handleSaveRemark = async () => {
    if (!selectedRemarkFlight) return;
    const flight = await db.flights.get(selectedRemarkFlight.flightId);
    if (!flight) {
      closeRemarksModal();
      return;
    }

    const remark = newRemark.trim();
    const hasNewRemark = remark.length > 0;
    const updatedManeuvers = maneuversEnabled ? [...selectedRemarkManeuvers] : [...(flight.maneuvers ?? [])];
    const maneuversChanged = maneuversEnabled
      ? !hasSameManeuverSelection(updatedManeuvers, flight.maneuvers ?? [])
      : false;
    const updatedRatings = buildRatings(updatedManeuvers, selectedRemarkRatings);
    const ratingsChanged = !hasSameRatings(updatedRatings, flight.ratings ?? {}, updatedManeuvers);

    if (!hasNewRemark && !maneuversChanged && !ratingsChanged) {
      closeRemarksModal();
      return;
    }

    const updatedRemarks = hasNewRemark ? [...(flight.remarks ?? []), remark] : [...(flight.remarks ?? [])];
    const now = new Date().toISOString();
    await db.flights.update(selectedRemarkFlight.flightId, {
      remarks: updatedRemarks,
      maneuvers: updatedManeuvers,
      ratings: updatedRatings,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    });

    const student = await db.students.get(flight.studentId);
    let updatedStudent: Student | undefined;
    if (student?.id) {
      const nextLastRatings = {
        ...(student.lastRatings ?? {}),
        ...updatedRatings,
      };
      await db.students.update(student.id, {
        lastRatings: nextLastRatings,
        updatedAt: now,
        updatedByDeviceId: deviceId,
      });

      updatedStudent = {
        ...student,
        lastRatings: nextLastRatings,
        updatedAt: now,
        updatedByDeviceId: deviceId,
      };

      if (course?.id) {
        const nextStudents = course.students.map((courseStudent) => (
          courseStudent.id === student.id
            ? {
                ...courseStudent,
                lastRatings: nextLastRatings,
                updatedAt: now,
                updatedByDeviceId: deviceId,
              }
            : courseStudent
        ));

        await db.courses.update(course.id, { students: nextStudents });
      }
    }

    setFlights((currentFlights) => currentFlights.map((currentFlight) => (
      currentFlight.id === selectedRemarkFlight.flightId
        ? {
            ...currentFlight,
            remarks: updatedRemarks,
            maneuvers: updatedManeuvers,
            ratings: updatedRatings,
            updatedAt: now,
            updatedByDeviceId: deviceId,
          }
        : currentFlight
    )));

    if (id && flight.syncId) {
      const studentSyncId = await resolveStudentSyncId(flight.studentId);
      await logCourseDelta({
        courseId: Number(id),
        operation: 'flight_upsert',
        entitySyncId: flight.syncId,
        notification: createSyncNotification(`Bemerkungen für ${selectedRemarkFlight.studentName} wurden aktualisiert.`, course?.name),
        payload: {
          syncId: flight.syncId,
          studentSyncId,
          studentId: flight.studentId,
          maneuvers: updatedManeuvers,
          ratings: updatedRatings,
          remarks: updatedRemarks,
          details: flight.details,
          startTime: flight.startTime,
          landingMarkedAt: flight.landingMarkedAt,
          landingPendingUntil: flight.landingPendingUntil,
          landingFinalizedAt: flight.landingFinalizedAt,
          endTime: flight.endTime,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        },
      });

      if (updatedStudent) {
        await logStudentUpsertDelta(Number(id), updatedStudent);
      }
    }
    closeRemarksModal();
    await refresh();
  };

  const handleToggleDictation = () => {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      Modal.warning({
        title: 'Spracheingabe nicht verfugbar',
        content: 'Dieser Browser unterstutzt keine Sprache-zu-Text-Funktion.',
      });
      return;
    }

    if (isListening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          transcript += event.results[index][0].transcript;
        }
      }

      const cleaned = transcript.trim();
      if (!cleaned) return;

      setNewRemark((current) => (current.trim() ? `${current.trim()} ${cleaned}` : cleaned));
    };

    recognition.onerror = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    speechRecognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
    };
  }, []);

  if (!course) {
    return <Text>Lade Kursdaten…</Text>;
  }

  return (
    <div>
      <CourseHeader
        course={course}
        prev={() => navigate(`/`)}
        next={() => navigate(`/course/${id}/evaluation`)}
        editable
        onCourseUpdated={(updatedCourse) => {
          setCourse(updatedCourse);
          void refresh();
        }}
      />

      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Card
          size="small"
          styles={{ body: { padding: 12 } }}
          title={`Schüler (${course.students.length})`}
          extra={(
            <Space orientation="horizontal" size="small" align="center">
              <Button
                key="sort"
                type={deleteMode ? 'primary' : 'default'}
                icon={<FontAwesomeIcon icon={ sortOrder === 'asc' ? faSortDown : faSortUp} />}
                onClick={() => setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
                disabled={deleteMode}
              />
              {deleteMode && selectedStudentIds.length > 0 ? (
                <Popconfirm
                  title="Markierte Schüler entfernen?"
                  description={`Es werden ${selectedStudentIds.length} Schüler aus diesem Kurs entfernt.`}
                  okText="Entfernen"
                  cancelText="Abbrechen"
                  onConfirm={handleDeleteSelectedStudents}
                >
                  <Button key="delete-confirm" danger type="primary" icon={<FontAwesomeIcon icon={faTrashCan} />} />
                </Popconfirm>
              ) : (
                <Button
                  key="delete-mode"
                  type={deleteMode ? 'primary' : 'default'}
                  icon={<FontAwesomeIcon icon={faTrashCan} />}
                  onClick={handleToggleDeleteMode}
                />
              )}
              <Button
                key="add"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setAddMode('existing');
                  setSelectedStudentId(null);
                  setNewStudent(createNewStudentDraft(effectiveFlightSchool));
                  setAddModalVisible(true);
                }}
                disabled={deleteMode}
              />
            </Space>
          )}
          variant="outlined"
        >
          {combinedStudentEntries.length ? (
            <List
              size="small"
              dataSource={combinedStudentEntries}
              renderItem={(entry) => {
                switch (entry.kind) {
                  case 'active':
                    return (
                      <ActiveStudentListItem
                        student={entry.student}
                        flight={entry.flight}
                        nowTs={nowTs}
                        onOpenRemarks={openRemarksModal}
                        onAbortFlight={(flightId) => {
                          void handleAbortFlight(flightId);
                        }}
                        onLandFlight={(flightId) => {
                          void handleLandFlight(flightId);
                        }}
                      />
                    );
                  case 'pending':
                    return (
                      <PendingStudentListItem
                        student={entry.student}
                        flight={entry.flight}
                        nowTs={nowTs}
                        onOpenRemarks={openRemarksModal}
                        onResumeFlight={(flightId) => {
                          void handleResumeFlight(flightId);
                        }}
                        onTerminateFlight={(flightId) => {
                          void handleTerminateFlight(flightId);
                        }}
                      />
                    );
                  case 'idle': {
                    const studentId = entry.student.id;
                    const isSelected = studentId ? selectedStudentIds.includes(studentId) : false;
                    const showRemarksIndicator = studentId ? hasRemarksOnLastFlightByStudentId.get(studentId) === true : false;

                    return (
                      <IdleStudentListItem
                        student={entry.student}
                        deleteMode={deleteMode}
                        isSelected={isSelected}
                        showRemarksIndicator={showRemarksIndicator}
                        onToggleStudentSelection={handleToggleStudentSelection}
                        onOpenLastFlightRemarks={openLastFlightRemarksModal}
                        onEditStudent={(student) => {
                          setEditStudent({ ...student, flightSchool: sanitizeFlightSchoolName(student.flightSchool) });
                          setEditModalVisible(true);
                        }}
                        onStartFlight={(student) => {
                          setSelectedFlightStudent(student);
                          setSelectedManeuvers([]);
                          setFlightDetails(course?.flightDefaults ?? {});
                          setStartModalVisible(true);
                        }}
                      />
                    );
                  }
                  default:
                    return null;
                }
              }}
            />
          ) : (
            <Text type="secondary">Es sind keine Schüler im Kurs.</Text>
          )}
        </Card>

        <CourseSyncFooter course={course} />
      </Space>

      <AddStudentModal
        open={addModalVisible}
        addMode={addMode}
        selectedStudentId={selectedStudentId}
        newStudent={newStudent}
        activeFlightSchool={effectiveFlightSchool}
        flightSchoolOptions={flightSchoolOptions}
        availableExistingStudents={availableExistingStudents}
        onCancel={() => setAddModalVisible(false)}
        onOk={handleAddStudent}
        onModeChange={(mode) => {
          setAddMode(mode);
          if (mode === 'new') {
            setNewStudent(createNewStudentDraft(effectiveFlightSchool));
          }
        }}
        onSelectedStudentIdChange={setSelectedStudentId}
        onNewStudentChange={(student) => setNewStudent({ ...student })}
      />

      <EditStudentModal
        open={editModalVisible}
        editStudent={editStudent}
        flightSchoolOptions={flightSchoolOptions}
        onCancel={() => {
          setEditModalVisible(false);
          setEditStudent(null);
        }}
        onOk={handleEditStudent}
        onEditStudentChange={setEditStudent}
      />

      <StartFlightModal
        open={startModalVisible}
        course={course}
        selectedFlightStudent={selectedFlightStudent}
        flightDetails={flightDetails}
        flightDetailOptions={flightDetailOptions}
        selectedManeuvers={selectedManeuvers}
        maneuversEnabled={maneuversEnabled}
        startLeiterOptions={startLeiterOptions}
        onCancel={() => setStartModalVisible(false)}
        onOk={handleStartFlight}
        onFlightDetailsChange={setFlightDetails}
        onSwapStartAndLandTeachers={handleSwapStartAndLandTeachers}
        onSelectedManeuversChange={setSelectedManeuvers}
      />

      <RemarksModal
        open={remarksModalVisible}
        selectedRemarkFlight={selectedRemarkFlight}
        remarksReadOnly={remarksReadOnly}
        remarksContextText={remarksContextText}
        existingRemarks={existingRemarks}
        newRemark={newRemark}
        selectedManeuvers={selectedRemarkManeuvers}
        ratings={selectedRemarkRatings}
        lastRatings={selectedRemarkStudentLastRatings}
        maneuversEnabled={Boolean(maneuversEnabled)}
        canSave={canSaveRemarkChanges}
        isListening={isListening}
        onCancel={closeRemarksModal}
        onToggleDictation={handleToggleDictation}
        onSave={handleSaveRemark}
        onNewRemarkChange={setNewRemark}
        onSelectedManeuversChange={handleSelectedRemarkManeuversChange}
        onRatingChange={handleRemarkRatingChange}
      />
    </div>
  );
};

export default CourseDetail;
