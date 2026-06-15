import { faFilePdf } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Collapse, List, Space, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRelaySync } from '../context/RelaySyncContext';
import { db } from '../db/database';
import type { Course, Flight, FlightDetails, Student } from '../models/types';
import { dateFormatter, durationFormatter, timeFormatter } from '../utils/DatetimeFormatter';
import { getFlightDetailOptions } from '../utils/flightDetailHistory';
import { createId } from '../utils/idGenerator';
import { useLongPress } from '../utils/longPress';
import { formatRatingLabels } from '../utils/maneuverRatings';
import { generatePDF } from '../utils/pdfExport';
import CourseHeader from './CourseHeader';
import { FlightEditModal, type FlightEditValues } from './modals';

const { Text } = Typography;

const renderFlightDetails = (details?: FlightDetails) => {
  if (!details) return null;

  const rows: string[] = [];
  if (details.terrain) rows.push(`Gelände: ${details.terrain} / ${details.teacher ?? '-'}`);
  if (details.startPlace) rows.push(`Startplatz: ${details.startPlace} / ${details.startTeacher ?? '-'}`);
  if (details.landPlace) rows.push(`Landeplatz: ${details.landPlace} / ${details.landTeacher ?? '-'}`);

  if (!rows.length) return null;

  return (
    <div>
      {rows.map((row) => (
        <div key={row} style={{ lineHeight: 1.25 }}>
          <Text type="secondary">{row}</Text>
        </div>
      ))}
    </div>
  );
};

const renderFlightRatings = (flight: Flight): string => (
  formatRatingLabels(flight.maneuvers, flight.ratings)
);

type FlightEvaluationCardProps = {
  flight: Flight;
  index: number;
  onEdit: (flight: Flight) => void;
};

const FlightEvaluationCard = ({ flight, index, onEdit }: FlightEvaluationCardProps) => {
  const { longPressHandlers, consumeLongPressClick } = useLongPress(
    () => onEdit(flight),
    { disabled: flight.id === undefined },
  );

  return (
    <Card
      size="small"
      styles={{ body: { padding: 10 } }}
      variant="outlined"
      {...longPressHandlers}
      onClick={() => {
        consumeLongPressClick();
      }}
    >
      <Space orientation="vertical" size={2} style={{ width: '100%' }}>
        <Text>
          Flug #{index + 1}:
          &nbsp;{dateFormatter.format(new Date(flight.startTime))}
          &nbsp;{timeFormatter.format(new Date(flight.startTime))}
          &nbsp;- {flight.endTime ? timeFormatter.format(new Date(flight.endTime)) : 'laufend'}
          &nbsp;| {durationFormatter(Date.parse(flight.startTime), flight.endTime ? Date.parse(flight.endTime) : undefined)}
        </Text>
        <Text>{renderFlightRatings(flight)}</Text>
        {renderFlightDetails(flight.details)}
        {flight.remarks && <Text>{flight.remarks.map((remark) => (<div key={remark}>{remark}</div>))}</Text>}
      </Space>
    </Card>
  );
};

const createSyncNotification = (body: string, courseName?: string) => ({
  title: 'DigiKladde',
  body: courseName ? `${body} (${courseName})` : body,
});

