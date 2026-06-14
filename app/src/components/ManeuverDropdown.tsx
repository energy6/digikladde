import { DownOutlined } from '@ant-design/icons';
import { Checkbox, Popover, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { maneuvers, type ManeuverRatings } from '../models/types';
import { formatRatingLabel } from '../utils/maneuverRatings';

const { Text } = Typography;

type ManeuverDropdownProps = {
  value: string[];
  lastRatings?: ManeuverRatings;
  onChange: (values: string[]) => void;
};

const ManeuverDropdown = ({ value, lastRatings, onChange }: ManeuverDropdownProps) => {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => (
    value.length ? value.map((maneuver) => formatRatingLabel(maneuver, lastRatings)).join(', ') : 'Keine Manöver ausgewählt'
  ), [lastRatings, value]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      content={(
        <Checkbox.Group
          value={value}
          onChange={(values) => onChange(values.map((entry) => String(entry)))}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}
        >
          {maneuvers.map((maneuver) => (
            <Checkbox key={maneuver} value={maneuver}>
              {formatRatingLabel(maneuver, lastRatings)}
            </Checkbox>
          ))}
        </Checkbox.Group>
      )}
    >
      <button
        type="button"
        className="maneuver-dropdown-trigger"
        aria-expanded={open}
      >
        <Text style={{ flex: 1 }} ellipsis>
          {label}
        </Text>
        <DownOutlined aria-hidden />
      </button>
    </Popover>
  );
};

export default ManeuverDropdown;
