import { SwapOutlined } from '@ant-design/icons';
import { faFloppyDisk, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AutoComplete, Button, Col, Form, Input, message, Modal, Popconfirm, Row, Select, Slider, Space, Tooltip, Typography } from 'antd';
import { cloneElement, Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import SliderInternalContext from 'antd/es/slider/Context';
import type { Course, Flight, FlightDetails, ManeuverRatings } from '../../models/types';
import type { FlightDetailOptions } from '../../utils/flightDetailHistory';
import { buildRatings, formatRatingLabel, getRatingKeys, normalizeRating } from '../../utils/maneuverRatings';
import ManeuverDropdown from '../ManeuverDropdown';

const { Text } = Typography;

export type FlightEditValues = {
  startTime: string;
  endTime?: string;
  landingMarkedAt?: string;
  landingPendingUntil?: string;
  landingFinalizedAt?: string;
  details?: FlightDetails;
  maneuvers: string[];
  ratings?: ManeuverRatings;
};

type FlightEditModalProps = {
  open: boolean;
  course: Course;
  flight: Flight | null;
  studentName: string;
  flightDetailOptions: FlightDetailOptions;
  maneuversEnabled: boolean;
  saving?: boolean;
  onCancel: () => void;
  onSave: (values: FlightEditValues) => Promise<void>;
  onDelete: () => Promise<void>;
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

const toLocalDateValue = (isoValue?: string): string => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toLocalTimeValue = (isoValue?: string): string => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const toIsoValue = (dateValue: string, timeValue: string): string | null => {
  if (!dateValue || !timeValue) return null;

  const date = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const toLocalDateTimeParts = (date: Date): { dateValue: string; timeValue: string } => ({
  dateValue: toLocalDateValue(date.toISOString()),
  timeValue: toLocalTimeValue(date.toISOString()),
});

const isBeforeStart = (
  nextEndDate: string,
  nextEndTime: string,
  nextStartDate: string,
  nextStartTime: string,
): boolean => {
  const nextStartIso = toIsoValue(nextStartDate, nextStartTime);
  const nextEndIso = toIsoValue(nextEndDate, nextEndTime);
  if (!nextStartIso || !nextEndIso) return false;

  return Date.parse(nextEndIso) < Date.parse(nextStartIso);
};

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

const FlightEditModal = ({
  open,
  course,
  flight,
  studentName,
  flightDetailOptions,
  maneuversEnabled,
  saving = false,
  onCancel,
  onSave,
  onDelete,
}: FlightEditModalProps) => {
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [details, setDetails] = useState<FlightDetails>({});
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);
  const [ratings, setRatings] = useState<ManeuverRatings>({});

  useEffect(() => {
    if (!open || !flight) return;

    setStartDate(toLocalDateValue(flight.startTime));
    setStartTime(toLocalTimeValue(flight.startTime));
    setEndDate(toLocalDateValue(flight.endTime));
    setEndTime(toLocalTimeValue(flight.endTime));
    setDetails(flight.details ?? {});
    setSelectedManeuvers([...(flight.maneuvers ?? [])]);
    setRatings(buildRatings(flight.maneuvers ?? [], flight.ratings));
  }, [flight, open]);

  const startLeiterOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [];
    if (details.teacher) opts.push({ label: `${details.teacher} (Lehrer)`, value: details.teacher });
    course.students.forEach((student) => {
      if (!opts.some((option) => option.value === student.name)) {
        opts.push({ label: student.name, value: student.name });
      }
    });
    return opts;
  }, [course.students, details.teacher]);

  const ratingKeys = useMemo(() => (
    maneuversEnabled ? getRatingKeys(selectedManeuvers) : []
  ), [maneuversEnabled, selectedManeuvers]);

  const handleManeuversChange = (values: string[]) => {
    setSelectedManeuvers(values);
    setRatings((currentRatings) => buildRatings(values, currentRatings));
  };

  const handleStartDateChange = (nextStartDate: string) => {
    setStartDate(nextStartDate);
    setEndDate(nextStartDate);

    if (endTime && startTime && endTime < startTime) {
      setEndTime(startTime);
    }
  };

  const handleStartTimeChange = (nextStartTime: string) => {
    const currentStartIso = toIsoValue(startDate, startTime);
    const currentEndIso = toIsoValue(endDate, endTime);
    const nextStartIso = toIsoValue(startDate, nextStartTime);

    setStartTime(nextStartTime);

    if (!currentStartIso || !currentEndIso || !nextStartIso) return;

    const durationMs = Date.parse(currentEndIso) - Date.parse(currentStartIso);
    if (durationMs < 0) return;

    const nextEnd = new Date(Date.parse(nextStartIso) + durationMs);
    const nextEndParts = toLocalDateTimeParts(nextEnd);
    setEndDate(nextEndParts.dateValue);
    setEndTime(nextEndParts.timeValue);
  };

  const handleEndDateChange = (nextEndDate: string) => {
    if (!nextEndDate) {
      setEndDate('');
      return;
    }

    if (startDate && nextEndDate < startDate) {
      setEndDate(startDate);
      return;
    }

    setEndDate(nextEndDate);

    if (startDate && startTime && endTime && isBeforeStart(nextEndDate, endTime, startDate, startTime)) {
      setEndTime(startTime);
    }
  };

  const handleEndTimeChange = (nextEndTime: string) => {
    if (!nextEndTime) {
      setEndTime('');
      return;
    }

    if (startDate && startTime && endDate && isBeforeStart(endDate, nextEndTime, startDate, startTime)) {
      setEndTime(startTime);
      return;
    }

    setEndTime(nextEndTime);
  };

  const handleSave = async () => {
    const nextStartTime = toIsoValue(startDate, startTime);
    if (!nextStartTime) {
      message.error('Startdatum und Startzeit sind erforderlich.');
      return;
    }

    const nextEndTimeValue = endDate && endTime ? toIsoValue(endDate, endTime) : undefined;
    if ((endDate || endTime) && !nextEndTimeValue) {
      message.error('Enddatum und Endzeit müssen vollständig sein.');
      return;
    }
    const nextEndTime = nextEndTimeValue ?? undefined;

    if (nextEndTime && Date.parse(nextEndTime) < Date.parse(nextStartTime)) {
      message.error('Die Endzeit darf nicht vor der Startzeit liegen.');
      return;
    }

    const nextManeuvers = maneuversEnabled ? [...selectedManeuvers] : [...(flight?.maneuvers ?? [])];
    const nextRatings = maneuversEnabled ? buildRatings(nextManeuvers, ratings) : flight?.ratings;
    const finalizedAt = nextEndTime ? (flight?.landingFinalizedAt ?? new Date().toISOString()) : undefined;

    await onSave({
      startTime: nextStartTime,
      endTime: nextEndTime,
      landingMarkedAt: nextEndTime,
      landingPendingUntil: undefined,
      landingFinalizedAt: finalizedAt,
      details,
      maneuvers: nextManeuvers,
      ratings: nextRatings,
    });
  };

  return (
    <Modal
      title={`Flug bearbeiten: ${studentName}`}
      open={open}
      onCancel={onCancel}
      width={720}
      footer={(
        <Space orientation="horizontal" size="small" style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Popconfirm
            title="Flug löschen?"
            description="Dieser Flug wird dauerhaft aus dem Kurs entfernt."
            okText="Löschen"
            okButtonProps={{ danger: true }}
            cancelText="Abbrechen"
            onConfirm={() => {
              void onDelete();
            }}
          >
            <Button danger icon={<FontAwesomeIcon icon={faTrashCan} />} disabled={!flight || saving} />
          </Popconfirm>
          <Button
            type="primary"
            icon={<FontAwesomeIcon icon={faFloppyDisk} />}
            loading={saving}
            onClick={() => {
              void handleSave();
            }}
          />
        </Space>
      )}
    >
      <Form layout="vertical" className="flight-edit-form">
        <Row gutter={[8, 0]}>
          <Col span={12}>
            <Form.Item label="Start" required>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  className="flight-edit-picker-input flight-edit-date-input"
                  type="date"
                  value={startDate}
                  onChange={(event) => handleStartDateChange(event.target.value)}
                />
                <Input
                  className="flight-edit-picker-input flight-edit-time-input"
                  type="time"
                  value={startTime}
                  onChange={(event) => handleStartTimeChange(event.target.value)}
                />
              </Space.Compact>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Ende">
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  className="flight-edit-picker-input flight-edit-date-input"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(event) => handleEndDateChange(event.target.value)}
                />
                <Input
                  className="flight-edit-picker-input flight-edit-time-input"
                  type="time"
                  value={endTime}
                  min={endDate && startDate && endDate === startDate ? startTime || undefined : undefined}
                  onChange={(event) => handleEndTimeChange(event.target.value)}
                />
              </Space.Compact>
            </Form.Item>
          </Col>
        </Row>

        {(course.courseType === 'Grundkurs' || course.courseType === 'Windenkurs') ? (
          <Row gutter={[8, 0]}>
            <Col span={12}>
              <FlightDetailField
                label="Gelände"
                value={details.terrain ?? ''}
                options={flightDetailOptions.terrain ?? []}
                onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, terrain: value }))}
              />
            </Col>
            <Col span={12}>
              <FlightDetailField
                label="Lehrer"
                value={details.teacher ?? ''}
                options={flightDetailOptions.teacher ?? []}
                onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, teacher: value }))}
              />
            </Col>
          </Row>
        ) : null}

        {course.courseType === 'Windenkurs' ? (
          <Form.Item label="Startleiter">
            <Select
              showSearch
              allowClear
              placeholder="Schüler oder Lehrer wählen…"
              options={startLeiterOptions}
              value={details.startLeiter ?? undefined}
              onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, startLeiter: value }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
        ) : null}

        {course.courseType === 'Höhenkurs' ? (
          <>
            <Row gutter={[8, 0]}>
              <Col span={12}>
                <FlightDetailField
                  label="Startplatz"
                  value={details.startPlace ?? ''}
                  options={flightDetailOptions.startPlace ?? []}
                  onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, startPlace: value }))}
                />
              </Col>
              <Col span={12}>
                <FlightDetailField
                  label="Lehrer am Startplatz"
                  value={details.startTeacher ?? ''}
                  options={flightDetailOptions.startTeacher ?? []}
                  onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, startTeacher: value }))}
                />
              </Col>
            </Row>
            <Row gutter={[8, 0]}>
              <Col span={12}>
                <FlightDetailField
                  label="Landeplatz"
                  value={details.landPlace ?? ''}
                  options={flightDetailOptions.landPlace ?? []}
                  onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, landPlace: value }))}
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
                          onClick={() => setDetails((currentDetails) => ({
                            ...currentDetails,
                            startTeacher: currentDetails.landTeacher,
                            landTeacher: currentDetails.startTeacher,
                          }))}
                        />
                      </Tooltip>
                    </Space>
                  )}
                  value={details.landTeacher ?? ''}
                  options={flightDetailOptions.landTeacher ?? []}
                  onChange={(value) => setDetails((currentDetails) => ({ ...currentDetails, landTeacher: value }))}
                />
              </Col>
            </Row>
          </>
        ) : null}

        {maneuversEnabled ? (
          <>
            <Form.Item label="Manöver">
              <ManeuverDropdown
                value={selectedManeuvers}
                onChange={handleManeuversChange}
              />
            </Form.Item>
            <div className="remarks-rating-grid flight-edit-rating-grid">
              {ratingKeys.map((ratingKey) => (
                <Fragment key={ratingKey}>
                  <Text className="remarks-rating-label">{formatRatingLabel(ratingKey, ratings)}</Text>
                  <SliderInternalContext.Provider
                    value={{
                      handleRender: (node, info) => cloneElement(
                        node,
                        {
                          className: [node.props.className, 'remarks-rating-handle']
                            .filter(Boolean)
                            .join(' '),
                        },
                        <span className="remarks-rating-handle-value">{info.value}</span>,
                      ),
                    }}
                  >
                    <Slider
                      min={0}
                      max={10}
                      step={1}
                      tooltip={{ formatter: null }}
                      value={ratings[ratingKey] ?? 0}
                      ariaValueTextFormatterForHandle={(value) => `Bewertung ${value} von 10`}
                      onChange={(value) => setRatings((currentRatings) => ({
                        ...currentRatings,
                        [ratingKey]: normalizeRating(value),
                      }))}
                    />
                  </SliderInternalContext.Provider>
                </Fragment>
              ))}
            </div>
          </>
        ) : null}

      </Form>
    </Modal>
  );
};

export default FlightEditModal;
