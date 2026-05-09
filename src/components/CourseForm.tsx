import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { db } from '../db/database';
import type { Course, CourseType } from '../models/types';
import { courseTypes } from '../models/types';

type Props = {
  open: boolean;
  courseId?: number;
  onClose: () => void;
  onSaved: () => void;
};

type CourseFormValues = {
  name: string;
  courseType: CourseType;
  startDate: string;
  endDate: string;
};

const initialValues: CourseFormValues = {
  name: '',
  courseType: 'Grundkurs',
  startDate: '',
  endDate: '',
};

const CourseForm = ({ open, courseId, onClose, onSaved }: Props) => {
  const [form] = Form.useForm<CourseFormValues>();

  useEffect(() => {
    if (!open) return;

    if (!courseId) {
      form.resetFields();
      return;
    }

    const load = async () => {
      const course = await db.courses.get(courseId);
      if (!course) return;

      form.setFieldsValue({
        name: course.name,
        courseType: course.courseType ?? 'Grundkurs',
        startDate: course.startDate,
        endDate: course.endDate,
      });
    };

    void load();
  }, [courseId, form, open]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const data = {
      name: values.name.trim(),
      courseType: values.courseType,
      startDate: values.startDate,
      endDate: values.endDate,
    };

    if (!data.name) return;

    if (courseId) {
      await db.courses.update(courseId, data);
    } else {
      const course: Course = { ...data, students: [] };
      await db.courses.add(course);
    }

    form.resetFields();
    onSaved();
    onClose();
  };

  return (
    <Modal
      title={courseId ? 'Kurs bearbeiten' : 'Kurs erstellen'}
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => void handleSave()}
      okText={<FontAwesomeIcon icon={faFloppyDisk} />}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <Form
        form={form}
        layout="vertical"
        size="small"
        requiredMark={false}
        initialValues={initialValues}
      >
        <Form.Item name="name" label={<>Name <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
          <Input />
        </Form.Item>
        <Form.Item name="courseType" label={<>Kursart <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
          <Select
            options={courseTypes.map((type) => ({ label: type, value: type }))}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item name="startDate" label={<>Startdatum <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8 }}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="endDate" label={<>Enddatum <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 0 }}>
          <Input type="date" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CourseForm;
