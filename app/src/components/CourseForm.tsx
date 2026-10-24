import { faFloppyDisk, faQrcode } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Alert, AutoComplete, Button, Col, Form, Input, message, Modal, Row, Select, Space, Spin } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRelaySync } from '../context/RelaySyncContext';
import { db } from '../db/database';
import type { Course, CourseType } from '../models/types';
import { courseTypes } from '../models/types';
import { updateCourseWithFlightSchoolRules } from '../utils/courseFlightSchoolUpdate';
import { sanitizeFlightSchoolName, UNKNOWN_FLIGHT_SCHOOL } from '../utils/flightSchool';
import { createId } from '../utils/idGenerator';
import { redeemInvitation } from '../utils/invitations';

type Props = {
  open: boolean;
  courseId?: number;
  existingFlightSchools: string[];
  defaultFlightSchool?: string;
  initialJoinInviteRaw?: string;
  onJoinInviteHandled?: () => void;
  onClose: () => void;
  onSaved: (savedCourse: Course) => void;
};

type CourseFormValues = {
  name: string;
  courseType: CourseType;
  startDate: string;
  endDate: string;
  flightSchool: string;
};

const initialValues: CourseFormValues = {
  name: '',
  courseType: 'Grundkurs',
  startDate: '',
  endDate: '',
  flightSchool: UNKNOWN_FLIGHT_SCHOOL,
};

const buildDefaultValues = (defaultFlightSchool?: string): CourseFormValues => ({
  ...initialValues,
  flightSchool: sanitizeFlightSchoolName(defaultFlightSchool),
});

const createSyncNotification = (body: string, courseName: string) => ({
  title: 'DigiKladde',
  body: `${body} (${courseName})`,
});

