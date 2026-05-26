import { faBackwardStep, faForwardStep } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, List } from 'antd';
import type { Flight, Student } from '../../models/types';
import StudentListItem from '../StudentListItem';

type PendingStudentListItemProps = {
  student: Student;
  flight: Flight;
  nowTs: number;
  onOpenRemarks: (flight: Flight, student: Student) => void;
  onResumeFlight: (flightId: number) => void;
  onTerminateFlight: (flightId: number) => void;
};

const PendingStudentListItem = ({
  student,
  flight,
  nowTs,
  onOpenRemarks,
  onResumeFlight,
  onTerminateFlight,
}: PendingStudentListItemProps) => {
  const flightId = flight.id;

  return (
    <List.Item
      onDoubleClick={() => onOpenRemarks(flight, student)}
      style={{
        background: '#1765ad',
        borderRadius: 8,
        paddingInline: 12,
        paddingBlock: 6,
        marginBottom: 6,
      }}
      actions={[
        <Button
          onClick={() => {
            if (flightId) {
              onResumeFlight(flightId);
            }
          }}
          icon={<FontAwesomeIcon icon={faBackwardStep} />}
          disabled={!flightId}
        />,
        <Button
          onClick={() => {
            if (flightId) {
              onTerminateFlight(flightId);
            }
          }}
          icon={<FontAwesomeIcon icon={faForwardStep} />}
          disabled={!flightId}
        />,
      ]}
    >
      <StudentListItem student={student} flight={flight} nowTs={nowTs} />
    </List.Item>
  );
};

export default PendingStudentListItem;
