import { faBackwardStep, faForwardStep } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, List, Space } from 'antd';
import { useRef } from 'react';
import type { Flight, Student } from '../../models/types';
import { isDoubleTap } from '../../utils/doubleTap';
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
  const lastTapRef = useRef(0);

  return (
    <List.Item
      onDoubleClick={() => onOpenRemarks(flight, student)}
      onPointerUp={(event) => {
        if (isDoubleTap(event, lastTapRef)) {
          onOpenRemarks(flight, student);
        }
      }}
      className="student-pending-item"
      actions={[
        <Space orientation="horizontal" size="small" align="center">
          <Button
            onClick={() => {
              if (flightId) {
                onResumeFlight(flightId);
              }
            }}
            icon={<FontAwesomeIcon icon={faBackwardStep} />}
            disabled={!flightId}
          />
          <Button
            onClick={() => {
              if (flightId) {
                onTerminateFlight(flightId);
              }
            }}
            icon={<FontAwesomeIcon icon={faForwardStep} />}
            disabled={!flightId}
          />
        </Space>,
      ]}
    >
      <StudentListItem student={student} flight={flight} nowTs={nowTs} />
    </List.Item>
  );
};

export default PendingStudentListItem;
