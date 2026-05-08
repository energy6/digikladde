import jsPDF from 'jspdf';
import { db } from '../db/database';
import type { CourseType, Flight, Student } from '../models/types';

type StudentDayGroup = {
  student: Student;
  flights: Flight[];
  startLeaderCount: number;
};

type DayGroup = {
  dayLabel: string;
  studentGroups: StudentDayGroup[];
};

type TableColumn = {
  key: string;
  label: string;
  width: number;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const toLocalDayKey = (isoDate: string) => {
  const date = new Date(isoDate);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const formatDuration = (startTime: string, endTime?: string) => {
  if (!endTime) return '-';

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const diffMs = end - start;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '-';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${pad2(minutes)}m`;
};

const getTableColumns = (courseType: CourseType): TableColumn[] => {
  if (courseType === 'Grundkurs') {
    return [
      { key: 'no', label: '#', width: 8 },
      { key: 'startTime', label: 'Start', width: 14 },
      { key: 'landingTime', label: 'Landung', width: 14 },
      { key: 'duration', label: 'Dauer', width: 12 },
      { key: 'terrainTeacher', label: 'Gelände / Lehrer', width: 58 },
      { key: 'maneuvers', label: 'Manöver', width: 80 },
    ];
  }

  if (courseType === 'Windenkurs') {
    return [
      { key: 'no', label: '#', width: 8 },
      { key: 'startTime', label: 'Start', width: 14 },
      { key: 'landingTime', label: 'Landung', width: 14 },
      { key: 'duration', label: 'Dauer', width: 12 },
      { key: 'terrainTeacher', label: 'Gelände / Lehrer', width: 44 },
      { key: 'startLeader', label: 'Startleiter', width: 24 },
      { key: 'maneuvers', label: 'Manöver', width: 70 },
    ];
  }

  return [
    { key: 'no', label: '#', width: 8 },
    { key: 'startTime', label: 'Start', width: 14 },
    { key: 'landingTime', label: 'Landung', width: 14 },
    { key: 'duration', label: 'Dauer', width: 12 },
    { key: 'startInfo', label: 'Startplatz / Lehrer', width: 38 },
    { key: 'landInfo', label: 'Landeplatz / Lehrer', width: 38 },
    { key: 'maneuvers', label: 'Manöver', width: 62 },
  ];
};

const fitCellText = (doc: jsPDF, text: string, maxWidth: number) => {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  const ellipsis = '...';
  let value = text;
  while (value.length > 0 && doc.getTextWidth(`${value}${ellipsis}`) > maxWidth) {
    value = value.slice(0, -1);
  }
  return value ? `${value}${ellipsis}` : ellipsis;
};

const getFlightCellValue = (flight: Flight, rowNo: number, courseType: CourseType, timeFormatter: Intl.DateTimeFormat) => {
  const startDate = new Date(flight.startTime);
  const endDate = flight.endTime ? new Date(flight.endTime) : undefined;

  const terrain = flight.details?.terrain ?? '-';
  const teacher = flight.details?.teacher ?? '-';
  const startPlace = flight.details?.startPlace ?? '-';
  const startTeacher = flight.details?.startTeacher ?? '-';
  const landPlace = flight.details?.landPlace ?? '-';
  const landTeacher = flight.details?.landTeacher ?? '-';

  const values: Record<string, string> = {
    no: String(rowNo),
    startTime: timeFormatter.format(startDate),
    landingTime: endDate ? timeFormatter.format(endDate) : '-',
    duration: formatDuration(flight.startTime, flight.endTime),
    maneuvers: flight.maneuvers.length ? flight.maneuvers.join(', ') : '-',
    terrainTeacher: `${terrain} / ${teacher}`,
    startLeader: flight.details?.startLeiter ?? '-',
    startInfo: `${startPlace} / ${startTeacher}`,
    landInfo: `${landPlace} / ${landTeacher}`,
  };

  if (courseType === 'Grundkurs') {
    values.startInfo = '-';
    values.landInfo = '-';
  }

  if (courseType === 'Windenkurs') {
    values.startInfo = '-';
    values.landInfo = '-';
  }

  return values;
};

export const generatePDF = async (courseId: number) => {
  const course = await db.courses.get(courseId);
  if (!course) return;

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: undefined,
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: undefined,
    timeStyle: 'short',
  });

  const flights = await db.flights.where('courseId').equals(courseId).toArray();

  const studentsById = new Map<number, Student>(
    course.students
      .filter((student): student is Student & { id: number } => student.id !== undefined)
      .map((student) => [student.id, student]),
  );

  const dayMap = new Map<string, Flight[]>();
  flights.forEach((flight) => {
    const dayKey = toLocalDayKey(flight.startTime);
    const current = dayMap.get(dayKey) ?? [];
    current.push(flight);
    dayMap.set(dayKey, current);
  });

  const sortedDayKeys = Array.from(dayMap.keys()).sort((a, b) => a.localeCompare(b));
  const dayGroups: DayGroup[] = sortedDayKeys.map((dayKey) => {
    const dayFlights = (dayMap.get(dayKey) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const studentMap = new Map<number, Flight[]>();

    dayFlights.forEach((flight) => {
      const current = studentMap.get(flight.studentId) ?? [];
      current.push(flight);
      studentMap.set(flight.studentId, current);
    });

    const studentGroups: StudentDayGroup[] = Array.from(studentMap.entries())
      .map(([studentId, studentFlights]) => {
        const knownStudent = studentsById.get(studentId);
        const fallbackStudent: Student = {
          id: studentId,
          name: `Unbekannt #${studentId}`,
          glider: '-',
          color: '-',
          totalFlights: 0,
        };

        const student = knownStudent ?? fallbackStudent;
        const startLeaderCount = dayFlights.filter((flight) => flight.details?.startLeiter === student.name).length;

        return {
          student,
          flights: studentFlights.sort((a, b) => a.startTime.localeCompare(b.startTime)),
          startLeaderCount,
        };
      })
      .sort((a, b) => a.student.name.localeCompare(b.student.name));

    const dayLabel = dateFormatter.format(new Date(`${dayKey}T00:00:00`));

    return {
      dayLabel,
      studentGroups,
    };
  });

  const doc = new jsPDF();

  const marginLeft = 12;
  const marginRight = 12;
  const maxTextWidth = doc.internal.pageSize.getWidth() - marginLeft - marginRight;
  const tableWidth = maxTextWidth;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 14;
  const tableHeaderHeight = 6;
  const tableRowHeight = 5.5;
  const studentRowHeight = 6;

  let y = 16;

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight <= pageHeight - bottomMargin) return;
    doc.addPage();
    y = 16;
  };

  const writeText = (text: string, x: number, options?: { bold?: boolean; size?: number; lineGap?: number; maxWidth?: number }) => {
    const fontSize = options?.size ?? 11;
    const lineGap = options?.lineGap ?? 5;
    const splitRaw = doc.splitTextToSize(text, options?.maxWidth ?? maxTextWidth) as string | string[];
    const split = Array.isArray(splitRaw) ? splitRaw : [splitRaw];
    const lineCount = split.length;
    const blockHeight = lineCount * lineGap;

    ensureSpace(blockHeight);
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
    doc.text(split, x, y);
    y += blockHeight;
  };

  const drawTableHeader = (columns: TableColumn[]) => {
    ensureSpace(tableHeaderHeight);
    let x = marginLeft;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);

    columns.forEach((column) => {
      doc.setFillColor(236, 239, 241);
      doc.rect(x, y, column.width, tableHeaderHeight, 'F');
      doc.rect(x, y, column.width, tableHeaderHeight, 'S');
      const text = fitCellText(doc, column.label, column.width - 2);
      doc.text(text, x + 1, y + 3.9);
      x += column.width;
    });

    y += tableHeaderHeight;
  };

  const drawFlightRow = (columns: TableColumn[], values: Record<string, string>) => {
    ensureSpace(tableRowHeight);
    let x = marginLeft;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);

    columns.forEach((column) => {
      doc.rect(x, y, column.width, tableRowHeight, 'S');
      const text = fitCellText(doc, values[column.key] ?? '-', column.width - 2);
      doc.text(text, x + 1, y + 3.7);
      x += column.width;
    });

    y += tableRowHeight;
  };

  const drawStudentRow = (label: string) => {
    ensureSpace(studentRowHeight);
    doc.setFillColor(248, 250, 252);
    doc.rect(marginLeft, y, tableWidth, studentRowHeight, 'F');
    doc.rect(marginLeft, y, tableWidth, studentRowHeight, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(fitCellText(doc, label, tableWidth - 2), marginLeft + 1, y + 4.1);
    y += studentRowHeight;
  };

  writeText(`Kursbericht | ${course.name}`, marginLeft, { bold: true, size: 18, lineGap: 7, maxWidth: maxTextWidth });
  writeText(
    `${course.courseType} | ${dateFormatter.format(new Date(course.startDate))} - ${dateFormatter.format(new Date(course.endDate))}`,
    marginLeft,
    { size: 11, lineGap: 5, maxWidth: maxTextWidth },
  );
  writeText(`Erstellt am: ${new Date().toLocaleString()}`, marginLeft, { size: 9, lineGap: 4, maxWidth: maxTextWidth });
  y += 4;

  if (!dayGroups.length) {
    writeText('Keine aufgezeichneten Flüge für diesen Kurs.', marginLeft, { size: 11, lineGap: 5, maxWidth: maxTextWidth });
  }

  dayGroups.forEach((dayGroup) => {
    const dayTitle = `Kurstag ${dayGroup.dayLabel}`;
    const columns = getTableColumns(course.courseType);
    const printDayHeader = (continuation = false) => {
      ensureSpace(14);
      writeText(continuation ? `${dayTitle} (Fortsetzung)` : dayTitle, marginLeft, {
        bold: true,
        size: 13,
        lineGap: 6,
        maxWidth: maxTextWidth,
      });
      drawTableHeader(columns);
    };

    printDayHeader();

    dayGroup.studentGroups.forEach((studentGroup) => {
      const studentSummaryBase = `${studentGroup.student.name} (${studentGroup.flights.length} ${studentGroup.flights.length === 1 ? 'Flug' : 'Flüge'})`;
      const studentSummary = course.courseType === 'Windenkurs'
        ? `${studentSummaryBase} | Startleitertätigkeiten: ${studentGroup.startLeaderCount}`
        : studentSummaryBase;

      if (y + studentRowHeight + tableRowHeight > pageHeight - bottomMargin) {
        doc.addPage();
        y = 16;
        printDayHeader(true);
      }
      drawStudentRow(studentSummary);

      studentGroup.flights.forEach((flight, index) => {
        if (y + tableRowHeight > pageHeight - bottomMargin) {
          doc.addPage();
          y = 16;
          printDayHeader(true);
          drawStudentRow(studentSummary);
        }

        const values = getFlightCellValue(flight, index + 1, course.courseType, timeFormatter);
        drawFlightRow(columns, values);
      });
    });

    y += 3;
  });

  doc.save(`Kursbericht_${course.name.replaceAll(' ', '_')}.pdf`);
};
