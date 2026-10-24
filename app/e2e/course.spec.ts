import { addStudent, createCourse, expect, longPress, studentRow, test } from './fixtures';

test('creates and edits a course and students, preserving changes after reload', async ({ teachers: { start } }) => {
  await createCourse(start, 'Lokaler Kurs');
  await addStudent(start, 'Anna');
  await addStudent(start, 'Ben');
  await longPress(start, start.getByRole('heading', { name: 'Lokaler Kurs', exact: true }));
  const course = start.getByRole('dialog', { name: 'Kurs bearbeiten', exact: true });
  await course.getByLabel('Course name', { exact: true }).fill('Bearbeiteter Kurs');
  await course.getByRole('button', { name: 'Save course' }).click();
  await expect(course).not.toBeVisible();
  await longPress(start, studentRow(start).getByText('Anna (0+0)', { exact: true }));
  const student = start.getByRole('dialog', { name: 'Schüler bearbeiten', exact: true });
  await student.getByRole('textbox', { name: 'Glider', exact: true }).fill('Epsilon');
  await student.getByRole('button', { name: 'Save student' }).click();
  await expect(student).not.toBeVisible();
  await start.reload();
  await expect(start.getByRole('heading', { name: 'Bearbeiteter Kurs', exact: true })).toBeVisible();
  await expect(studentRow(start)).toContainText('Epsilon');
  await expect(studentRow(start, 'Ben')).toContainText('Alpha');
});