const CourseEvaluation = () => {
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [savingFlight, setSavingFlight] = useState(false);
  const navigate = useNavigate();
  const { deviceId, logCourseDelta } = useRelaySync();

  const refresh = useCallback(async () => {
    if (!id) return;
    const courseId = Number(id);
    const loadedCourse = await db.courses.get(courseId);
    if (!loadedCourse) {
      setCourse(null);
      setFlights([]);
      return;
    }

    // Ensure embedded students have local IDs by resolving from students table
    const needsResolution = loadedCourse.students.some((s) => !s.id && s.syncId);
    if (needsResolution) {
      const syncIds = loadedCourse.students.filter((s) => !s.id && s.syncId).map((s) => s.syncId!);
      const resolved = await db.students.where('syncId').anyOf(syncIds).toArray();
      const syncIdToId = new Map(resolved.filter((s) => s.id).map((s) => [s.syncId!, s.id!]));

      loadedCourse.students = loadedCourse.students.map((s) => {
        if (s.id || !s.syncId) return s;
        const localId = syncIdToId.get(s.syncId);
        return localId ? { ...s, id: localId } : s;
      });
    }

    setCourse(loadedCourse);
    setFlights(await db.flights.where('courseId').equals(courseId).toArray());
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const studentsSorted = useMemo(() => {
    if (!course) return [];
    return [...course.students].sort((a, b) => a.name.localeCompare(b.name));
  }, [course]);

  const selectedFlightStudent = useMemo(() => {
    if (!course || !selectedFlight) return null;
    return course.students.find((student) => student.id === selectedFlight.studentId) ?? null;
  }, [course, selectedFlight]);

  const flightDetailOptions = useMemo(() => (
    getFlightDetailOptions(course?.flightSchool ?? '', course?.flightDefaults)
  ), [course?.flightDefaults, course?.flightSchool]);

  const maneuversEnabled = course?.courseType !== 'Grundkurs';

  const resolveStudentSyncId = useCallback(async (studentIdValue: number): Promise<string | undefined> => {
    const embeddedStudent = course?.students.find((student) => student.id === studentIdValue);
    if (embeddedStudent?.syncId) return embeddedStudent.syncId;

    const storedStudent = await db.students.get(studentIdValue);
    return storedStudent?.syncId;
  }, [course?.students]);

  const updateStudentTotalFlights = useCallback(async (
    courseId: number,
    studentId: number,
    delta: number,
    now: string,
  ): Promise<Student | undefined> => {
    const storedStudent = await db.students.get(studentId);
    if (!storedStudent?.id) return undefined;

    const nextTotalFlights = Math.max(0, (storedStudent.totalFlights ?? 0) + delta);
    const studentSyncId = storedStudent.syncId ?? createId('student');
    const updatedStudent: Student = {
      ...storedStudent,
      syncId: studentSyncId,
      totalFlights: nextTotalFlights,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    };

    await db.students.update(storedStudent.id, {
      syncId: studentSyncId,
      totalFlights: nextTotalFlights,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    });

    const storedCourse = await db.courses.get(courseId);
    if (storedCourse) {
      const updatedStudents = storedCourse.students.map((student) => (
        student.id === studentId
          ? {
              ...student,
              syncId: student.syncId ?? studentSyncId,
              totalFlights: nextTotalFlights,
              updatedAt: now,
              updatedByDeviceId: deviceId,
            }
          : student
      ));
      await db.courses.update(courseId, { students: updatedStudents });
    }

    return updatedStudent;
  }, [deviceId]);

  const logStudentUpsertDelta = useCallback(async (courseId: number, student: Student) => {
    if (!student.syncId) return;

    await logCourseDelta({
      courseId,
      operation: 'student_upsert',
      entitySyncId: student.syncId,
      notification: createSyncNotification(`Fluganzahl von ${student.name} wurde aktualisiert.`, course?.name),
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

  const handleSaveFlight = useCallback(async (values: FlightEditValues) => {
    if (!id || !selectedFlight?.id || !course) return;

    setSavingFlight(true);
    try {
      const courseId = Number(id);
      const existingFlight = await db.flights.get(selectedFlight.id);
      if (!existingFlight) return;

      const now = new Date().toISOString();
      const flightSyncId = existingFlight.syncId ?? createId('flight');
      const wasCompleted = Boolean(existingFlight.endTime);
      const willBeCompleted = Boolean(values.endTime);
      const updatedStudent = wasCompleted === willBeCompleted
        ? undefined
        : await updateStudentTotalFlights(courseId, existingFlight.studentId, willBeCompleted ? 1 : -1, now);

      const nextLandingFinalizedAt = values.endTime ? (values.landingFinalizedAt ?? now) : undefined;
      await db.flights.update(existingFlight.id, {
        syncId: flightSyncId,
        updatedAt: now,
        updatedByDeviceId: deviceId,
        startTime: values.startTime,
        endTime: values.endTime,
        landingMarkedAt: values.landingMarkedAt,
        landingPendingUntil: undefined,
        landingFinalizedAt: nextLandingFinalizedAt,
        details: values.details,
        maneuvers: values.maneuvers,
        ratings: values.ratings,
      });

      const studentSyncId = await resolveStudentSyncId(existingFlight.studentId);
      await logCourseDelta({
        courseId,
        operation: 'flight_upsert',
        entitySyncId: flightSyncId,
        notification: createSyncNotification(`Flug von ${selectedFlightStudent?.name ?? 'einem Schüler'} wurde aktualisiert.`, course.name),
        payload: {
          syncId: flightSyncId,
          studentSyncId,
          studentId: existingFlight.studentId,
          maneuvers: values.maneuvers,
          ratings: values.ratings ?? null,
          remarks: existingFlight.remarks ?? null,
          details: values.details ?? null,
          startTime: values.startTime,
          landingMarkedAt: values.landingMarkedAt ?? null,
          landingPendingUntil: null,
          landingFinalizedAt: nextLandingFinalizedAt ?? null,
          endTime: values.endTime ?? null,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        },
      });

      if (updatedStudent) {
        await logStudentUpsertDelta(courseId, updatedStudent);
      }

      setSelectedFlight(null);
      await refresh();
      message.success('Flug gespeichert');
    } catch (error) {
      message.error('Flug konnte nicht gespeichert werden.');
      console.error(error);
    } finally {
      setSavingFlight(false);
    }
  }, [
    course,
    deviceId,
    id,
    logCourseDelta,
    logStudentUpsertDelta,
    refresh,
    resolveStudentSyncId,
    selectedFlight,
    selectedFlightStudent,
    updateStudentTotalFlights,
  ]);

  const handleDeleteFlight = useCallback(async () => {
    if (!id || !selectedFlight?.id || !course) return;

    setSavingFlight(true);
    try {
      const courseId = Number(id);
      const existingFlight = await db.flights.get(selectedFlight.id);
      if (!existingFlight) return;

      const now = new Date().toISOString();
      const studentSyncId = await resolveStudentSyncId(existingFlight.studentId);
      const updatedStudent = existingFlight.endTime
        ? await updateStudentTotalFlights(courseId, existingFlight.studentId, -1, now)
        : undefined;

      await db.flights.delete(existingFlight.id);

      if (existingFlight.syncId) {
        await logCourseDelta({
          courseId,
          operation: 'flight_delete',
          entitySyncId: existingFlight.syncId,
          notification: createSyncNotification(`Flug von ${selectedFlightStudent?.name ?? 'einem Schüler'} wurde gelöscht.`, course.name),
          payload: {
            syncId: existingFlight.syncId,
            studentSyncId,
            studentId: existingFlight.studentId,
            updatedAt: now,
            updatedByDeviceId: deviceId,
          },
        });
      }

      if (updatedStudent) {
        await logStudentUpsertDelta(courseId, updatedStudent);
      }

      setSelectedFlight(null);
      await refresh();
      message.success('Flug gelöscht');
    } catch (error) {
      message.error('Flug konnte nicht gelöscht werden.');
      console.error(error);
    } finally {
      setSavingFlight(false);
    }
  }, [
    course,
    deviceId,
    id,
    logCourseDelta,
    logStudentUpsertDelta,
    refresh,
    resolveStudentSyncId,
    selectedFlight,
    selectedFlightStudent,
    updateStudentTotalFlights,
  ]);

  if (!course || !id) {
    return <Text>Lade Auswertung…</Text>;
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <CourseHeader
          course={course}
          prev={() => navigate(`/course/${course.id}`)}
          editable
          onCourseUpdated={(updatedCourse) => setCourse(updatedCourse)}
        />

        <Card
          size="small"
          styles={{ body: { padding: 12 } }}
          title={
            <Space orientation="vertical" size={0}>
              <Text>Kursauswertung</Text>
              <Text type="secondary" style={{ fontWeight: 400 }}>
                {studentsSorted.length} Schüler / {flights.length} {flights.length === 1 ? 'Flug' : 'Flüge'}
              </Text>
            </Space>
          }
          extra={<Button type="primary" icon={<FontAwesomeIcon icon={faFilePdf} />} onClick={() => generatePDF(Number(id))}/>}
          variant="outlined"
        >
          <List
            size="small"
            split={false}
            dataSource={studentsSorted}
            renderItem={(student) => {
              const studentFlights = flights
                .filter((flight) => flight.studentId === student.id)
                .sort((a, b) => b.startTime.localeCompare(a.startTime));

              return (
                <List.Item style={{ paddingBlock: 4 }}>
                  <div style={{ width: '100%' }}>
                    <Collapse
                      size="small"
                      items={[
                        {
                          key: String(student.id),
                          label: `${student.name} (${studentFlights.length ?? 0} ${studentFlights.length === 1 ? 'Flug' : 'Flüge' })`,
                          children: studentFlights.length ? (
                            <Space orientation="vertical" size="small" style={{ width: '100%' }}>
                              {studentFlights.map((flight, idx) => (
                                <FlightEvaluationCard
                                  key={flight.id}
                                  flight={flight}
                                  index={idx}
                                  onEdit={(flightToEdit) => setSelectedFlight(flightToEdit)}
                                />
                              ))}
                            </Space>
                          ) : (
                            <Text type="secondary">Keine Flüge für diesen Schüler im Kurs.</Text>
                          ),
                        },
                      ]}
                    />
                  </div>
                </List.Item>
              );
            }}
          />
        </Card>
      </Space>
      <FlightEditModal
        open={Boolean(selectedFlight)}
        course={course}
        flight={selectedFlight}
        studentName={selectedFlightStudent?.name ?? 'Schüler'}
        flightDetailOptions={flightDetailOptions}
        maneuversEnabled={Boolean(maneuversEnabled)}
        saving={savingFlight}
        onCancel={() => setSelectedFlight(null)}
        onSave={handleSaveFlight}
        onDelete={handleDeleteFlight}
      />
    </div>
  );
};

export default CourseEvaluation;
