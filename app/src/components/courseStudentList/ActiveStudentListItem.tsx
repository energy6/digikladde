import { faBan, faPlaneArrival } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, List, Popconfirm, Space } from 'antd';
import { useRef } from 'react';
import type { Flight, Student } from '../../models/types';
import { isDoubleTap } from '../../utils/doubleTap';
import StudentListItem from '../StudentListItem';

type ActiveStudentListItemProps = {
  student: Student;
  flight: Flight;
  nowTs: number;
  onOpenRemarks: (flight: Flight, student: Student) => void;
  onAbortFlight: (flightId: number) => void;
  onLandFlight: (flightId: number) => void;
};

const ActiveStudentListItem = ({
  student,
  flight,
  nowTs,
  onOpenRemarks,
  onAbortFlight,
  onLandFlight,
}: ActiveStudentListItemProps) => {
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
      style={{
        background: '#1f5f3a',
        borderRadius: 8,
        paddingInline: 12,
        paddingBlock: 6,
        marginBottom: 6,
      }}
      actions={[
        <Space orientation="horizontal" size="small" align="center">
          <Popconfirm
            title="Flug abbrechen?"
            okText="Ja"
            cancelText="Nein"
            onConfirm={() => {
              if (flightId) {
                onAbortFlight(flightId);
              }
            }}
          >
            <Button danger icon={<FontAwesomeIcon icon={faBan} />} disabled={!flightId} />
          </Popconfirm>
          <Button
            type="primary"
            danger
            onClick={() => {
              if (flightId) {
                onLandFlight(flightId);
              }
            }}
            icon={<FontAwesomeIcon icon={faPlaneArrival} style={{ width: '2em', height: '2em' }} />}
            disabled={!flightId}
            style={{ width: '4em', height: '4em' }}
          />
        </Space>,
      ]}
    >
      <StudentListItem student={student} flight={flight} nowTs={nowTs} />
    </List.Item>
  );
};

export default ActiveStudentListItem;
