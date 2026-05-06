import jsPDF from 'jspdf';
import { db } from '../db/database';

export const generatePDF = async (courseId: number) => {
  const course = await db.courses.get(courseId);
  if (!course) return;

  const flights = await db.flights.where('courseId').equals(courseId).toArray();

  const doc = new jsPDF();
  doc.text(`Kurs: ${course.name}`, 10, 10);
  doc.text(`Datum: ${course.startDate} - ${course.endDate}`, 10, 20);

  let y = 40;
  course.students.forEach(student => {
    doc.text(`Schüler: ${student.name} (${student.glider}, ${student.color})`, 10, y);
    y += 10;
    const studentFlights = flights.filter(f => f.studentId === student.id);
    studentFlights.forEach(flight => {
      doc.text(`Flug: ${flight.startTime} - ${flight.endTime || 'laufend'}`, 20, y);
      doc.text(`Manöver: ${flight.maneuvers.join(', ')}`, 20, y + 5);
      y += 15;
    });
    y += 10;
  });

  doc.save(`${course.name}-bericht.pdf`);
};