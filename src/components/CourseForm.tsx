import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Form, Input, Modal, Select } from 'antd';
import { useEffect, useState } from 'react';
import { db } from '../db/database';
import type { Course, CourseType } from '../models/types';
import { courseTypes } from '../models/types';

type Props = {
  open: boolean;
  courseId?: number;
  onClose: () => void;
  onSaved: () => void;
};

const CourseForm = ({ open, courseId, onClose, onSaved }: Props) => {
  const [name, setName] = useState('');
  const [courseType, setCourseType] = useState<CourseType>('Grundkurs');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (open && courseId) {
      const load = async () => {
        const course = await db.courses.get(courseId);
        if (course) {
          setName(course.name);
          setCourseType(course.courseType ?? 'Grundkurs');
          setStartDate(course.startDate);
          setEndDate(course.endDate);
        }
      };
      void load();
    } else if (open && !courseId) {
      setName('');
      setCourseType('Grundkurs');
      setStartDate('');
      setEndDate('');
    }
  }, [open, courseId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    const data = { name: name.trim(), courseType, startDate, endDate };
    if (courseId) {
      await db.courses.update(courseId, data);
    } else {
      const course: Course = { ...data, students: [] };
      await db.courses.add(course);
    }
    onSaved();
    onClose();
  };

  return (
    <Modal
      title={courseId ? 'Kurs bearbeiten' : 'Kurs erstellen'}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText={<FontAwesomeIcon icon={faFloppyDisk} />}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <Form layout="vertical" size="small" requiredMark={false}>
        <Form.Item label={<>Name <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
        <Form.Item label={<>Kursart <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
          <Select
            value={courseType}
            onChange={(value) => setCourseType(value)}
            options={courseTypes.map((type) => ({ label: type, value: type }))}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item label={<>Startdatum <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Form.Item>
        <Form.Item label={<>Enddatum <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 0 }}>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CourseForm;
