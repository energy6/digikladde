import { SwapOutlined } from '@ant-design/icons';
import { faPlaneDeparture } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AutoComplete, Button, Col, Form, Input, Modal, Row, Select, Space, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import ManeuverDropdown from '../ManeuverDropdown';
import type { Course, FlightDetails, Student } from '../../models/types';
import type { FlightDetailOptions } from '../../utils/flightDetailHistory';

type StartFlightModalProps = {
  open: boolean;
  course: Course;
  selectedFlightStudent: Student | null;
  flightDetails: FlightDetails;
  flightDetailOptions: FlightDetailOptions;
  selectedManeuvers: string[];
  maneuversEnabled: boolean;
  startLeiterOptions: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onOk: () => void;
  onFlightDetailsChange: (details: FlightDetails) => void;
  onSwapStartAndLandTeachers: () => void;
  onSelectedManeuversChange: (values: string[]) => void;
};

type FlightDetailFieldProps = {
  label: ReactNode;
  value: string;
  options: string[];
  onChange: (value: string) => void;
};

const filterFlightDetailOption = (input: string, option?: { value?: string }) => (
  (option?.value ?? '').toLocaleLowerCase('de-DE').includes(input.toLocaleLowerCase('de-DE'))
);

const FlightDetailField = ({ label, value, options, onChange }: FlightDetailFieldProps) => (
  <Form.Item label={label}>
    <AutoComplete
      value={value}
      options={options.map((option) => ({ value: option }))}
      showSearch={{ filterOption: filterFlightDetailOption }}
      onChange={(nextValue) => onChange(String(nextValue))}
    >
      <Input />
    </AutoComplete>
  </Form.Item>
);

const StartFlightModal = ({
  open,
  course,
  selectedFlightStudent,
  flightDetails,
  flightDetailOptions,
  selectedManeuvers,
  maneuversEnabled,
  startLeiterOptions,
  onCancel,
  onOk,
  onFlightDetailsChange,
  onSwapStartAndLandTeachers,
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
            <FlightDetailField
              label="Gelände"
              value={flightDetails.terrain ?? ''}
              options={flightDetailOptions.terrain ?? []}
              onChange={(value) => onFlightDetailsChange({ ...flightDetails, terrain: value })}
            />
            <FlightDetailField
              label="Lehrer"
              value={flightDetails.teacher ?? ''}
              options={flightDetailOptions.teacher ?? []}
              onChange={(value) => onFlightDetailsChange({ ...flightDetails, teacher: value })}
            />
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
            <Row gutter={8}>
              <Col span={12}>
                <FlightDetailField
                  label="Startplatz"
                  value={flightDetails.startPlace ?? ''}
                  options={flightDetailOptions.startPlace ?? []}
                  onChange={(value) => onFlightDetailsChange({ ...flightDetails, startPlace: value })}
                />
              </Col>
              <Col span={12}>
                <FlightDetailField
                  label="Lehrer am Startplatz"
                  value={flightDetails.startTeacher ?? ''}
                  options={flightDetailOptions.startTeacher ?? []}
                  onChange={(value) => onFlightDetailsChange({ ...flightDetails, startTeacher: value })}
                />
              </Col>
            </Row>
            <Row gutter={8}>
              <Col span={12}>
                <FlightDetailField
                  label="Landeplatz"
                  value={flightDetails.landPlace ?? ''}
                  options={flightDetailOptions.landPlace ?? []}
                  onChange={(value) => onFlightDetailsChange({ ...flightDetails, landPlace: value })}
                />
              </Col>
              <Col span={12}>
                <FlightDetailField
                  label={(
                    <Space className="flight-detail-label-action">
                      <span>Lehrer am Landeplatz</span>
                      <Tooltip title="Lehrer an Start- und Landeplatz tauschen">
                        <Button
                          type="text"
                          size="small"
                          icon={<SwapOutlined />}
                          onClick={onSwapStartAndLandTeachers}
                        />
                      </Tooltip>
                    </Space>
                  )}
                  value={flightDetails.landTeacher ?? ''}
                  options={flightDetailOptions.landTeacher ?? []}
                  onChange={(value) => onFlightDetailsChange({ ...flightDetails, landTeacher: value })}
                />
              </Col>
            </Row>
          </>
        ) : null}
        {maneuversEnabled ? (
          <Form.Item label="Manöver">
            <ManeuverDropdown
              value={selectedManeuvers}
              lastRatings={selectedFlightStudent?.lastRatings}
              onChange={onSelectedManeuversChange}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default StartFlightModal;
