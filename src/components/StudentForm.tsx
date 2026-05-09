import { Form, Input, InputNumber } from 'antd';

export type StudentFields = {
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
};

type Props = {
  value: StudentFields;
  onChange: (value: StudentFields) => void;
};

const StudentForm = ({ value, onChange }: Props) => {
  return (
    <Form layout="vertical" size="small" requiredMark={false} style={{ width: '100%' }}>
      <Form.Item label={<>Name <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8, width: '100%' }}>
        <Input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Form.Item>
      <Form.Item label={<>Schirm <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8, width: '100%' }}>
        <Input
          value={value.glider}
          onChange={(e) => onChange({ ...value, glider: e.target.value })}
        />
      </Form.Item>
      <Form.Item label={<>Farbe <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginBottom: 8, width: '100%' }}>
        <Input
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
        />
      </Form.Item>
      <Form.Item label="Bisherige Flüge" style={{ marginBottom: 0, width: '100%' }}>
        <InputNumber
          min={0}
          value={value.totalFlights}
          onChange={(v) => onChange({ ...value, totalFlights: v ?? 0 })}
          style={{ width: '100%' }}
        />
      </Form.Item>
    </Form>
  );
};

export default StudentForm;
