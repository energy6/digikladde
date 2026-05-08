import { faFloppyDisk, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Form, Input, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/database';
import type { Course, CourseType } from '../models/types';
import { courseTypes } from '../models/types';

const CourseForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [courseType, setCourseType] = useState<CourseType>('Grundkurs');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (id) {
      const loadCourse = async () => {
        const course = await db.courses.get(Number(id));
        if (course) {
          setName(course.name);
          setCourseType(course.courseType ?? 'Grundkurs');
          setStartDate(course.startDate);
          setEndDate(course.endDate);
        }
      };
      void loadCourse();
    }
  }, [id]);

  const handleSubmit = async () => {
    const course: Course = { name, courseType, startDate, endDate, students: [] };
    if (id) {
      await db.courses.update(Number(id), { name, courseType, startDate, endDate });
    } else {
      await db.courses.add(course);
    }
    await navigate('/');
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Title level={2}>{id ? 'Kurs bearbeiten' : 'Kurs erstellen'}</Typography.Title>
        <Form layout="vertical" size="small" onFinish={handleSubmit}>
          <Form.Item label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Form.Item>
          <Form.Item label="Kursart" required>
            <Select
              value={courseType}
              onChange={(value) => setCourseType(value)}
              options={courseTypes.map((type) => ({ label: type, value: type }))}
            />
          </Form.Item>
          <Form.Item label="Startdatum" required>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Form.Item>
          <Form.Item label="Enddatum" required>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<FontAwesomeIcon icon={faFloppyDisk} />} />
            <Button type="primary" danger style={{ marginLeft: 8 }}  onClick={() => navigate(-1)} icon={<FontAwesomeIcon icon={faXmark} />} />
          </Form.Item>
        </Form>
      </Space>
    </div>
  );
};

export default CourseForm;
