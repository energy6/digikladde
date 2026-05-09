import { faFilePdf } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Collapse, List, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/database';
import type { Course, Flight, FlightDetails } from '../models/types';
import { dateFormatter, durationFormatter, timeFormatter } from '../utils/DatetimeFormatter';
import { generatePDF } from '../utils/pdfExport';
import CourseHeader from './CourseHeader';

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

const CourseEvaluation = () => {
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      const courseId = Number(id);
      const loadedCourse = await db.courses.get(courseId);
      setCourse(loadedCourse || null);
      setFlights(await db.flights.where('courseId').equals(courseId).toArray());
    };
    void load();
  }, [id]);

  const studentsSorted = useMemo(() => {
    if (!course) return [];
    return [...course.students].sort((a, b) => a.name.localeCompare(b.name));
  }, [course]);

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
          title="Kursauswertung"
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
                                <Card key={flight.id} size="small" styles={{ body: { padding: 10 } }} variant="outlined">
                                  <Space orientation="vertical" size={2} style={{ width: '100%' }}>
                                    <Text>
                                      Flug #{idx + 1}:
                                      &nbsp;{dateFormatter.format(new Date(flight.startTime))}
                                      &nbsp;{timeFormatter.format(new Date(flight.startTime))}
                                      &nbsp;- {flight.endTime ? timeFormatter.format(new Date(flight.endTime)) : 'laufend'}
                                      &nbsp;| {durationFormatter(Date.parse(flight.startTime), flight.endTime ? Date.parse(flight.endTime) : undefined)}
                                    </Text>
                                    {flight.maneuvers && <Text>Manöver: {flight.maneuvers.join(', ')}</Text>}
                                    {renderFlightDetails(flight.details)}
                                    {flight.remarks && <Text>{flight.remarks.map(r => (<div>{r}</div>))}</Text>}
                                  </Space>
                                </Card>
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
    </div>
  );
};

export default CourseEvaluation;
