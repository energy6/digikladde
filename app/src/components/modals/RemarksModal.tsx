import { faCheck, faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Checkbox, Form, Input, Modal, Space, Typography } from 'antd';
import { maneuvers } from '../../models/types';

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
  maneuversEnabled: boolean;
  canSave: boolean;
  isListening: boolean;
  onCancel: () => void;
  onToggleDictation: () => void;
  onSave: () => void;
  onNewRemarkChange: (value: string) => void;
  onSelectedManeuversChange: (values: string[]) => void;
};

const RemarksModal = ({
  open,
  selectedRemarkFlight,
  remarksReadOnly,
  remarksContextText,
  existingRemarks,
  newRemark,
  selectedManeuvers,
  maneuversEnabled,
  canSave,
  isListening,
  onCancel,
  onToggleDictation,
  onSave,
  onNewRemarkChange,
  onSelectedManeuversChange,
}: RemarksModalProps) => {
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
          label="Manöver"
          style={{ marginBottom: 0, display: remarksReadOnly || !maneuversEnabled ? 'none' : 'block' }}
        >
          <Checkbox.Group
            options={maneuvers}
            value={selectedManeuvers}
            onChange={(values) => onSelectedManeuversChange(values.map((value) => String(value)))}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Space>
    </Modal>
  );
};

export default RemarksModal;
