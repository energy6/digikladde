import { RightOutlined } from '@ant-design/icons';
import { faCirclePlus, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Checkbox, List, message, Modal, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlightSchool } from '../context/FlightSchoolContext';
import { db } from '../db/database';
import type { Course } from '../models/types';
import { ALL_FLIGHT_SCHOOLS, extractFlightSchools, sanitizeFlightSchoolName } from '../utils/flightSchool';
import CourseForm from './CourseForm';
import CourseTitle from './CourseTitle';

const CourseList = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<Set<number>>(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { activeFlightSchool, setActiveFlightSchool } = useFlightSchool();
  const navigate = useNavigate();

  useEffect(() => {
    const loadCourses = async () => {
      const allCourses = await db.courses.toArray();
      setCourses(allCourses);
    };
    void loadCourses();
  }, []);

  const flightSchoolOptions = useMemo(() => extractFlightSchools(courses.map((course) => course.flightSchool)), [courses]);

  const filteredCourses = useMemo(() => {
    if (activeFlightSchool === ALL_FLIGHT_SCHOOLS) return courses;
    return courses.filter((course) => sanitizeFlightSchoolName(course.flightSchool) === activeFlightSchool);
  }, [activeFlightSchool, courses]);

  const sortedCourses = [...filteredCourses].sort((a, b) => {
    const dateA = a.startDate || '';
    const dateB = b.startDate || '';
    return dateB.localeCompare(dateA) || Number(b.id || 0) - Number(a.id || 0);
  });

  const handleTrashClick = () => {
    if (deleteMode) {
      setDeleteMode(false);
      setSelectedCourses(new Set());
    } else {
      setDeleteMode(true);
    }
  };

  const handleSelectCourse = (courseId: number | undefined) => {
    if (courseId === undefined) return;
    const newSelected = new Set(selectedCourses);
    if (newSelected.has(courseId)) {
      newSelected.delete(courseId);
    } else {
      newSelected.add(courseId);
    }
    setSelectedCourses(newSelected);
  };

  const handleDeleteCourses = () => {
    Modal.confirm({
      title: 'Kurse löschen',
      content: `Möchten Sie wirklich ${selectedCourses.size} Kurs(e) löschen? Dies kann nicht rückgängig gemacht werden.`,
      okText: 'Löschen',
      okType: 'danger',
      cancelText: 'Abbrechen',
      onOk: async () => {
        try {
          await Promise.all(Array.from(selectedCourses).map((id) => db.courses.delete(id)));
          const allCourses = await db.courses.toArray();
          setCourses(allCourses);
          setSelectedCourses(new Set());
          setDeleteMode(false);
          message.success('Kurse erfolgreich gelöscht');
        } catch (error) {
          message.error('Fehler beim Löschen der Kurse');
          console.error(error);
        }
      },
    });
  };

  return (
    <>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Space align="center" style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Kursliste
            </Typography.Title>
            <Space orientation="horizontal" size="small" align="center">
              <Button
                type={deleteMode ? 'primary' : 'default'}
                icon={<FontAwesomeIcon icon={faTrashCan} />}
                onClick={() => (deleteMode && selectedCourses.size > 0) ? handleDeleteCourses() : handleTrashClick()}
                danger={deleteMode && selectedCourses.size > 0}
              >
                {deleteMode && selectedCourses.size > 0 ? selectedCourses.size : ''}
              </Button>
              {!deleteMode && (
                <Button type="primary" icon={<FontAwesomeIcon icon={faCirclePlus} />} onClick={() => setCreateModalOpen(true)} />
              )}
            </Space>
          </Space>

          <div style={{ paddingInline: 16 }}>
            <Select
              value={activeFlightSchool}
              onChange={(value) => setActiveFlightSchool(String(value))}
              style={{ width: '100%' }}
              options={[
                { label: 'Alle Flugschulen', value: ALL_FLIGHT_SCHOOLS },
                ...flightSchoolOptions.map((school) => ({ label: school, value: school })),
              ]}
            />
          </div>

          <List
            size="small"
            grid={{ gutter: 8, column: 1 }}
            dataSource={sortedCourses}
            renderItem={(course) => (
              <List.Item style={{ paddingBlock: 4 }}>
                <Card
                  size="small"
                  hoverable={!deleteMode}
                  style={{ width: '100%' }}
                  styles={{ body: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 } }}
                  onClick={() => !deleteMode && navigate(`/course/${course.id}`)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    {deleteMode && (
                      <Checkbox
                        checked={course.id !== undefined && selectedCourses.has(course.id)}
                        onChange={() => handleSelectCourse(course.id)}
                      />
                    )}
                    <CourseTitle course={course} />
                  </div>
                  {!deleteMode && <Button type="link" icon={<RightOutlined />} />}
                </Card>
              </List.Item>
            )}
          />
        </Space>
      </div>

      <CourseForm
        open={createModalOpen}
        existingFlightSchools={flightSchoolOptions}
        defaultFlightSchool={activeFlightSchool === ALL_FLIGHT_SCHOOLS ? undefined : activeFlightSchool}
        onClose={() => setCreateModalOpen(false)}
        onSaved={async (savedCourse) => {
          const allCourses = await db.courses.toArray();
          setCourses(allCourses);
          setActiveFlightSchool(savedCourse.flightSchool);
        }}
      />
    </>
  );
};

export default CourseList;
