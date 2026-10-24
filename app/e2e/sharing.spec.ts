import {
  addStudent, assertCompleted, assertTotals, chooseManeuver, createCourse, expect, longPress,
  openEvaluation, openRemarks, saveRemarks, setRating, setTime, shareCourse,
  startFlight, studentRow, test,
} from './fixtures';

test('shares a flight between start and landing teachers including maneuvers, ratings and later edits', async ({ teachers: { start, landing } }) => {
  const pages = [start, landing];
  await test.step('Create and share a real course', async () => {
    await createCourse(start, 'Geteilter Höhenkurs');
    await addStudent(start, 'Anna');
    await addStudent(start, 'Ben');
    await shareCourse(start, landing);
  });
  await test.step('Start with prescribed maneuvers and rate from the start site', async () => {
    await startFlight(start);
    await expect(landing.getByRole('button', { name: 'Mark landing: Anna' })).toBeVisible();
    await expect(studentRow(landing)).toContainText('Acht');
    await setTime(pages, 60_000);
    const remarks = await openRemarks(start);
    await setRating(remarks, 'Start', 8);
    await setRating(remarks, 'Acht', 7);
    await saveRemarks(remarks);
    await expect(studentRow(landing)).toContainText('Acht (7/10)');
  });
  await test.step('Add maneuvers and ratings from the landing site', async () => {
    await setTime(pages, 2 * 60_000);
    const remarks = await openRemarks(landing);
    await expect(remarks.getByRole('slider', { name: 'Rating: Takeoff', exact: true })).toHaveAttribute('aria-valuenow', '8');
    await chooseManeuver(landing, remarks, 'Rollen');
    await setRating(remarks, 'Rollen', 6);
    await setRating(remarks, 'Landung', 9);
    await remarks.getByRole('textbox', { name: 'Flight remarks', exact: true }).fill('Sauber gelandet');
    await saveRemarks(remarks);
    await expect(studentRow(start)).toContainText('Rollen (6/10)');
  });
  await test.step('Land after fifteen virtual minutes and finalize manually', async () => {
    await setTime(pages, 15 * 60_000);
    await landing.getByRole('button', { name: 'Mark landing: Anna' }).click();
    for (const page of pages) {
      await expect(page.getByRole('button', { name: 'Finalize flight: Anna' })).toBeVisible();
      await assertTotals(page, 0, 0);
      await expect(studentRow(page)).toContainText('0:15');
    }
    await setTime(pages, 16 * 60_000);
    await landing.getByRole('button', { name: 'Finalize flight: Anna' }).click();
    for (const page of pages) await assertCompleted(page);
  });
  await test.step('Edit the finished flight without changing totals', async () => {
    await openEvaluation(landing);
    await longPress(landing, landing.getByText(/Flug #1:/));
    const edit = landing.getByRole('dialog', { name: /Flug bearbeiten/ });
    await chooseManeuver(landing, edit, 'Nicken');
    await setRating(edit, 'Nicken', 5);
    await edit.getByRole('button', { name: 'Save flight' }).click();
    await expect(edit).not.toBeVisible();
    const remarks = await openRemarks(start);
    await expect(remarks.getByRole('slider', { name: 'Rating: Nicken', exact: true })).toHaveAttribute('aria-valuenow', '5');
    await remarks.getByRole('button', { name: 'Close', exact: true }).click();
  });
  await test.step('Reload both devices and check complete persisted results', async () => {
    for (const page of pages) {
      await page.reload();
      if (page === start) await openEvaluation(page);
      else await page.getByRole('button', { name: 'Anna (1 Flug / 850 hm)', exact: true }).click();
      await expect(page.getByText(/Flug #1:/)).toContainText('0:15');
      await expect(page.getByText(/Flug #2:/)).toHaveCount(0);
      await expect(page.getByText('Start (8/10), Acht (7/10), Rollen (6/10), Nicken (5/10), Landung (9/10)', { exact: true })).toBeVisible();
      await expect(page.getByText('Startplatz: Berg / Startlehrer', { exact: true })).toBeVisible();
      await expect(page.getByText('Landeplatz: Tal / Landelehrer', { exact: true })).toBeVisible();
      await expect(page.getByText('Höhendifferenz: 850 m', { exact: true })).toBeVisible();
      await expect(page.getByText('Sauber gelandet', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ben (0 Flüge / 0 hm)', exact: true })).toBeVisible();
    }
  });
});

test('automatically finalizes at five virtual minutes and never counts twice', async ({ teachers: { start, landing } }) => {
  const pages = [start, landing];
  await createCourse(start, 'Automatischer Abschluss');
  await addStudent(start, 'Anna');
  await addStudent(start, 'Ben');
  await shareCourse(start, landing);
  await startFlight(start);
  await expect(landing.getByRole('button', { name: 'Mark landing: Anna' })).toBeVisible();
  await setTime(pages, 15 * 60_000);
  await landing.getByRole('button', { name: 'Mark landing: Anna' }).click();
  for (const page of pages) await expect(page.getByRole('button', { name: 'Finalize flight: Anna' })).toBeVisible();
  await setTime(pages, 20 * 60_000 - 1);
  for (const page of pages) {
    await page.clock.fastForward(1_000);
    await expect(page.getByRole('button', { name: 'Finalize flight: Anna' })).toBeVisible();
    await assertTotals(page, 0, 0);
  }
  await setTime(pages, 20 * 60_000);
  await landing.clock.fastForward(1_000);
  for (const page of pages) await assertCompleted(page);
  await setTime(pages, 30 * 60_000);
  for (const page of pages) {
    await page.clock.fastForward(1_000);
    await page.reload();
    await assertCompleted(page);
    await openEvaluation(page);
    await expect(page.getByText(/Flug #1:/)).toContainText('0:15');
    await expect(page.getByText(/Flug #2:/)).toHaveCount(0);
  }
});
