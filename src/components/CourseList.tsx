import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Card, List, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import type { Course } from '../models/types';
import CourseTitle from './CourseTitle';

const CourseList = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const loadCourses = async () => {
      const allCourses = await db.courses.toArray();
      setCourses(allCourses);
    };
    loadCourses();
  }, []);

  const sortedCourses = [...courses].sort((a, b) => {
    const dateA = a.startDate || '';
    const dateB = b.startDate || '';
    return dateB.localeCompare(dateA) || Number(b.id || 0) - Number(a.id || 0);
  });

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="center" style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Kursliste
          </Typography.Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/course/new')}>
            Neuer Kurs
          </Button>
        </Space>

        <List
          size="small"
          grid={{ gutter: 8, column: 1 }}
          dataSource={sortedCourses}
          renderItem={(course) => (
            <List.Item style={{ paddingBlock: 4 }}>
              <Card
                size="small"
                hoverable
                style={{ width: '100%' }}
                bodyStyle={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}
                onClick={() => navigate(`/course/${course.id}`)}
              >
                <div>
                  <CourseTitle course={course} />
                </div>
                <Button type="link" icon={<RightOutlined />} />
              </Card>
            </List.Item>
          )}
        />
      </Space>
    </div>
  );
};

export default CourseList;
