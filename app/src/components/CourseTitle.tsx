import { Typography } from "antd";
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
    <div style={{ width: '100%', minWidth: 0, overflow: 'hidden', textAlign: 'center' }}>
      <Typography.Title level={3} ellipsis={{ tooltip: course.name }} style={{ margin: 0 }}>
        {course.name}
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block' }}>
        {course.courseType && <><strong>{course.courseType}</strong> &middot; </>}
        {formatDate(course.startDate)} – {formatDate(course.endDate)}
      </Typography.Text>
    </div>
);
}

export default CourseTitle;
