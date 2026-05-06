import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Checkbox, Form, List, Modal, Select, Space, Typography } from 'antd';
import { LeftOutlined, PlusOutlined, FilePdfOutlined, UploadOutlined } from '@ant-design/icons';
import { db } from '../db/database';
import { generatePDF } from '../utils/pdfExport';
import type { Course, Flight, Student } from '../models/types';
import { maneuvers } from '../models/types';

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
  const [newStudent, setNewStudent] = useState({ name: '', glider: '', color: '' });
  const [selectedFlightStudent, setSelectedFlightStudent] = useState<Student | null>(null);
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);

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
    setNewStudent({ name: '', glider: '', color: '' });
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

  const handleLandFlight = async (flightId: number) => {
    await db.flights.update(flightId, { endTime: new Date().toISOString() });
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
                    <Button type="primary" danger onClick={() => handleLandFlight(flight.id!)}>
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
                    <Button
                      type="primary"
                      icon={<UploadOutlined />}
                      onClick={() => {
                        setSelectedFlightStudent(student);
                        setSelectedManeuvers([]);
                        setStartModalVisible(true);
                      }}
                    >
                      Starten
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={student.name}
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
            </Form>
          )}
        </Space>
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
