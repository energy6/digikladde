import { EditOutlined, FilePdfOutlined, LeftOutlined, PlusOutlined } from '@ant-design/icons';
import { faPlaneDeparture } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Checkbox, Form, List, Modal, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/database';
import type { Course, Flight, Student } from '../models/types';
import { maneuvers } from '../models/types';
import { generatePDF } from '../utils/pdfExport';

const { Text } = Typography;

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
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);

  const refresh = async () => {
    if (!id) return;
    const currentCourse = await db.courses.get(Number(id));
    setCourse(currentCourse || null);
    setAllStudents(await db.students.toArray());
    setFlights(await db.flights.where('courseId').equals(Number(id)).toArray());
  };

  useEffect(() => {
    refresh();
  }, [id]);

  const activeFlights = useMemo(
    () => flights.filter((flight) => !flight.endTime).sort((a, b) => a.startTime.localeCompare(b.startTime)),
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

  const notFlyingStudents = useMemo(() => {
    if (!course) return [];
    return course.students
      .filter((student) => !activeFlights.some((flight) => flight.studentId === student.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeFlights, course]);

  const availableExistingStudents = useMemo(() => {
    if (!course) return [];
    return allStudents.filter((student) => !course.students.some((courseStudent) => courseStudent.id === student.id));
  }, [allStudents, course]);

  const handleAddStudent = async () => {
    if (!course || !id) return;

    if (addMode === 'existing' && selectedStudentId) {
      const student = allStudents.find((item) => item.id === selectedStudentId);
      if (!student) return;
      await db.courses.update(Number(id), { students: [...course.students, student] });
    }

    if (addMode === 'new') {
      const studentId = await db.students.add(newStudent);
      const createdStudent = { ...newStudent, id: studentId };
      await db.courses.update(Number(id), { students: [...course.students, createdStudent] });
    }

    setAddModalVisible(false);
    setSelectedStudentId(null);
    setNewStudent({ name: '', glider: '', color: '', totalFlights: 0 });
    refresh();
  };

  const handleStartFlight = async () => {
    if (!selectedFlightStudent || !id) return;
    await db.flights.add({
      courseId: Number(id),
      studentId: selectedFlightStudent.id!,
      maneuvers: selectedManeuvers,
      startTime: new Date().toISOString(),
    });
    setStartModalVisible(false);
    setSelectedFlightStudent(null);
    setSelectedManeuvers([]);
    refresh();
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
    refresh();
  };

  const handleLandFlight = async (flightId: number, studentId: number) => {
    await db.flights.update(flightId, { endTime: new Date().toISOString() });
    const student = await db.students.get(studentId);
    if (student) {
      const newTotal = (student.totalFlights ?? 0) + 1;
      await db.students.update(studentId, { totalFlights: newTotal });
      if (course && id) {
        const updatedStudents = course.students.map((s) =>
          s.id === studentId ? { ...s, totalFlights: newTotal } : s,
        );
        await db.courses.update(Number(id), { students: updatedStudents });
      }
    }
    refresh();
  };

  if (!course) {
    return <Text>Lade Kursdaten…</Text>;
  }

  return (
    <div>
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <Button type="link" icon={<LeftOutlined />} onClick={() => navigate('/')} />
            <Typography.Title level={3} style={{ display: 'inline-block', margin: '0 0 0 12px' }}>
              {course.name}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
              {course.courseType && <><strong>{course.courseType}</strong> &middot; </>}
              {course.startDate} – {course.endDate}
            </Typography.Text>
          </div>
          <Space wrap>
            <Button key="pdf" icon={<FilePdfOutlined />} onClick={() => generatePDF(Number(id))}>
              Kurs PDF
            </Button>
            <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setAddModalVisible(true)}>
              Schüler aufnehmen
            </Button>
          </Space>
        </div>
      </Card>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="Aktive Schüler im Flug" bordered>
          {activeEntries.length ? (
            <List
              dataSource={activeEntries}
              renderItem={({ flight, student }) => (
                <List.Item
                  actions={[
                    <Button type="primary" danger onClick={() => handleLandFlight(flight.id!, student.id!)}>
                      Gelandet
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={student.name}
                    description={
                      <div>
                        <Text type="secondary">Start: {new Date(flight.startTime).toLocaleTimeString()}</Text>
                        <br />
                        <Text>Manöver: {flight.maneuvers.join(', ') || 'Keine ausgewählt'}</Text>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Text type="secondary">Keine Schüler sind aktuell im Flug.</Text>
          )}
        </Card>

        <Card title="Nicht fliegende Schüler" bordered>
          {notFlyingStudents.length ? (
            <List
              dataSource={notFlyingStudents}
              renderItem={(student) => (
                <List.Item
                  actions={[
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
              )}
            />
          ) : (
            <Text type="secondary">Alle Schüler sind derzeit im Flug oder es sind keine Schüler im Kurs.</Text>
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
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text strong>Wähle vorhandenen Schüler oder erstelle einen neuen.</Text>
          <Select
            options={[
              { label: 'Vorhandenen Schüler hinzufügen', value: 'existing' },
              { label: 'Neuen Schüler erstellen', value: 'new' },
            ]}
            value={addMode}
            onChange={(value) => setAddMode(value as 'existing' | 'new')}
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
        <Checkbox.Group
          options={maneuvers}
          value={selectedManeuvers}
          onChange={(values) => setSelectedManeuvers(values as string[])}
          style={{ width: '100%' }}
        />
      </Modal>
    </div>
  );
};

export default CourseDetail;
