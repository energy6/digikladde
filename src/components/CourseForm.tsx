import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AutoComplete, Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { db } from '../db/database';
import type { Course, CourseType } from '../models/types';
import { courseTypes } from '../models/types';
import { updateCourseWithFlightSchoolRules } from '../utils/courseFlightSchoolUpdate';
import { sanitizeFlightSchoolName, UNKNOWN_FLIGHT_SCHOOL } from '../utils/flightSchool';

type Props = {
  open: boolean;
  courseId?: number;
  existingFlightSchools: string[];
  defaultFlightSchool?: string;
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

const CourseForm = ({
  open,
  courseId,
  existingFlightSchools,
  defaultFlightSchool,
  onClose,
  onSaved,
}: Props) => {
  const [form] = Form.useForm<CourseFormValues>();

  useEffect(() => {
    if (!open) return;

    if (!courseId) {
      form.setFieldsValue({
        ...initialValues,
        flightSchool: sanitizeFlightSchoolName(defaultFlightSchool),
      });
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
        flightSchool: sanitizeFlightSchoolName(course.flightSchool),
      });
    };

    void load();
  }, [courseId, defaultFlightSchool, form, open]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const data = {
      name: values.name.trim(),
      courseType: values.courseType,
      startDate: values.startDate,
      endDate: values.endDate,
      flightSchool: sanitizeFlightSchoolName(values.flightSchool),
    };

    if (!data.name) return;

    if (courseId) {
      const savedCourse = await updateCourseWithFlightSchoolRules(courseId, data);
      if (!savedCourse) return;

      form.resetFields();
      onSaved(savedCourse);
      onClose();
      return;
    }

      const course: Course = { ...data, students: [] };
      const createdId = Number(await db.courses.add(course));
      const createdCourse: Course = { ...course, id: createdId };

      form.resetFields();
      onSaved(createdCourse);
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
        <Form.Item name="flightSchool" label={<>Flugschule <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginTop: 8, marginBottom: 0 }}>
          <AutoComplete
            options={existingFlightSchools.map((school) => ({ value: school }))}
            showSearch={{
              filterOption: (input, option) => (option?.value ?? '').toLocaleLowerCase('de-DE').includes(input.toLocaleLowerCase('de-DE')),
            }}
          >
            <Input placeholder="Flugschule eingeben oder auswählen" />
          </AutoComplete>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CourseForm;
