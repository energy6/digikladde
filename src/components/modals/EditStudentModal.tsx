import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Modal } from 'antd';
import type { Student } from '../../models/types';
import StudentForm from '../StudentForm';

type EditStudentModalProps = {
  open: boolean;
  editStudent: Student | null;
  onCancel: () => void;
  onOk: () => void;
  onEditStudentChange: (student: Student) => void;
};

const EditStudentModal = ({
  open,
  editStudent,
  onCancel,
  onOk,
  onEditStudentChange,
}: EditStudentModalProps) => {
  return (
    <Modal
      title="Schüler bearbeiten"
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText={<FontAwesomeIcon icon={faFloppyDisk} />}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      {editStudent ? (
        <StudentForm
          value={editStudent}
          onChange={(value) => onEditStudentChange({ ...editStudent, ...value })}
        />
      ) : null}
    </Modal>
  );
};

export default EditStudentModal;