const CourseForm = ({
  open,
  courseId,
  existingFlightSchools,
  defaultFlightSchool,
  initialJoinInviteRaw,
  onJoinInviteHandled,
  onClose,
  onSaved,
}: Props) => {
  const [form] = Form.useForm<CourseFormValues>();
  const { deviceId, relayBaseUrl, getShareSession, logCourseDelta, joinShareSession, connectCourseSession, waitForInitialSnapshot, disconnectCourseSession, leaveShareSession } = useRelaySync();
  const [saving, setSaving] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [sharedCourseLoading, setSharedCourseLoading] = useState(false);
  const [loadedCourseId, setLoadedCourseId] = useState<number | null>(null);
  const draftCourseIdsRef = useRef<Set<number>>(new Set());
  const joinTokenRef = useRef(0);
  const consumedJoinInviteRef = useRef<string | null>(null);

  const cleanupSingleDraftCourse = useCallback(async (courseIdValue: number) => {
    const course = await db.courses.get(courseIdValue);

    try {
      await disconnectCourseSession(courseIdValue);
    } catch {
      // Ignore cleanup errors.
    }

    if (course?.syncId) {
      try {
        await leaveShareSession(course.syncId);
      } catch {
        // Ignore cleanup errors.
      }
    }

    await db.courses.delete(courseIdValue);
  }, [disconnectCourseSession, leaveShareSession]);

  const resetDraftState = useCallback((keepFormValues = false) => {
    joinTokenRef.current += 1;
    draftCourseIdsRef.current.clear();
    setSharedCourseLoading(false);
    setLoadedCourseId(null);
    setScanModalOpen(false);
    if (!keepFormValues) {
      form.resetFields();
    }
  }, [form]);

  const cleanupDraftCourses = useCallback(async () => {
    const courseIds = Array.from(draftCourseIdsRef.current);
    draftCourseIdsRef.current.clear();
    joinTokenRef.current += 1;
    setSharedCourseLoading(false);
    setLoadedCourseId(null);
    setScanModalOpen(false);

    for (const courseIdValue of courseIds) {
      await cleanupSingleDraftCourse(courseIdValue);
    }
  }, [cleanupSingleDraftCourse]);

  useEffect(() => {
    if (!open) {
      resetDraftState();
      return;
    }

    if (!courseId) {
      form.setFieldsValue(buildDefaultValues(defaultFlightSchool));
      return;
    }

    const loadCourse = async () => {
      const course = await db.courses.get(courseId);
      if (!course) return;

      form.setFieldsValue({
        name: course.name,
        courseType: course.courseType ?? 'Grundkurs',
        startDate: course.startDate,
        endDate: course.endDate,
        flightSchool: sanitizeFlightSchoolName(course.flightSchool),
      });
    };

    void loadCourse();
  }, [courseId, defaultFlightSchool, form, open, resetDraftState]);

  const loadSharedCourseFromInvite = useCallback(async (rawValue: string) => {
    const token = ++joinTokenRef.current;
    setScanModalOpen(false);
    setSharedCourseLoading(true);
    let invitation: Awaited<ReturnType<typeof redeemInvitation>>;
    try {
      invitation = await redeemInvitation(rawValue, relayBaseUrl);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Einladung konnte nicht eingelöst werden.');
      if (token === joinTokenRef.current) setSharedCourseLoading(false);
      return;
    }
    if (token !== joinTokenRef.current) return;
    const { roomId, courseSyncId } = invitation.roomKey;

    const preexistingCoursesWithSyncId = await db.courses.where('syncId').equals(courseSyncId).toArray();
    const preexistingIds = new Set(preexistingCoursesWithSyncId.map((course) => Number(course.id)));

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const placeholderCourse: Course = {
      name: 'Geteilter Kurs',
      courseType: 'Grundkurs',
      startDate: today,
      endDate: today,
      flightSchool: sanitizeFlightSchoolName(defaultFlightSchool),
      students: [],
      syncId: courseSyncId,
    };

    let placeholderCourseId: number | null = null;

    try {
      placeholderCourseId = preexistingCoursesWithSyncId[0]?.id ?? Number(await db.courses.add(placeholderCourse));
      draftCourseIdsRef.current = preexistingIds.has(placeholderCourseId) ? new Set() : new Set([placeholderCourseId]);
      await disconnectCourseSession(placeholderCourseId);
      const previousSession = await getShareSession(courseSyncId);
      if (previousSession && previousSession.roomId !== roomId) await leaveShareSession(courseSyncId);

      await joinShareSession({
        courseId: placeholderCourseId,
        roomId,
        joinSecret: invitation.joinSecret,
        roomKey: invitation.roomKey,
      });

      await connectCourseSession(placeholderCourseId);

      let importedCourseId = await waitForInitialSnapshot(placeholderCourseId, 30000);
      if (!importedCourseId) {
        await disconnectCourseSession(placeholderCourseId);
        await connectCourseSession(placeholderCourseId);
        importedCourseId = await waitForInitialSnapshot(placeholderCourseId, 15000);
      }

      if (token !== joinTokenRef.current) return;
      if (!importedCourseId) {
        throw new Error('Initialer Snapshot wurde nicht bestätigt.');
      }

      const targetCourseId = importedCourseId;
      const importedCourse = await db.courses.get(targetCourseId);
      if (!importedCourse) {
        throw new Error('Importierter Kurs wurde nicht gefunden.');
      }

      const nextDraftIds = new Set<number>();
      if (placeholderCourseId && !preexistingIds.has(placeholderCourseId)) {
        nextDraftIds.add(placeholderCourseId);
      }

      // Only mark imported course as draft if it did not exist before this scan.
      if (!preexistingIds.has(targetCourseId)) {
        nextDraftIds.add(targetCourseId);
      }

      draftCourseIdsRef.current = nextDraftIds;

      setLoadedCourseId(targetCourseId);
      form.setFieldsValue({
        name: importedCourse.name,
        courseType: importedCourse.courseType,
        startDate: importedCourse.startDate,
        endDate: importedCourse.endDate,
        flightSchool: sanitizeFlightSchoolName(importedCourse.flightSchool),
      });
      message.success('Kursdaten geladen. Bitte speichern.');
    } catch {
      if (placeholderCourseId && !preexistingIds.has(placeholderCourseId)) {
        await cleanupSingleDraftCourse(placeholderCourseId);
      }

      // Guard against late-arriving snapshot import: remove only courses created during this flow.
      const coursesWithSyncId = await db.courses.where('syncId').equals(courseSyncId).toArray();
      for (const candidate of coursesWithSyncId) {
        const candidateId = Number(candidate.id);
        if (!preexistingIds.has(candidateId)) {
          await cleanupSingleDraftCourse(candidateId);
        }
      }

      draftCourseIdsRef.current.clear();
      setLoadedCourseId(null);
      message.error('Kursdaten konnten nicht geladen werden.');
      console.warn('Verschlüsselter Kursbeitritt fehlgeschlagen.');
    } finally {
      if (token === joinTokenRef.current) {
        setSharedCourseLoading(false);
      }
    }
  }, [cleanupSingleDraftCourse, connectCourseSession, defaultFlightSchool, disconnectCourseSession, form, getShareSession, joinShareSession, leaveShareSession, relayBaseUrl, waitForInitialSnapshot]);

  useEffect(() => {
    if (!open || courseId || !initialJoinInviteRaw || sharedCourseLoading) return;
    if (consumedJoinInviteRef.current === initialJoinInviteRaw) return;

    consumedJoinInviteRef.current = initialJoinInviteRaw;
    void loadSharedCourseFromInvite(initialJoinInviteRaw);
    onJoinInviteHandled?.();
  }, [courseId, initialJoinInviteRaw, loadSharedCourseFromInvite, onJoinInviteHandled, open, sharedCourseLoading]);

  const handleSave = async () => {
    try {
      setSaving(true);

      const values = await form.validateFields();
      const data = {
        name: values.name.trim(),
        courseType: values.courseType,
        startDate: values.startDate,
        endDate: values.endDate,
        flightSchool: sanitizeFlightSchoolName(values.flightSchool),
      };

      if (!data.name) return;

      const effectiveCourseId = courseId ?? loadedCourseId ?? undefined;

      if (effectiveCourseId) {
        const savedCourse = await updateCourseWithFlightSchoolRules(effectiveCourseId, data);
        if (!savedCourse) return;

        const now = new Date().toISOString();
        const updatedCourse: Course = {
          ...savedCourse,
          updatedAt: now,
          updatedByDeviceId: deviceId,
        };

        await db.courses.update(effectiveCourseId, {
          updatedAt: now,
          updatedByDeviceId: deviceId,
        });

        if (savedCourse.syncId) {
          await logCourseDelta({
            courseId: effectiveCourseId,
            operation: 'course_upsert',
            entitySyncId: savedCourse.syncId,
            notification: createSyncNotification('Kursdaten wurden aktualisiert.', updatedCourse.name),
            payload: {
              syncId: savedCourse.syncId,
              name: updatedCourse.name,
              courseType: updatedCourse.courseType,
              startDate: updatedCourse.startDate,
              endDate: updatedCourse.endDate,
              flightSchool: updatedCourse.flightSchool,
              updatedAt: now,
              updatedByDeviceId: deviceId,
            },
          });
        }

        form.resetFields();
        const draftIdsToCleanup = Array.from(draftCourseIdsRef.current).filter((idValue) => idValue !== effectiveCourseId);
        for (const draftId of draftIdsToCleanup) {
          await cleanupSingleDraftCourse(draftId);
        }
        draftCourseIdsRef.current.clear();
        setLoadedCourseId(null);
        onSaved(updatedCourse);
        onClose();
        return;
      }

      const now = new Date().toISOString();
      const course: Course = {
        ...data,
        students: [],
        syncId: createId('course'),
        updatedAt: now,
        updatedByDeviceId: deviceId,
      };
      const createdId = Number(await db.courses.add(course));
      const createdCourse: Course = { ...course, id: createdId };

      await logCourseDelta({
        courseId: createdId,
        operation: 'course_upsert',
        entitySyncId: createdCourse.syncId ?? createId('course'),
        notification: createSyncNotification('Kurs wurde erstellt.', createdCourse.name),
        payload: {
          syncId: createdCourse.syncId,
          name: createdCourse.name,
          courseType: createdCourse.courseType,
          startDate: createdCourse.startDate,
          endDate: createdCourse.endDate,
          flightSchool: createdCourse.flightSchool,
          updatedAt: createdCourse.updatedAt,
          updatedByDeviceId: createdCourse.updatedByDeviceId,
        },
      });

      form.resetFields();
      onSaved(createdCourse);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (sharedCourseLoading) {
      await cleanupDraftCourses();
    } else if (draftCourseIdsRef.current.size > 0) {
      await cleanupDraftCourses();
    } else {
      resetDraftState();
    }

    form.resetFields();
    onClose();
  };

  return (
    <>
      <Modal
        title={courseId ? 'Kurs bearbeiten' : 'Kurs erstellen'}
        open={open}
        onCancel={() => void handleCancel()}
        footer={[
          !courseId ? (
            <Button
              key="scan"
              icon={<FontAwesomeIcon icon={faQrcode} />}
              onClick={() => setScanModalOpen(true)}
              disabled={sharedCourseLoading || saving}
              aria-label="Kurs scannen"
              title="Kurs scannen"
            />
          ) : null,
          <Button
            key="save"
            type="primary"
            icon={<FontAwesomeIcon icon={faFloppyDisk} />}
            onClick={() => void handleSave()}
            loading={saving}
            disabled={sharedCourseLoading}
            aria-label="Save course"
            title="Kurs speichern"
          />,
        ].filter(Boolean)}
      >
        <Spin spinning={sharedCourseLoading} description="Kursdaten werden geladen...">
          <div style={{ opacity: sharedCourseLoading ? 0.55 : 1, pointerEvents: sharedCourseLoading ? 'none' : 'auto' }}>
            {loadedCourseId ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                title="Shared-Kurs geladen"
                description="Die Kursdaten wurden vom anderen Gerät übernommen. Jetzt speichern, um den Kurs lokal abzulegen."
              />
            ) : null}
            <Form form={form} className="course-form-compact" layout="vertical" size="small" requiredMark={false} initialValues={initialValues}>
              <Form.Item name="flightSchool" label={<>Flugschule <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
                <AutoComplete
                  options={existingFlightSchools.map((school) => ({ value: school }))}
                  showSearch={{
                    filterOption: (input, option) => (option?.value ?? '').toLocaleLowerCase('de-DE').includes(input.toLocaleLowerCase('de-DE')),
                  }}
                >
                  <Input aria-label="Flight school" placeholder="Flugschule eingeben oder auswählen" />
                </AutoComplete>
              </Form.Item>
              <Form.Item name="name" label={<>Name <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
                <Input aria-label="Course name" />
              </Form.Item>
              <Form.Item name="courseType" label={<>Kursart <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
                <Select aria-label="Course type" options={courseTypes.map((type) => ({ label: type, value: type }))} style={{ width: '100%' }} />
              </Form.Item>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item name="startDate" label={<>Startdatum <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
                    <Input aria-label="Course start date" type="date" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="endDate" label={<>Enddatum <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
                    <Input aria-label="Course end date" type="date" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </div>
        </Spin>
      </Modal>

      <Modal
        title="Kurs scannen"
        open={scanModalOpen}
        onCancel={() => setScanModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ borderRadius: 8, overflow: 'hidden' }}>
            <Scanner
              onScan={(results) => {
                const firstResult = results[0];
                if (!firstResult?.rawValue || sharedCourseLoading) return;
                void loadSharedCourseFromInvite(firstResult.rawValue);
              }}
              onError={() => {
                // Ignore transient camera stream errors.
              }}
              constraints={{ facingMode: 'environment' }}
            />
          </div>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>
            Kamera auf den QR-Code richten. Der Dialog bleibt offen, bis die Kursdaten geladen sind.
          </span>
        </Space>
      </Modal>
    </>
  );
};

export default CourseForm;
