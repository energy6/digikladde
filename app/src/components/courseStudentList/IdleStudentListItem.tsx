import { faCircleExclamation, faPlaneDeparture } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Checkbox, List, Space } from 'antd';
import { useRef } from 'react';
import type { Student } from '../../models/types';
import { isDoubleTap } from '../../utils/doubleTap';
import { useLongPress } from '../../utils/longPress';
import StudentAvatar from '../StudentAvatar';

type IdleStudentListItemProps = {
  student: Student;
  deleteMode: boolean;
  isSelected: boolean;
  showRemarksIndicator: boolean;
  onToggleStudentSelection: (studentId: number) => void;
  onOpenLastFlightRemarks: (student: Student) => Promise<void>;
  onEditStudent: (student: Student) => void;
  onStartFlight: (student: Student) => void;
};

const IdleStudentListItem = ({
  student,
  deleteMode,
  isSelected,
  showRemarksIndicator,
  onToggleStudentSelection,
  onOpenLastFlightRemarks,
  onEditStudent,
  onStartFlight,
}: IdleStudentListItemProps) => {
  const studentId = student.id;
  const lastTapRef = useRef(0);
  const itemClassName = deleteMode
    ? `student-idle-delete-item${isSelected ? ' student-idle-delete-item-selected' : ''}`
    : 'student-idle-item';
  const { longPressHandlers, consumeLongPressClick, didLongPressFire } = useLongPress(
    () => onEditStudent(student),
    { disabled: deleteMode || !studentId },
  );

  return (
    <List.Item
      {...longPressHandlers}
      onClick={() => {
        if (consumeLongPressClick()) return;
        if (deleteMode && studentId) {
          onToggleStudentSelection(studentId);
        }
      }}
      onDoubleClick={() => {
        if (!deleteMode) {
          void onOpenLastFlightRemarks(student);
        }
      }}
      onPointerUp={(event) => {
        longPressHandlers.onPointerUp(event);
        if (didLongPressFire()) return;
        if (!deleteMode && isDoubleTap(event, lastTapRef)) {
          void onOpenLastFlightRemarks(student);
        }
      }}
      className={itemClassName}
      extra={deleteMode ? (
        <Checkbox
          checked={isSelected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => {
            if (studentId) {
              onToggleStudentSelection(studentId);
            }
          }}
        />
      ) : undefined}
      actions={deleteMode ? [] : [
        <Space orientation="horizontal" size="small" align="center">
          <Button
            type="primary"
            icon={<FontAwesomeIcon icon={faPlaneDeparture} />}
            onClick={() => {
              onStartFlight(student);
            }}
          />
        </Space>,
      ]}
    >
      <List.Item.Meta
        avatar={(
          <StudentAvatar
            name={student.name}
            photoDataUrl={student.photoDataUrl}
            size={44}
            className="student-list-avatar"
          />
        )}
        title={(
          <span>
            {student.name} ({student.totalFlights ?? 0})
            {showRemarksIndicator ? (
              <FontAwesomeIcon
                icon={faCircleExclamation}
                className="student-remarks-indicator"
                aria-label="Letzter Flug enthält Bemerkungen"
              />
            ) : null}
          </span>
        )}
        description={`${student.glider} — ${student.color}`}
      />
    </List.Item>
  );
};

export default IdleStudentListItem;
