import { EditOutlined } from '@ant-design/icons';
import { faCircleExclamation, faPlaneDeparture } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Checkbox, List, Space } from 'antd';
import type { Student } from '../../models/types';

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

  return (
    <List.Item
      onClick={() => {
        if (deleteMode && studentId) {
          onToggleStudentSelection(studentId);
        }
      }}
      onDoubleClick={() => {
        if (!deleteMode) {
          void onOpenLastFlightRemarks(student);
        }
      }}
      style={deleteMode ? {
        cursor: 'pointer',
        background: isSelected ? '#fff7e6' : undefined,
        borderRadius: 8,
        paddingInline: 8,
        paddingBlock: 6,
      } : { paddingBlock: 6 }}
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
            icon={<EditOutlined />}
            onClick={() => {
              onEditStudent(student);
            }}
          />
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
        title={(
          <span>
            {student.name} ({student.totalFlights ?? 0})
            {showRemarksIndicator ? (
              <FontAwesomeIcon
                icon={faCircleExclamation}
                style={{ color: '#d48806', marginLeft: 8 }}
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
