import { faCheck, faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Form, Input, Modal, Slider, Space, Typography } from 'antd';
import { Fragment } from 'react';
import { landingRatingKey, startRatingKey, type ManeuverRatings } from '../../models/types';
import ManeuverDropdown from '../ManeuverDropdown';

const { Text } = Typography;

type SelectedRemarkFlight = {
  flightId: number;
  studentName: string;
};

type RemarksModalProps = {
  open: boolean;
  selectedRemarkFlight: SelectedRemarkFlight | null;
  remarksReadOnly: boolean;
  remarksContextText: string;
  existingRemarks: string[];
  newRemark: string;
  selectedManeuvers: string[];
  ratings: ManeuverRatings;
  lastRatings: ManeuverRatings;
  maneuversEnabled: boolean;
  canSave: boolean;
  isListening: boolean;
  onCancel: () => void;
  onToggleDictation: () => void;
  onSave: () => void;
  onNewRemarkChange: (value: string) => void;
  onSelectedManeuversChange: (values: string[]) => void;
  onRatingChange: (key: string, value: number) => void;
};

const RemarksModal = ({
  open,
  selectedRemarkFlight,
  remarksReadOnly,
  remarksContextText,
  existingRemarks,
  newRemark,
  selectedManeuvers,
  ratings,
  lastRatings,
  maneuversEnabled,
  canSave,
  isListening,
  onCancel,
  onToggleDictation,
  onSave,
  onNewRemarkChange,
  onSelectedManeuversChange,
  onRatingChange,
}: RemarksModalProps) => {
  const ratingKeys = selectedRemarkFlight || ratings[startRatingKey] !== undefined || selectedManeuvers.length
    ? [startRatingKey, ...selectedManeuvers, landingRatingKey]
    : [];
  const formatRatingLabel = (ratingKey: string): string => {
    const lastRating = lastRatings[ratingKey];
    return typeof lastRating === 'number' ? `${ratingKey} (${lastRating})` : ratingKey;
  };

  return (
    <Modal
      title={selectedRemarkFlight ? `Bemerkung: ${selectedRemarkFlight.studentName}` : 'Bemerkung'}
      open={open}
      onCancel={onCancel}
      footer={remarksReadOnly ? null : (
        <Space orientation="horizontal" size="small" style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button
            onClick={onToggleDictation}
            icon={<FontAwesomeIcon icon={faMicrophone} />}
            type={isListening ? 'primary' : 'default'}
          />
          <Button
            type="primary"
            style={{ background: '#1f8f3a', borderColor: '#1f8f3a' }}
            onClick={onSave}
            icon={<FontAwesomeIcon icon={faCheck} />}
            disabled={!canSave}
          />
        </Space>
      )}
    >
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        {remarksContextText ? <Text type="secondary">{remarksContextText}</Text> : null}

        {existingRemarks.length > 0 ? (
          <div>
            {existingRemarks.map((remark, idx) => (
              <p key={`${remark}-${idx}`} style={{ marginBottom: 8 }}>
                {remark}
              </p>
            ))}
          </div>
        ) : null}

        {remarksReadOnly && existingRemarks.length === 0 ? (
          <Text type="secondary">Keine Bemerkungen vorhanden.</Text>
        ) : null}

        <Form.Item style={{ marginBottom: 0, display: remarksReadOnly ? 'none' : 'block' }}>
          <Input.TextArea
            rows={4}
            value={newRemark}
            onChange={(event) => onNewRemarkChange(event.target.value)}
            placeholder="Bemerkung eingeben oder per Mikrofon diktieren"
          />
        </Form.Item>

        <Form.Item
          className="remarks-grid-form-item"
          style={{ marginBottom: 0, display: remarksReadOnly || !maneuversEnabled ? 'none' : 'block' }}
        >
          <div className="remarks-rating-grid">
            <Text className="remarks-rating-label">Manöver</Text>
            <ManeuverDropdown
              value={selectedManeuvers}
              lastRatings={lastRatings}
              onChange={onSelectedManeuversChange}
            />
          </div>
        </Form.Item>

        {ratingKeys.length ? (
          <div className="remarks-rating-grid">
            {ratingKeys.map((ratingKey) => (
              <Fragment key={ratingKey}>
                <Text className="remarks-rating-label">
                  {formatRatingLabel(ratingKey)}
                </Text>
                <Slider
                  min={0}
                  max={10}
                  step={1}
                  tooltip={{ formatter: null }}
                  value={ratings[ratingKey] ?? 0}
                  disabled={remarksReadOnly}
                  onChange={(value) => onRatingChange(ratingKey, value)}
                />
              </Fragment>
            ))}
          </div>
        ) : null}
      </Space>
    </Modal>
  );
};

export default RemarksModal;
