import { Space, Typography } from "antd";
import type { Course } from "../models/types";

const formatDate = (date: string) => {
  if (!date) return '';
  const parts = date.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}.${month}.${year}`;
  }
  return date;
};

const CourseTitle = ({course}: {course: Course}) => {
  return (
    <Space direction="vertical" size={2} align="center" style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0, textAlign: 'center', whiteSpace: 'nowrap' }}>
        {course.name}
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center' }}>
        {course.courseType && <><strong>{course.courseType}</strong> &middot; </>}
        {formatDate(course.startDate)} – {formatDate(course.endDate)}
      </Typography.Text>
    </Space>
);
}

export default CourseTitle;
