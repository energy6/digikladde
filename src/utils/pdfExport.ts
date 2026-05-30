import jsPDFDefault, { jsPDF as jsPDFNamed } from 'jspdf';
import type { Course, CourseType, Flight, Student } from '../models/types';
import { durationFormatter } from './DatetimeFormatter';
import { UNKNOWN_FLIGHT_SCHOOL } from './flightSchool';

type JsPDFInstance = InstanceType<typeof jsPDFNamed>;

const JsPDFCtor = jsPDFNamed ?? (jsPDFDefault as unknown as typeof jsPDFNamed);

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

type StudentCourseStats = {
  name: string;
  flights: number;
  totalFlightsAfterCourse: number;
  totalFlightMinutes: number;
  maneuvers: string;
};

type GenerateCoursePDFOptions = {
  createdAt?: Date;
  appVersion?: string;
  locale?: string;
};

const createDateFormatter = (locale?: string) => new Intl.DateTimeFormat(locale, {
  dateStyle: 'medium',
});

const createTimeFormatter = (locale?: string) => new Intl.DateTimeFormat(locale, {
  timeStyle: 'short',
});

const pad2 = (value: number) => String(value).padStart(2, '0');

const toLocalDayKey = (isoDate: string) => {
  const date = new Date(isoDate);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const getTableColumns = (courseType: CourseType): TableColumn[] => {
  if (courseType === 'Grundkurs') {
    return [
      { key: 'no', label: '#', width: 8 },
      { key: 'startTime', label: 'Start', width: 14 },
      { key: 'landingTime', label: 'Landung', width: 14 },
      { key: 'duration', label: 'Dauer', width: 12 },
      { key: 'terrainTeacher', label: 'Gelände / Lehrer', width: 138 },
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

const fitCellText = (doc: JsPDFInstance, text: string, maxWidth: number) => {
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
    duration: durationFormatter(startDate.getTime(), endDate ? endDate.getTime() : undefined),
    maneuvers: flight.maneuvers.length ? flight.maneuvers.join(', ') : '-',
    terrainTeacher: `${terrain} / ${teacher}`,
    startLeader: flight.details?.startLeiter ?? '-',
    startInfo: `${startPlace} / ${startTeacher}`,
    landInfo: `${landPlace} / ${landTeacher}`,
  };

  if (courseType === 'Grundkurs') {
    values.startInfo = '-';
    values.landInfo = '-';
    values.maneuvers = '-';
  }

  if (courseType === 'Windenkurs') {
    values.startInfo = '-';
    values.landInfo = '-';
  }

  return values;
};

const buildDayGroups = (course: Course, flights: Flight[], locale?: string): DayGroup[] => {
  const dateFormatter = createDateFormatter(locale);
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
          flightSchool: UNKNOWN_FLIGHT_SCHOOL,
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

  return dayGroups;
};

const resolveAppVersion = (appVersion?: string) => {
  if (appVersion) return appVersion;
  if (typeof __APP_VERSION__ !== 'undefined') return __APP_VERSION__;
  return 'dev';
};

const formatTotalMinutes = (totalMinutes: number) => {
  const safeMinutes = Number.isFinite(totalMinutes) && totalMinutes > 0 ? Math.floor(totalMinutes) : 0;
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}:${pad2(minutes)}`;
};

export const createCoursePDFDoc = (
  course: Course,
  flights: Flight[],
  options?: GenerateCoursePDFOptions,
) => {
  const dayGroups = buildDayGroups(course, flights, options?.locale);
  const createdAt = options?.createdAt ?? new Date();
  const appVersion = resolveAppVersion(options?.appVersion);
  const dateFormatter = createDateFormatter(options?.locale);
  const timeFormatter = createTimeFormatter(options?.locale);

  const courseStudentsById = new Map<number, Student>(
    course.students
      .filter((student): student is Student & { id: number } => student.id !== undefined)
      .map((student) => [student.id, student]),
  );

  const flightsByStudentId = new Map<number, Flight[]>();
  flights.forEach((flight) => {
    const current = flightsByStudentId.get(flight.studentId) ?? [];
    current.push(flight);
    flightsByStudentId.set(flight.studentId, current);
  });

  const knownStudentIds = new Set<number>();
  const courseStatsRows: StudentCourseStats[] = course.students.map((student) => {
    const studentFlights = student.id !== undefined ? (flightsByStudentId.get(student.id) ?? []) : [];
    if (student.id !== undefined) knownStudentIds.add(student.id);

    const totalFlightMinutes = studentFlights.reduce((sum, flight) => {
      if (!flight.endTime) return sum;
      const diffMinutes = Math.floor((new Date(flight.endTime).getTime() - new Date(flight.startTime).getTime()) / 60000);
      return diffMinutes > 0 ? sum + diffMinutes : sum;
    }, 0);

    const maneuverSet = new Set<string>();
    studentFlights.forEach((flight) => {
      flight.maneuvers.forEach((maneuver) => {
        maneuverSet.add(maneuver);
      });
    });

    return {
      name: student.name,
      flights: studentFlights.length,
      totalFlightsAfterCourse: student.totalFlights,
      totalFlightMinutes,
      maneuvers: maneuverSet.size ? Array.from(maneuverSet).join(', ') : '-',
    };
  });

  flightsByStudentId.forEach((studentFlights, studentId) => {
    if (knownStudentIds.has(studentId)) return;

    const knownStudent = courseStudentsById.get(studentId);
    const totalFlightMinutes = studentFlights.reduce((sum, flight) => {
      if (!flight.endTime) return sum;
      const diffMinutes = Math.floor((new Date(flight.endTime).getTime() - new Date(flight.startTime).getTime()) / 60000);
      return diffMinutes > 0 ? sum + diffMinutes : sum;
    }, 0);

    const maneuverSet = new Set<string>();
    studentFlights.forEach((flight) => {
      flight.maneuvers.forEach((maneuver) => {
        maneuverSet.add(maneuver);
      });
    });

    courseStatsRows.push({
      name: knownStudent?.name ?? `Unbekannt #${studentId}`,
      flights: studentFlights.length,
      totalFlightsAfterCourse: knownStudent?.totalFlights ?? studentFlights.length,
      totalFlightMinutes,
      maneuvers: maneuverSet.size ? Array.from(maneuverSet).join(', ') : '-',
    });
  });

  courseStatsRows.sort((a, b) => a.name.localeCompare(b.name));

  const totalFlightDays = dayGroups.length;
  const totalStudents = courseStatsRows.length;
  const totalFlights = flights.length;

  const doc = new JsPDFCtor();

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

  const courseStatsColumns: TableColumn[] = [
    { key: 'name', label: 'Name', width: 62 },
    { key: 'flights', label: 'Flüge', width: 18 },
    { key: 'flightTime', label: 'Flugzeit', width: 24 },
    { key: 'maneuvers', label: 'Manöver', width: 82 },
  ];

  const drawCourseStatsHeader = () => {
    ensureSpace(tableHeaderHeight);
    let x = marginLeft;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);

    courseStatsColumns.forEach((column) => {
      doc.setFillColor(236, 239, 241);
      doc.rect(x, y, column.width, tableHeaderHeight, 'F');
      doc.rect(x, y, column.width, tableHeaderHeight, 'S');
      const text = fitCellText(doc, column.label, column.width - 2);
      doc.text(text, x + 1, y + 3.9);
      x += column.width;
    });

    y += tableHeaderHeight;
  };

  const getCourseStatsRowMeta = (row: StudentCourseStats) => {
    const flightsText = `+${row.flights} (${row.totalFlightsAfterCourse})`;
    const rowValues: Record<string, string> = {
      name: row.name,
      flights: flightsText,
      flightTime: formatTotalMinutes(row.totalFlightMinutes),
      maneuvers: row.maneuvers,
    };

    const maneuversColumn = courseStatsColumns.find((column) => column.key === 'maneuvers');
    const maxManeuverWidth = (maneuversColumn?.width ?? 80) - 2;
    const splitRaw = doc.splitTextToSize(rowValues.maneuvers, maxManeuverWidth) as string | string[];
    const maneuverLines = Array.isArray(splitRaw) ? splitRaw : [splitRaw];
    const maneuverLineHeight = 3.2;
    const rowHeight = Math.max(tableRowHeight, maneuverLines.length * maneuverLineHeight + 2.2);

    return {
      rowValues,
      maneuverLines,
      maneuverLineHeight,
      rowHeight,
    };
  };

  const drawCourseStatsRow = (row: StudentCourseStats) => {
    const rowMeta = getCourseStatsRowMeta(row);
    ensureSpace(rowMeta.rowHeight);
    let x = marginLeft;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);

    courseStatsColumns.forEach((column) => {
      doc.rect(x, y, column.width, rowMeta.rowHeight, 'S');

      if (column.key === 'maneuvers') {
        doc.text(rowMeta.maneuverLines, x + 1, y + 3.4);
      } else {
        const text = fitCellText(doc, rowMeta.rowValues[column.key] ?? '-', column.width - 2);
        doc.text(text, x + 1, y + 3.7);
      }

      x += column.width;
    });

    y += rowMeta.rowHeight;
  };

  writeText(`Kursbericht | ${course.name}`, marginLeft, { bold: true, size: 18, lineGap: 7, maxWidth: maxTextWidth });
  writeText(
    `${course.flightSchool} | ${course.courseType} | ${dateFormatter.format(new Date(course.startDate))} - ${dateFormatter.format(new Date(course.endDate))}`,
    marginLeft,
    { size: 11, lineGap: 5, maxWidth: maxTextWidth },
  );
  y += 4;

  if (!dayGroups.length) {
    writeText('Keine aufgezeichneten Flüge für diesen Kurs.', marginLeft, { size: 11, lineGap: 5, maxWidth: maxTextWidth });
  }

  dayGroups.forEach((dayGroup) => {
    const dayTitle = `Kurstag ${dayGroup.dayLabel}`;
    const dayStudentCount = dayGroup.studentGroups.length;
    const dayFlightCount = dayGroup.studentGroups.reduce((sum, group) => sum + group.flights.length, 0);
    const dayStats = `${dayStudentCount} Schüler | ${dayFlightCount} ${dayFlightCount === 1 ? 'Flug' : 'Flüge'}`;
    const columns = getTableColumns(course.courseType);
    const printDayHeader = (continuation = false) => {
      ensureSpace(26);
      if (y === 16) y += 8;
      writeText(continuation ? `${dayTitle} (Fortsetzung)` : dayTitle, marginLeft, {
        bold: true,
        size: 13,
        lineGap: 5,
        maxWidth: maxTextWidth,
      });
      if (!continuation) {
        writeText(dayStats, marginLeft, {
          size: 9,
          lineGap: 4,
          maxWidth: maxTextWidth,
        });
      }
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

    y += 16;
  });

  const summaryLine = `${totalFlightDays} ${totalFlightDays === 1 ? 'Flugtag' : 'Flugtage'} | ${totalStudents} ${totalStudents === 1 ? 'Schüler' : 'Schüler'} | ${totalFlights} ${totalFlights === 1 ? 'Flug' : 'Flüge'}`;
  const printCourseSummaryHeader = (continuation = false) => {
    ensureSpace(24);
    if (y === 16) y += 8;
    writeText(continuation ? 'Zusammenfassung (Fortsetzung)' : 'Zusammenfassung', marginLeft, {
      bold: true,
      size: 13,
      lineGap: 5,
      maxWidth: maxTextWidth,
    });
    if (!continuation) {
      writeText(summaryLine, marginLeft, {
        size: 10,
        lineGap: 4,
        maxWidth: maxTextWidth,
      });
    }
    drawCourseStatsHeader();
  };

  if (dayGroups.length) {
    y += 4;
  }
  printCourseSummaryHeader();

  courseStatsRows.forEach((row) => {
    const rowMeta = getCourseStatsRowMeta(row);
    if (y + rowMeta.rowHeight > pageHeight - bottomMargin) {
      doc.addPage();
      y = 16;
      printCourseSummaryHeader(true);
    }
    drawCourseStatsRow(row);
  });

  const footerText = `Erstellt am: ${createdAt.toLocaleString(options?.locale, { dateStyle: 'medium', timeStyle: 'short' })} · mit DigiKladde v${appVersion}`;
  const totalPages = doc.getNumberOfPages();
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    doc.setPage(pageIndex);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(
      footerText,
      marginLeft,
      pageHeight - 5,
    );
    doc.text(
      `${pageIndex} / ${totalPages}`,
      doc.internal.pageSize.getWidth() - marginRight,
      pageHeight - 5,
      { align: 'right' },
    );
    doc.setTextColor(0, 0, 0);
  }

  return doc;
};

export const createCoursePDFArrayBuffer = (
  course: Course,
  flights: Flight[],
  options?: GenerateCoursePDFOptions,
) => {
  const doc = createCoursePDFDoc(course, flights, options);
  return doc.output('arraybuffer');
};

export const generatePDF = async (courseId: number) => {
  const { db } = await import('../db/database');
  const course = await db.courses.get(courseId);
  if (!course) return;

  const flights = await db.flights.where('courseId').equals(courseId).toArray();
  const doc = createCoursePDFDoc(course, flights);

  doc.save(`Kursbericht_${course.name.replaceAll(' ', '_')}.pdf`);
};
