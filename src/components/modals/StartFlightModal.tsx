import { faPlaneDeparture } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Checkbox, Form, Input, Modal, Select } from 'antd';
import type { Course, FlightDetails, Student } from '../../models/types';
import { maneuvers } from '../../models/types';

type StartFlightModalProps = {
  open: boolean;
  course: Course;
  selectedFlightStudent: Student | null;
  flightDetails: FlightDetails;
  selectedManeuvers: string[];
  maneuversEnabled: boolean;
  startLeiterOptions: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onOk: () => void;
  onFlightDetailsChange: (details: FlightDetails) => void;
  onSelectedManeuversChange: (values: string[]) => void;
};

const StartFlightModal = ({
  open,
  course,
  selectedFlightStudent,
  flightDetails,
  selectedManeuvers,
  maneuversEnabled,
  startLeiterOptions,
  onCancel,
  onOk,
  onFlightDetailsChange,
  onSelectedManeuversChange,
}: StartFlightModalProps) => {
  return (
    <Modal
      title={selectedFlightStudent ? `Flug starten: ${selectedFlightStudent.name}` : 'Flug starten'}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText={<FontAwesomeIcon icon={faPlaneDeparture} />}
      cancelButtonProps={{ style: { display: 'none' } }}
      okButtonProps={{
        style: { background: '#1f8f3a', borderColor: '#1f8f3a' },
      }}
    >
      <Form layout="vertical">
        {(course.courseType === 'Grundkurs' || course.courseType === 'Windenkurs') ? (
          <>
            <Form.Item label="Gelände">
              <Input
                value={flightDetails.terrain ?? ''}
                onChange={(event) => onFlightDetailsChange({ ...flightDetails, terrain: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="Lehrer">
              <Input
                value={flightDetails.teacher ?? ''}
                onChange={(event) => onFlightDetailsChange({ ...flightDetails, teacher: event.target.value })}
              />
            </Form.Item>
          </>
        ) : null}
        {course.courseType === 'Windenkurs' ? (
          <Form.Item label="Startleiter">
            <Select
              showSearch
              allowClear
              placeholder="Schüler oder Lehrer wählen…"
              options={startLeiterOptions}
              value={flightDetails.startLeiter ?? undefined}
              onChange={(value) => onFlightDetailsChange({ ...flightDetails, startLeiter: value })}
              style={{ width: '100%' }}
            />
          </Form.Item>
        ) : null}
        {course.courseType === 'Höhenkurs' ? (
          <>
            <Form.Item label="Startplatz">
              <Input
                value={flightDetails.startPlace ?? ''}
                onChange={(event) => onFlightDetailsChange({ ...flightDetails, startPlace: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="Lehrer am Start">
              <Input
                value={flightDetails.startTeacher ?? ''}
                onChange={(event) => onFlightDetailsChange({ ...flightDetails, startTeacher: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="Landeplatz">
              <Input
                value={flightDetails.landPlace ?? ''}
                onChange={(event) => onFlightDetailsChange({ ...flightDetails, landPlace: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="Lehrer am Landeplatz">
              <Input
                value={flightDetails.landTeacher ?? ''}
                onChange={(event) => onFlightDetailsChange({ ...flightDetails, landTeacher: event.target.value })}
              />
            </Form.Item>
          </>
        ) : null}
        {maneuversEnabled ? (
          <Form.Item label="Manöver">
            <Checkbox.Group
              options={maneuvers}
              value={selectedManeuvers}
              onChange={(values) => onSelectedManeuversChange([...values])}
              style={{ width: '100%' }}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default StartFlightModal;
