import { List } from "antd";
import type { Flight, Student } from "../models/types";
import { durationFormatter, timeFormatter } from "../utils/DatetimeFormatter";

interface StudentListItemProps {
  student: Student;
  flight: Flight;
  nowTs: number;
}

const StudentListItem = ({student, flight, nowTs}: StudentListItemProps) => {
  const startTime = new Date(flight.startTime);
  const landingTime = flight.landingMarkedAt ? new Date(flight.landingMarkedAt) : null;

  return (
    <List.Item.Meta
      title={<span style={{ color: '#fff', fontWeight: 600 }}>{student.name}</span>}
      description={
        <div style={{ color: '#deeeff' }}>
          <div>
            Flug: {timeFormatter.format(startTime)}
            {landingTime && ` - ${timeFormatter.format(landingTime)}`}
            {` | ${durationFormatter(startTime.getTime(), landingTime ? landingTime.getTime() : nowTs)}`}
          </div>
          {flight.maneuvers && <div>{`Manöver: ${flight.maneuvers.join(', ')}`}</div>}
        </div>
      }
    />
  );
};

export default StudentListItem;
