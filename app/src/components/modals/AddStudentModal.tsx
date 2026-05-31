import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Modal, Select, Space, Typography } from 'antd';
import type { Student } from '../../models/types';
import StudentForm, { type StudentFields } from '../StudentForm';

const { Text } = Typography;

type AddStudentModalProps = {
  open: boolean;
  addMode: 'existing' | 'new';
  selectedStudentId: number | null;
  newStudent: StudentFields;
  activeFlightSchool: string;
  flightSchoolOptions: string[];
  availableExistingStudents: Student[];
  onCancel: () => void;
  onOk: () => void;
  onModeChange: (mode: 'existing' | 'new') => void;
  onSelectedStudentIdChange: (studentId: number | null) => void;
  onNewStudentChange: (student: StudentFields) => void;
};

const AddStudentModal = ({
  open,
  addMode,
  selectedStudentId,
  newStudent,
  activeFlightSchool,
  flightSchoolOptions,
  availableExistingStudents,
  onCancel,
  onOk,
  onModeChange,
  onSelectedStudentIdChange,
  onNewStudentChange,
}: AddStudentModalProps) => {
  return (
    <Modal
      title="Schüler hinzufügen"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText={<FontAwesomeIcon icon={faFloppyDisk} />}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        <Text strong>Wähle vorhandenen Schüler oder erstelle einen neuen.</Text>
        <Text type="secondary">Aktive Flugschule: {activeFlightSchool}</Text>
        <Select
          placeholder="Schüler auswählen"
          value={addMode === 'new' ? '__new__' : (selectedStudentId ?? undefined)}
          showSearch={{
            filterOption: (input, option) => {
              if (!option) return false;
              const normalizedInput = input.trim().toLocaleLowerCase('de-DE');
              if (!normalizedInput) return true;

              const searchName = typeof option.searchName === 'string'
                ? option.searchName
                : '';

              return searchName
                .toLocaleLowerCase('de-DE')
                .includes(normalizedInput);
            },
          }}
          notFoundContent="Kein Schüler gefunden"
          onChange={(value) => {
            if (value === '__new__') {
              onModeChange('new');
              onSelectedStudentIdChange(null);
            } else {
              onModeChange('existing');
              onSelectedStudentIdChange(Number(value));
            }
          }}
          options={[
            { label: 'Neuer Schüler', value: '__new__', searchName: '' },
            ...[...availableExistingStudents]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((student) => ({
                label: `${student.name} — ${student.glider}`,
                value: student.id,
                searchName: student.name,
              })),
          ]}
          style={{ width: '100%' }}
        />

        {addMode === 'new' ? (
          <StudentForm value={newStudent} flightSchoolOptions={flightSchoolOptions} onChange={onNewStudentChange} />
        ) : null}
      </Space>
    </Modal>
  );
};

export default AddStudentModal;
