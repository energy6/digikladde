import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { faBackwardStep, faBan, faForwardStep, faPlaneArrival, faPlaneDeparture, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Checkbox, Form, Input, List, Modal, Popconfirm, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/database';
import type { Course, Flight, FlightDetails, Student } from '../models/types';
import { maneuvers } from '../models/types';
import CourseHeader from './CourseHeader';

const { Text } = Typography;
const LANDING_PENDING_MS = 5 * 60 * 1000;

const CourseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [startModalVisible, setStartModalVisible] = useState(false);
  const [addMode, setAddMode] = useState<'existing' | 'new'>('existing');
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [newStudent, setNewStudent] = useState({ name: '', glider: '', color: '', totalFlights: 0 });
  const [selectedFlightStudent, setSelectedFlightStudent] = useState<Student | null>(null);
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);
  const [flightDetails, setFlightDetails] = useState<FlightDetails>({});
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [nowTs, setNowTs] = useState(Date.now());

  const isPendingLanding = (flight: Flight) => Boolean(flight.landingPendingUntil && !flight.landingFinalizedAt);

  const formatRemaining = (pendingUntil: string) => {
    const remainingMs = Math.max(0, Date.parse(pendingUntil) - nowTs);
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const finalizePendingFlights = async () => {
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
      await db.transaction('rw', db.flights, db.students, db.courses, async () => {
        const freshFlight = await db.flights.get(pendingFlight.id!);
        if (!freshFlight || !freshFlight.landingPendingUntil || freshFlight.landingFinalizedAt) return;
        if (Date.parse(freshFlight.landingPendingUntil) > Date.now()) return;

        const finalizedAt = new Date().toISOString();
        const finalizedEndTime = freshFlight.endTime ?? freshFlight.landingMarkedAt ?? finalizedAt;

        await db.flights.update(freshFlight.id!, {
          endTime: finalizedEndTime,
          landingFinalizedAt: finalizedAt,
          landingPendingUntil: undefined,
        });

        const student = await db.students.get(freshFlight.studentId);
        if (!student || !student.id) return;

        const newTotal = (student.totalFlights ?? 0) + 1;
        await db.students.update(student.id, { totalFlights: newTotal });

        const currentCourse = await db.courses.get(freshFlight.courseId);
        if (!currentCourse) return;

        const updatedStudents = currentCourse.students.map((s) =>
          s.id === student.id ? { ...s, totalFlights: newTotal } : s,
        );
        await db.courses.update(freshFlight.courseId, { students: updatedStudents });
      });
    }

    return true;
  };

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
  }, [id]);

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
  }, [id]);

  const refresh = async () => {
    if (!id) return;
    const [currentCourse, students, courseFlights] = await Promise.all([
      db.courses.get(Number(id)),
      db.students.toArray(),
      db.flights.where('courseId').equals(Number(id)).toArray(),
    ]);
    setCourse(currentCourse || null);
    setAllStudents(students);
    setFlights(courseFlights);
  };

  const activeFlights = useMemo(
    () => flights
      .filter((flight) => !flight.endTime && !isPendingLanding(flight))
      .sort((a, b) => b.startTime.localeCompare(a.startTime)),
    [flights],
  );

  const pendingFlights = useMemo(
    () => flights
      .filter((flight) => !flight.endTime && isPendingLanding(flight))
      .sort((a, b) => {
        const aPending = Date.parse(a.landingPendingUntil ?? a.startTime);
        const bPending = Date.parse(b.landingPendingUntil ?? b.startTime);
        return aPending - bPending;
      }),
    [flights],
  );

  const activeEntries = useMemo(() => {
    if (!course) return [];
    return activeFlights
      .map((flight) => {
        const student = course.students.find((s) => s.id === flight.studentId);
        return student ? { flight, student } : null;
      })
      .filter((entry): entry is { flight: Flight; student: Student } => entry !== null);
  }, [activeFlights, course]);

  const pendingEntries = useMemo(() => {
    if (!course) return [];
    return pendingFlights
      .map((flight) => {
        const student = course.students.find((s) => s.id === flight.studentId);
        return student ? { flight, student } : null;
      })
      .filter((entry): entry is { flight: Flight; student: Student } => entry !== null);
  }, [pendingFlights, course]);

  const notFlyingStudents = useMemo(() => {
    if (!course) return [];
    return course.students
      .filter((student) => !activeFlights.some((flight) => flight.studentId === student.id))
      .filter((student) => !pendingFlights.some((flight) => flight.studentId === student.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFlights, pendingFlights, course]);

  const combinedStudentEntries = useMemo(() => {
    const active = activeEntries.map((entry) => ({
      kind: 'active' as const,
      student: entry.student,
      flight: entry.flight,
    }));

    const pending = pendingEntries.map((entry) => ({
      kind: 'pending' as const,
      student: entry.student,
      flight: entry.flight,
    }));

    const notFlying = notFlyingStudents.map((student) => ({
      kind: 'idle' as const,
      student,
    }));

    return [...active, ...pending, ...notFlying];
  }, [activeEntries, pendingEntries, notFlyingStudents]);

  const availableExistingStudents = useMemo(() => {
    if (!course) return [];
    return allStudents.filter((student) => !course.students.some((courseStudent) => courseStudent.id === student.id));
  }, [allStudents, course]);

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

  const handleAddStudent = async () => {
    if (!course || !id) return;

    if (addMode === 'existing' && selectedStudentId) {
      const student = allStudents.find((item) => item.id === selectedStudentId);
      if (!student) return;
      await db.courses.update(Number(id), { students: [...course.students, student] });
    }

    if (addMode === 'new') {
      const studentId = Number(await db.students.add(newStudent));
      const createdStudent = { ...newStudent, id: studentId };
      await db.courses.update(Number(id), { students: [...course.students, createdStudent] });
    }

    setAddModalVisible(false);
    setSelectedStudentId(null);
    setNewStudent({ name: '', glider: '', color: '', totalFlights: 0 });
    await refresh();
  };

  const handleStartFlight = async () => {
    if (!selectedFlightStudent?.id || !id) return;
    await db.flights.add({
      courseId: Number(id),
      studentId: selectedFlightStudent.id,
      maneuvers: selectedManeuvers,
      details: flightDetails,
      startTime: new Date().toISOString(),
    });
    await db.courses.update(Number(id), { flightDefaults: flightDetails });
    setStartModalVisible(false);
    setSelectedFlightStudent(null);
    setSelectedManeuvers([]);
    setFlightDetails({});
    await refresh();
  };

  const handleEditStudent = async () => {
    if (!editStudent || !editStudent.id || !course || !id) return;
    await db.students.update(editStudent.id, {
      name: editStudent.name,
      glider: editStudent.glider,
      color: editStudent.color,
      totalFlights: editStudent.totalFlights,
    });
    const updatedStudents = course.students.map((s) =>
      s.id === editStudent.id ? { ...editStudent } : s,
    );
    await db.courses.update(Number(id), { students: updatedStudents });
    setEditModalVisible(false);
    setEditStudent(null);
    await refresh();
  };

  const handleLandFlight = async (flightId: number) => {
    const now = Date.now();
    await db.flights.update(flightId, {
      landingMarkedAt: new Date(now).toISOString(),
      landingPendingUntil: new Date(now + LANDING_PENDING_MS).toISOString(),
      landingFinalizedAt: undefined,
    });
    await refresh();
  };

  const handleResumeFlight = async (flightId: number) => {
    await db.flights.update(flightId, {
      landingMarkedAt: undefined,
      landingPendingUntil: undefined,
      landingFinalizedAt: undefined,
    });
    await refresh();
  };

  const handleTerminateFlight = async (flightId: number) => {
    await db.transaction('rw', db.flights, db.students, db.courses, async () => {
      const flight = await db.flights.get(flightId);
      if (!flight || !flight.id || flight.landingFinalizedAt) return;

      const finalizedAt = new Date().toISOString();
      const finalizedEndTime = flight.endTime ?? flight.landingMarkedAt ?? finalizedAt;

      await db.flights.update(flight.id, {
        endTime: finalizedEndTime,
        landingFinalizedAt: finalizedAt,
        landingPendingUntil: undefined,
      });

      const student = await db.students.get(flight.studentId);
      if (!student || !student.id) return;

      const newTotal = (student.totalFlights ?? 0) + 1;
      await db.students.update(student.id, { totalFlights: newTotal });

      const currentCourse = await db.courses.get(flight.courseId);
      if (!currentCourse) return;

      const updatedStudents = currentCourse.students.map((s) =>
        s.id === student.id ? { ...s, totalFlights: newTotal } : s,
      );
      await db.courses.update(flight.courseId, { students: updatedStudents });
    });
    await refresh();
  };

  const handleAbortFlight = async (flightId: number) => {
    await db.flights.delete(flightId);
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
    const updatedStudents = course.students.filter((student) => !selectedStudentIds.includes(student.id ?? -1));
    await db.courses.update(Number(id), { students: updatedStudents });
    setDeleteMode(false);
    setSelectedStudentIds([]);
    await refresh();
  };

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
        onCourseUpdated={(updatedCourse) => setCourse(updatedCourse)}
      />

      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Card
          size="small"
          styles={{ body: { padding: 12 } }}
          title="Schüler"
          extra={(
            <Space orientation="horizontal" size="small" align="center">
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
                onClick={() => setAddModalVisible(true)}
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
                if (entry.kind === 'active') {
                  const { student, flight } = entry;
                  return (
                    <List.Item
                      style={{
                        background: '#1f5f3a',
                        borderRadius: 8,
                        paddingInline: 12,
                        paddingBlock: 6,
                        marginBottom: 6,
                      }}
                      actions={[
                        <Popconfirm
                          title="Flug abbrechen?"
                          okText="Ja"
                          cancelText="Nein"
                          onConfirm={() => handleAbortFlight(flight.id!)}
                        >
                          <Button danger icon={<FontAwesomeIcon icon={faBan} />} />
                        </Popconfirm>,
                        <Button
                          type="primary"
                          onClick={() => handleLandFlight(flight.id!)}
                          icon={<FontAwesomeIcon icon={faPlaneArrival} />}
                        />,
                      ]}
                    >
                      <List.Item.Meta
                        title={<span style={{ color: '#fff', fontWeight: 600 }}>{student.name}</span>}
                        description={
                          <div style={{ color: '#e6f4ea' }}>
                            Start: {new Date(flight.startTime).toLocaleTimeString()}
                            <br />
                            Manöver: {flight.maneuvers.join(', ') || 'Keine ausgewählt'}
                          </div>
                        }
                      />
                    </List.Item>
                  );
                }

                if (entry.kind === 'pending') {
                  const { student, flight } = entry;
                  return (
                    <List.Item
                      style={{
                        background: '#1765ad',
                        borderRadius: 8,
                        paddingInline: 12,
                        paddingBlock: 6,
                        marginBottom: 6,
                      }}
                      actions={[
                        <Button
                          onClick={() => handleResumeFlight(flight.id!)}
                          icon={<FontAwesomeIcon icon={faBackwardStep} />}
                        />,
                        <Button
                          onClick={() => handleTerminateFlight(flight.id!)}
                          icon={<FontAwesomeIcon icon={faForwardStep} />}
                        />,
                      ]}
                    >
                      <List.Item.Meta
                        title={<span style={{ color: '#fff', fontWeight: 600 }}>{student.name}</span>}
                        description={
                          <div style={{ color: '#deeeff' }}>
                            Landung markiert: {flight.landingMarkedAt ? new Date(flight.landingMarkedAt).toLocaleTimeString() : '-'}
                            <br />
                            Final in: {flight.landingPendingUntil ? formatRemaining(flight.landingPendingUntil) : '0:00'}
                          </div>
                        }
                      />
                    </List.Item>
                  );
                }

                const { student } = entry;
                const studentId = student.id;
                const isSelected = studentId ? selectedStudentIds.includes(studentId) : false;

                return (
                  <List.Item
                    onClick={() => {
                      if (deleteMode && studentId) {
                        handleToggleStudentSelection(studentId);
                      }
                    }}
                    style={deleteMode ? {
                      cursor: 'pointer',
                      background: isSelected ? '#fff7e6' : undefined,
                      borderRadius: 8,
                      paddingInline: 8,
                      paddingBlock: 6,
                    } : { paddingBlock: 6 }}
                    extra={deleteMode ? (
                      <Checkbox
                        checked={isSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => {
                          if (studentId) {
                            handleToggleStudentSelection(studentId);
                          }
                        }}
                      />
                    ) : undefined}
                    actions={deleteMode ? [] : [
                      <Space orientation="horizontal" size="small" align="center">
                        <Button
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditStudent({ ...student });
                            setEditModalVisible(true);
                          }}
                        />
                        <Button
                          type="primary"
                          icon={<FontAwesomeIcon icon={faPlaneDeparture} />}
                          onClick={() => {
                            setSelectedFlightStudent(student);
                            setSelectedManeuvers([]);
                            setFlightDetails(course?.flightDefaults ?? {});
                            setStartModalVisible(true);
                          }}
                        />
                      </Space>,
                    ]}
                  >
                    <List.Item.Meta
                      title={`${student.name} (${student.totalFlights ?? 0})`}
                      description={`${student.glider} — ${student.color}`}
                    />
                  </List.Item>
                );
              }}
            />
          ) : (
            <Text type="secondary">Es sind keine Schüler im Kurs.</Text>
          )}
        </Card>
      </Space>

      <Modal
        title="Schüler zum Kurs hinzufügen"
        open={addModalVisible}
        onCancel={() => setAddModalVisible(false)}
        onOk={handleAddStudent}
        okText="Hinzufügen"
      >
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <Text strong>Wähle vorhandenen Schüler oder erstelle einen neuen.</Text>
          <Select
            options={[
              { label: 'Vorhandenen Schüler hinzufügen', value: 'existing' },
              { label: 'Neuen Schüler erstellen', value: 'new' },
            ]}
            value={addMode}
            onChange={(value: 'existing' | 'new') => setAddMode(value)}
          />

          {addMode === 'existing' ? (
            <Select
              placeholder="Vorhandenen Schüler auswählen"
              options={availableExistingStudents.map((student) => ({
                label: `${student.name} — ${student.glider}`,
                value: student.id,
              }))}
              value={selectedStudentId ?? undefined}
              onChange={(value) => setSelectedStudentId(Number(value))}
              style={{ width: '100%' }}
            />
          ) : (
            <Form layout="vertical">
              <Form.Item label="Name" required>
                <input
                  value={newStudent.name}
                  onChange={(event) => setNewStudent({ ...newStudent, name: event.target.value })}
                  className="ant-input"
                />
              </Form.Item>
              <Form.Item label="Schirm" required>
                <input
                  value={newStudent.glider}
                  onChange={(event) => setNewStudent({ ...newStudent, glider: event.target.value })}
                  className="ant-input"
                />
              </Form.Item>
              <Form.Item label="Farbe" required>
                <input
                  value={newStudent.color}
                  onChange={(event) => setNewStudent({ ...newStudent, color: event.target.value })}
                  className="ant-input"
                />
              </Form.Item>
              <Form.Item label="Bisherige Flüge">
                <input
                  type="number"
                  min={0}
                  value={newStudent.totalFlights}
                  onChange={(event) => setNewStudent({ ...newStudent, totalFlights: Math.max(0, Number(event.target.value)) })}
                  className="ant-input"
                />
              </Form.Item>
            </Form>
          )}
        </Space>
      </Modal>

      <Modal
        title={editStudent ? `Schüler bearbeiten: ${editStudent.name}` : 'Schüler bearbeiten'}
        open={editModalVisible}
        onCancel={() => { setEditModalVisible(false); setEditStudent(null); }}
        onOk={handleEditStudent}
        okText="Speichern"
      >
        {editStudent && (
          <Form layout="vertical">
            <Form.Item label="Name" required>
              <input
                value={editStudent.name}
                onChange={(e) => setEditStudent({ ...editStudent, name: e.target.value })}
                className="ant-input"
              />
            </Form.Item>
            <Form.Item label="Schirm" required>
              <input
                value={editStudent.glider}
                onChange={(e) => setEditStudent({ ...editStudent, glider: e.target.value })}
                className="ant-input"
              />
            </Form.Item>
            <Form.Item label="Farbe" required>
              <input
                value={editStudent.color}
                onChange={(e) => setEditStudent({ ...editStudent, color: e.target.value })}
                className="ant-input"
              />
            </Form.Item>
            <Form.Item label="Flüge gesamt">
              <input
                type="number"
                min={0}
                value={editStudent.totalFlights ?? 0}
                onChange={(e) => setEditStudent({ ...editStudent, totalFlights: Math.max(0, Number(e.target.value)) })}
                className="ant-input"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={selectedFlightStudent ? `Flug starten: ${selectedFlightStudent.name}` : 'Flug starten'}
        open={startModalVisible}
        onCancel={() => setStartModalVisible(false)}
        onOk={handleStartFlight}
        okText="Starten"
      >
        <Form layout="vertical">
          {(course.courseType === 'Grundkurs' || course.courseType === 'Windenkurs') && (
            <>
              <Form.Item label="Gelände">
                <Input
                  value={flightDetails.terrain ?? ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, terrain: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="Lehrer">
                <Input
                  value={flightDetails.teacher ?? ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, teacher: e.target.value })}
                />
              </Form.Item>
            </>
          )}
          {course.courseType === 'Windenkurs' && (
            <Form.Item label="Startleiter">
              <Select
                showSearch
                allowClear
                placeholder="Schüler oder Lehrer wählen…"
                options={startLeiterOptions}
                value={flightDetails.startLeiter ?? undefined}
                onChange={(value) => setFlightDetails({ ...flightDetails, startLeiter: value })}
                style={{ width: '100%' }}
              />
            </Form.Item>
          )}
          {course.courseType === 'Höhenkurs' && (
            <>
              <Form.Item label="Startplatz">
                <Input
                  value={flightDetails.startPlace ?? ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, startPlace: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="Lehrer am Start">
                <Input
                  value={flightDetails.startTeacher ?? ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, startTeacher: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="Landeplatz">
                <Input
                  value={flightDetails.landPlace ?? ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, landPlace: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="Lehrer am Landeplatz">
                <Input
                  value={flightDetails.landTeacher ?? ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, landTeacher: e.target.value })}
                />
              </Form.Item>
            </>
          )}
          <Form.Item label="Manöver">
            <Checkbox.Group
              options={maneuvers}
              value={selectedManeuvers}
              onChange={(values) => setSelectedManeuvers([...values])}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CourseDetail;
