import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Modal, Select, Space } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { db } from "../db/database";
import { courseTypes, type Course, type CourseType } from "../models/types";
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
  const [draft, setDraft] = useState({
    name: course.name,
    courseType: course.courseType,
    startDate: course.startDate,
    endDate: course.endDate,
  });

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
    setDraft({
      name: course.name,
      courseType: course.courseType,
      startDate: course.startDate,
      endDate: course.endDate,
    });
  }, [course]);

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
    setDraft({
      name: course.name,
      courseType: course.courseType,
      startDate: course.startDate,
      endDate: course.endDate,
    });
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

  const handleSave = async () => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) return;

    if (course.id) {
      await db.courses.update(course.id, {
        name: trimmedName,
        courseType: draft.courseType,
        startDate: draft.startDate,
        endDate: draft.endDate,
      });
    }

    const updatedCourse: Course = {
      ...course,
      name: trimmedName,
      courseType: draft.courseType as CourseType,
      startDate: draft.startDate,
      endDate: draft.endDate,
    };

    onCourseUpdated?.(updatedCourse);
    setEditModalOpen(false);
  };

  const titleContent = (
    <div
      onMouseDown={handleLongPressStart}
      onMouseUp={clearLongPressTimer}
      onMouseLeave={clearLongPressTimer}
      onTouchStart={handleLongPressStart}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      style={{ width: '100%', cursor: editable ? 'pointer' : 'default' }}
    >
      <CourseTitle course={course} />
    </div>
  );

  return (
    <Card size="small" bodyStyle={{ padding: 12 }}>
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
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            {prev && <Button type="link" icon={<LeftOutlined />} onClick={prev} />}
            {next && <Button type="link" icon={<RightOutlined />} onClick={next} />}
          </div>
          {titleContent}
        </Space>
      ) : (
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
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

      <Modal
        title="Kursinfos bearbeiten"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleSave}
        okText="Speichern"
      >
        <Form layout="vertical">
          <Form.Item label="Kursname" required>
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Form.Item>
          <Form.Item label="Kursart" required>
            <Select
              options={courseTypes.map((type) => ({ label: type, value: type }))}
              value={draft.courseType}
              onChange={(value) => setDraft({ ...draft, courseType: value as CourseType })}
            />
          </Form.Item>
          <Form.Item label="Startdatum" required>
            <Input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
          </Form.Item>
          <Form.Item label="Enddatum" required>
            <Input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default CourseHeader;
