import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Card, Space } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from "../db/database";
import type { Course } from '../models/types';
import { extractFlightSchools, sanitizeFlightSchoolName } from "../utils/flightSchool";
import CourseForm from "./CourseForm";
import CourseTitle from "./CourseTitle";

type Props = {
  course: Course;
  prev?: () => void;
  next?: () => void;
  editable?: boolean;
  onCourseUpdated?: (updatedCourse: Course) => void;
};

const CourseHeader = ({ course, prev, next, editable = false, onCourseUpdated }: Props) => {
  const [compactHeader, setCompactHeader] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [flightSchoolOptions, setFlightSchoolOptions] = useState<string[]>([]);

  const measureRowRef = useRef<HTMLDivElement | null>(null);
  const measurePrevRef = useRef<HTMLDivElement | null>(null);
  const measureNextRef = useRef<HTMLDivElement | null>(null);
  const titleMeasureRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const recalc = () => {
      const rowWidth = measureRowRef.current?.clientWidth ?? 0;
      const prevWidth = prev ? (measurePrevRef.current?.offsetWidth ?? 0) : 0;
      const nextWidth = next ? (measureNextRef.current?.offsetWidth ?? 0) : 0;
      const titleWidth = titleMeasureRef.current?.scrollWidth ?? 0;

      if (!rowWidth || !titleWidth) return;

      const gaps = (prev ? 12 : 0) + (next ? 12 : 0);
      const paddingReserve = 8;
      const availableForTitle = rowWidth - prevWidth - nextWidth - gaps - paddingReserve;

      setCompactHeader(titleWidth > availableForTitle);
    };

    recalc();

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => recalc())
      : null;

    if (observer && measureRowRef.current) {
      observer.observe(measureRowRef.current);
    }

    return () => {
      observer?.disconnect();
    };
  }, [course.name, prev, next]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const openEditModal = () => {
    if (!editable) return;

    const loadFlightSchools = async () => {
      const [allCourses, allStudents] = await Promise.all([
        db.courses.toArray(),
        db.students.toArray(),
      ]);
      setFlightSchoolOptions(extractFlightSchools([
        ...allCourses.map((item) => item.flightSchool),
        ...allStudents.map((item) => item.flightSchool),
      ]));
    };

    void loadFlightSchools();
    setEditModalOpen(true);
  };

  const handleLongPressStart = () => {
    if (!editable) return;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      openEditModal();
      clearLongPressTimer();
    }, 550);
  };

  const titleContent = (
    <div
      onMouseDown={handleLongPressStart}
      onMouseUp={clearLongPressTimer}
      onMouseLeave={clearLongPressTimer}
      onTouchStart={handleLongPressStart}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      style={{ width: '100%', minWidth: 0, cursor: editable ? 'pointer' : 'default' }}
    >
      <CourseTitle course={course} />
    </div>
  );

  return (
    <Card size="small" styles={{ body: { padding: 12 } }}>
      <div
        aria-hidden
        style={{
          height: 0,
          overflow: "hidden",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          ref={measureRowRef}
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            alignItems: "center",
            columnGap: 12,
            width: "100%",
          }}
        >
          <div ref={measurePrevRef}>
            {prev && <Button type="link" icon={<LeftOutlined />} onClick={prev} />}
          </div>
          <div ref={titleMeasureRef} style={{ whiteSpace: "nowrap", display: "inline-block", justifySelf: "center" }}>
            <CourseTitle course={course} />
          </div>
          <div ref={measureNextRef}>
            {next && <Button type="link" icon={<RightOutlined />} onClick={next} />}
          </div>
        </div>
      </div>

      {compactHeader ? (
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            {prev && <Button type="link" icon={<LeftOutlined />} onClick={prev} />}
            {next && <Button type="link" icon={<RightOutlined />} onClick={next} />}
          </div>
          {titleContent}
        </Space>
      ) : (
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', columnGap: 12 }}>
            <div style={{ justifySelf: 'start' }}>
              {prev && <Button type="link" icon={<LeftOutlined />} onClick={prev} />}
            </div>
            {titleContent}
            <div style={{ justifySelf: 'end' }}>
              {next && <Button type="link" icon={<RightOutlined />} onClick={next} />}
            </div>
          </div>
        </Space>
      )}
      <CourseForm
        open={editModalOpen}
        courseId={course.id}
        existingFlightSchools={flightSchoolOptions}
        defaultFlightSchool={sanitizeFlightSchoolName(course.flightSchool)}
        onClose={() => setEditModalOpen(false)}
        onSaved={(updatedCourse) => {
          onCourseUpdated?.(updatedCourse);
        }}
      />
    </Card>
  );
};

export default CourseHeader;
