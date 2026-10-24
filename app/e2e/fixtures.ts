import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const epoch = Date.parse('2026-01-01T10:00:00.000Z');

type Teachers = { start: Page; landing: Page };

export const test = base.extend<{ teachers: Teachers }>({
  teachers: async ({ browser, baseURL }, provideTeachers) => {
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    const createTeacher = async (name: string) => {
      const context = await browser.newContext({
        baseURL, locale: 'de-DE', timezoneId: 'Europe/Berlin',
        serviceWorkers: 'block',
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.install({ time: epoch });
      await page.clock.setFixedTime(epoch);
      await page.goto('./');
      await page.getByRole('button', { name: 'Open settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Einstellungen', exact: true });
      await settings.getByRole('textbox', { name: 'Username', exact: true }).fill(name);
      await settings.getByRole('button', { name: 'Save settings' }).click();
      await expect(settings).not.toBeVisible();
      return page;
    };
    try {
      const start = await createTeacher('Startlehrer');
      const landing = await createTeacher('Landelehrer');
      await provideTeachers({ start, landing });
      expect(errors, 'uncaught browser errors').toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

export { expect };

export const setTime = async (pages: Page[], offsetMs: number) => {
  await Promise.all(pages.map((page) => page.clock.setFixedTime(epoch + offsetMs)));
};

export const studentRow = (page: Page, name = 'Anna') => page.getByRole('listitem').filter({ hasText: `${name} (` });

export const longPress = async (page: Page, locator: Locator) => {
  await locator.hover();
  await page.mouse.down();
  await page.clock.fastForward(600);
  await page.mouse.up();
};

export const createCourse = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Kurs erstellen', exact: true });
  await dialog.getByLabel('Flight school', { exact: true }).fill('Testschule');
  await dialog.getByLabel('Course name', { exact: true }).fill(name);
  await dialog.getByLabel('Course type', { exact: true }).click();
  await page.getByText('Höhenkurs', { exact: true }).click();
  await dialog.getByLabel('Course start date', { exact: true }).fill('2026-01-01');
  await dialog.getByLabel('Course end date', { exact: true }).fill('2026-01-02');
  await dialog.getByRole('button', { name: 'Save course' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('heading', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add student', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('Höhenkurs', { exact: true }).filter({ visible: true })).toBeVisible();
};

export const addStudent = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Add student', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Schüler hinzufügen', exact: true });
  await dialog.getByRole('combobox', { name: 'Select student' }).click();
  await page.getByText('Neuer Schüler', { exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Student name', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: 'Glider', exact: true }).fill('Alpha');
  await dialog.getByRole('textbox', { name: 'Color', exact: true }).fill('Blau');
  await dialog.getByRole('button', { name: 'Save student' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(studentRow(page, name)).toBeVisible();
};

export const shareCourse = async (start: Page, landing: Page) => {
  await start.getByRole('button', { name: 'Share course', exact: true }).click();
  const share = start.getByRole('dialog', { name: 'Share-QR-Code' });
  const link = await share.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  expect(new URL(link).origin).toBe('http://127.0.0.1:4173');
  await share.getByRole('button', { name: 'Close', exact: true }).click();
  await landing.goto(link);
  const join = landing.getByRole('dialog', { name: 'Kurs erstellen', exact: true });
  await expect(join.getByText('Shared-Kurs geladen', { exact: true })).toBeVisible();
  await join.getByRole('button', { name: 'Save course' }).click();
  await expect(join).not.toBeVisible();
  await landing.getByRole('main').getByRole('heading', { level: 3 }).click();
  await expect(studentRow(landing, 'Anna')).toBeVisible();
  await expect(studentRow(landing, 'Ben')).toBeVisible();
};

export const chooseManeuver = async (page: Page, dialog: Locator, maneuver: string) => {
  await dialog.getByRole('button', { name: 'Select maneuvers', exact: true }).click();
  await page.getByRole('checkbox', { name: new RegExp(`^${maneuver}(?: \\(|$)`) }).check();
  await dialog.getByRole('button', { name: 'Select maneuvers', exact: true }).click();
};

export const startFlight = async (page: Page) => {
  await page.getByRole('button', { name: 'Start flight: Anna', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Flug starten: Anna', exact: true });
  for (const [label, value] of [
    ['Takeoff site', 'Berg'], ['Takeoff teacher', 'Startlehrer'],
    ['Landing site', 'Tal'], ['Landing teacher', 'Landelehrer'],
  ]) await dialog.getByRole('combobox', { name: label, exact: true }).fill(value);
  await dialog.getByRole('spinbutton', { name: 'Altitude difference (m)', exact: true }).fill('850');
  await chooseManeuver(page, dialog, 'Acht');
  await dialog.getByRole('button', { name: 'Start flight', exact: true }).click();
  await expect(dialog).not.toBeVisible();
};

export const setRating = async (dialog: Locator, key: string, value: number) => {
  const slider = dialog.getByRole('slider', { name: `Rating: ${key === 'Start' ? 'Takeoff' : key === 'Landung' ? 'Landing' : key}`, exact: true });
  await slider.focus();
  await slider.press('Home');
  for (let i = 0; i < value; i++) await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', String(value));
};

export const openRemarks = async (page: Page) => {
  await studentRow(page).dblclick();
  const dialog = page.getByRole('dialog', { name: /^Bemerkung(?:: Anna)?$/ });
  await expect(dialog).toBeVisible();
  return dialog;
};

export const saveRemarks = async (dialog: Locator) => {
  await dialog.getByRole('button', { name: 'Save remarks and ratings' }).click();
  await expect(dialog).not.toBeVisible();
};

export const openEvaluation = async (page: Page) => {
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('button', { name: 'Anna (1 Flug / 850 hm)', exact: true }).click();
};

export const readRecords = async (page: Page, table: 'students' | 'courses' | 'flights') => (
  page.evaluate((tableName) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('DigiKladdeDB');
    open.onerror = () => reject(new Error('Could not open test database', { cause: open.error }));
    open.onblocked = () => reject(new Error('Opening test database was blocked'));
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(tableName, 'readonly');
      const request = transaction.objectStore(tableName).getAll();
      let records: unknown;
      request.onsuccess = () => { records = request.result; };
      transaction.oncomplete = () => {
        database.close();
        resolve(records);
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error('Could not read test records', { cause: transaction.error }));
      };
    };
  }), table)
);

export const assertTotals = async (page: Page, totalFlights: number, totalAltitudeMeters: number) => {
  const students = [
    expect.objectContaining({ name: 'Anna', totalFlights, totalAltitudeMeters }),
    expect.objectContaining({ name: 'Ben', totalFlights: 0, totalAltitudeMeters: 0 }),
  ];
  await expect.poll(() => readRecords(page, 'students')).toEqual(expect.arrayContaining(students));
  await expect.poll(() => readRecords(page, 'courses')).toEqual(expect.arrayContaining([
    expect.objectContaining({ students: expect.arrayContaining(students) }),
  ]));
};

export const assertCompleted = async (page: Page) => {
  await expect(studentRow(page)).toContainText('Anna (0+1)');
  await expect(studentRow(page, 'Ben')).toContainText('Ben (0+0)');
  await expect(page.getByRole('button', { name: 'Mark landing: Anna' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finalize flight: Anna' })).toHaveCount(0);
  await assertTotals(page, 1, 850);
  await expect.poll(() => readRecords(page, 'flights')).toEqual([
    expect.objectContaining({
      startTime: new Date(epoch).toISOString(),
      endTime: new Date(epoch + 15 * 60_000).toISOString(),
    }),
  ]);
};
