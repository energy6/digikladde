import { AutoComplete, Form, Input, InputNumber } from 'antd';
import { sanitizeFlightSchoolName, UNKNOWN_FLIGHT_SCHOOL } from '../utils/flightSchool';

export type StudentFields = {
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
  flightSchool: string;
};

type Props = {
  value: StudentFields;
  flightSchoolOptions?: string[];
  onChange: (value: StudentFields) => void;
};

const StudentForm = ({ value, flightSchoolOptions = [], onChange }: Props) => {
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
      <Form.Item label={<>Flugschule <span style={{ color: '#ff4d4f' }}>*</span></>} style={{ marginTop: 8, marginBottom: 0, width: '100%' }}>
        <AutoComplete
          options={flightSchoolOptions.map((school) => ({ value: school }))}
          showSearch={{
            filterOption: (input, option) => (option?.value ?? '').toLocaleLowerCase('de-DE').includes(input.toLocaleLowerCase('de-DE')),
          }}
          value={value.flightSchool}
          onChange={(nextValue) => onChange({
            ...value,
            flightSchool: String(nextValue),
          })}
        >
          <Input
            placeholder="Flugschule eingeben oder auswählen"
            onBlur={() => onChange({
              ...value,
              flightSchool: sanitizeFlightSchoolName(value.flightSchool || UNKNOWN_FLIGHT_SCHOOL),
            })}
          />
        </AutoComplete>
      </Form.Item>
    </Form>
  );
};

export default StudentForm;
