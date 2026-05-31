/* global window, document */

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../../');

const baseUrl = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:4173';
const screenshotsDir = join(rootDir, 'docs', 'screenshots');
const mediaDir = join(rootDir, 'docs', 'media');
const captureViewport = { width: 390, height: 720 };

const ensureBaseUrlReachable = async (url) => {
  const timeout = 5000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Retry briefly until timeout to allow freshly started preview servers.
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `Capture-Base-URL nicht erreichbar: ${url}. Starte vorher z.B. \"npm run -w app preview -- --host --port 4173\" `
    + 'oder setze CAPTURE_BASE_URL auf eine laufende App-URL.'
  );
};

mkdirSync(screenshotsDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: captureViewport,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: false,
  recordVideo: {
    dir: mediaDir,
    size: captureViewport,
  },
});

await context.addInitScript(() => {
  const RealDate = Date;
  let captureOffsetMs = 0;

  function MockDate(...args) {
    if (args.length === 0) {
      return new RealDate(RealDate.now() + captureOffsetMs);
    }
    return new RealDate(...args);
  }

  MockDate.now = () => RealDate.now() + captureOffsetMs;
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  MockDate.prototype = RealDate.prototype;

  // Keep Date API compatible while allowing controlled time jumps during capture.
  // eslint-disable-next-line no-global-assign
  Date = MockDate;

  window.__captureAdvanceTime = (ms) => {
    captureOffsetMs += Number(ms) || 0;
    return captureOffsetMs;
  };
});

const page = await context.newPage();
page.setDefaultTimeout(15000);

const step = (label) => {
  console.log(`STEP: ${label}`);
};

const pace = async (ms = 550) => {
  await page.waitForTimeout(ms);
};

const waitUi = async () => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(450);
};

const shot = async (name) => {
  await page.screenshot({ path: join(screenshotsDir, name), fullPage: false });
};

const installInteractionOverlay = async () => {
  await page.evaluate(() => {
    if (document.getElementById('capture-interaction-style')) return;

    const style = document.createElement('style');
    style.id = 'capture-interaction-style';
    style.textContent = `
      * {
        cursor: default !important;
      }
      .capture-tap-ring {
        position: fixed;
        width: 28px;
        height: 28px;
        margin-left: -14px;
        margin-top: -14px;
        border: 3px solid #ff4d4f;
        border-radius: 9999px;
        pointer-events: none;
        z-index: 2147483647;
        animation: captureTapPulse 520ms ease-out forwards;
      }
      @keyframes captureTapPulse {
        0% { transform: scale(0.6); opacity: 0.95; }
        100% { transform: scale(1.7); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  });
};

const showTapRing = async (x, y) => {
  await page.evaluate(({ px, py }) => {
    const ring = document.createElement('div');
    ring.className = 'capture-tap-ring';
    ring.style.left = `${px}px`;
    ring.style.top = `${py}px`;
    document.body.appendChild(ring);
    window.setTimeout(() => ring.remove(), 600);
  }, { px: x, py: y });
};

const tap = async (locator, options = {}) => {
  const { double = false } = options;
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await page.mouse.move(x, y, { steps: 16 });
    await showTapRing(x, y);

    if (double) {
      await page.mouse.dblclick(x, y, { delay: 140 });
    } else {
      await page.mouse.click(x, y, { delay: 140 });
    }
  } else if (double) {
    await locator.dblclick();
  } else {
    await locator.click();
  }

  await pace();
};

const setChecked = async (locator, value) => {
  const isChecked = await locator.isChecked();
  if (isChecked === value) return;
  await tap(locator);
};

const advanceVirtualTime = async (ms) => {
  await page.evaluate((deltaMs) => {
    if (typeof window.__captureAdvanceTime === 'function') {
      window.__captureAdvanceTime(deltaMs);
    }
  }, ms);
};

const timelapseAdvance = async ({ totalMs, durationMs, steps, label }) => {
  step(label);
  const msPerStep = Math.floor(totalMs / steps);
  const waitPerStep = Math.floor(durationMs / steps);

  for (let index = 0; index < steps; index += 1) {
    await advanceVirtualTime(msPerStep);
    await page.waitForTimeout(waitPerStep);
  }
};

const closeOfflineBannerIfVisible = async () => {
  const offlineVisible = await page.getByText('Offline bereit', { exact: true }).isVisible().catch(() => false);
  const updateVisible = await page.getByText('Update verfügbar', { exact: true }).isVisible().catch(() => false);
  if (!offlineVisible && !updateVisible) return;

  const closeBtn = page.getByRole('button', { name: 'Schließen' });
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(400);
  }
};

const fillTextInputByLabel = async (labelText, value) => {
  const item = page.locator('.ant-form-item').filter({ has: page.locator(`label:has-text("${labelText}")`) }).first();
  const input = item.locator('input').first();
  await tap(input);
  await input.fill(value);
  await pace(300);
};

const addStandaloneStudent = async (student) => {
  await page.evaluate(async (record) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('DigiKladdeDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('students', 'readwrite');
        tx.objectStore('students').add(record);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, student);
};

const addStandaloneCourse = async (course) => {
  await page.evaluate(async (record) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('DigiKladdeDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('courses', 'readwrite');
        tx.objectStore('courses').add(record);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, course);
};

const setCourseType = async (courseId, courseType) => {
  await page.evaluate(async ({ id, type }) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('DigiKladdeDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('courses', 'readwrite');
        const store = tx.objectStore('courses');
        const getReq = store.get(Number(id));

        getReq.onerror = () => reject(getReq.error);
        getReq.onsuccess = () => {
          const course = getReq.result;
          if (!course) {
            reject(new Error('course not found'));
            return;
          }
          course.courseType = type;
          store.put(course);
        };

        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { id: Number(courseId), type: courseType });
};

const attachStudentToCourse = async (courseId, studentName) => {
  await page.evaluate(async ({ id, name }) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('DigiKladdeDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['courses', 'students'], 'readwrite');
        const courseStore = tx.objectStore('courses');
        const studentStore = tx.objectStore('students');

        const studentsReq = studentStore.getAll();
        studentsReq.onerror = () => reject(studentsReq.error);
        studentsReq.onsuccess = () => {
          const student = studentsReq.result.find((entry) => entry.name === name);
          if (!student) {
            reject(new Error('student not found'));
            return;
          }

          const courseReq = courseStore.get(Number(id));
          courseReq.onerror = () => reject(courseReq.error);
          courseReq.onsuccess = () => {
            const course = courseReq.result;
            if (!course) {
              reject(new Error('course not found'));
              return;
            }

            const alreadyIncluded = (course.students ?? []).some((entry) => entry.id === student.id);
            if (!alreadyIncluded) {
              course.students = [...(course.students ?? []), student];
              courseStore.put(course);
            }
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { id: Number(courseId), name: studentName });
};

const ensureRemarkOnLatestFlight = async (studentName, remarkText) => {
  await page.evaluate(async ({ name, remark }) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('DigiKladdeDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['students', 'flights'], 'readwrite');
        const studentStore = tx.objectStore('students');
        const flightStore = tx.objectStore('flights');

        const studentsReq = studentStore.getAll();
        studentsReq.onerror = () => reject(studentsReq.error);
        studentsReq.onsuccess = () => {
          const student = studentsReq.result.find((entry) => entry.name === name);
          if (!student?.id) {
            reject(new Error('student not found'));
            return;
          }

          const flightsReq = flightStore.getAll();
          flightsReq.onerror = () => reject(flightsReq.error);
          flightsReq.onsuccess = () => {
            const latestFlight = flightsReq.result
              .filter((flight) => flight.studentId === student.id)
              .sort((a, b) => b.startTime.localeCompare(a.startTime))[0];

            if (!latestFlight || !latestFlight.id) {
              reject(new Error('latest flight not found'));
              return;
            }

            const currentRemarks = Array.isArray(latestFlight.remarks) ? latestFlight.remarks : [];
            if (!currentRemarks.includes(remark)) {
              latestFlight.remarks = [...currentRemarks, remark];
              flightStore.put(latestFlight);
            }
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { name: studentName, remark: remarkText });
};

const forceFinalizeLatestFlight = async (studentName) => {
  await page.evaluate(async ({ name }) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('DigiKladdeDB');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['students', 'flights'], 'readwrite');
        const studentStore = tx.objectStore('students');
        const flightStore = tx.objectStore('flights');

        const studentsReq = studentStore.getAll();
        studentsReq.onerror = () => reject(studentsReq.error);
        studentsReq.onsuccess = () => {
          const student = studentsReq.result.find((entry) => entry.name === name);
          if (!student?.id) {
            reject(new Error('student not found'));
            return;
          }

          const flightsReq = flightStore.getAll();
          flightsReq.onerror = () => reject(flightsReq.error);
          flightsReq.onsuccess = () => {
            const latestFlight = flightsReq.result
              .filter((flight) => flight.studentId === student.id)
              .sort((a, b) => b.startTime.localeCompare(a.startTime))[0];

            if (!latestFlight || !latestFlight.id) {
              reject(new Error('latest flight not found'));
              return;
            }

            const nowIso = new Date().toISOString();
            latestFlight.endTime = latestFlight.endTime ?? nowIso;
            latestFlight.landingFinalizedAt = nowIso;
            latestFlight.landingPendingUntil = undefined;
            latestFlight.landingMarkedAt = latestFlight.landingMarkedAt ?? nowIso;
            flightStore.put(latestFlight);
          };
        };

        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { name: studentName });
};

let courseId;
let captureSucceeded = false;

try {
  await ensureBaseUrlReachable(baseUrl);

  step('open course list and open create modal');
  await page.goto(`${baseUrl}/`);
  await installInteractionOverlay();
  await waitUi();

  await closeOfflineBannerIfVisible();

  step('add existing courses to database');
  await addStandaloneCourse({
    name: 'A-Schein April 2026',
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    courseType: 'Höhenkurs',
    flightSchool: 'Flugschule Bergwind',
    students: [],
    totalFlights: 0,
  });
  await addStandaloneCourse({
    name: 'B-Schein März 2026',
    startDate: '2026-03-15',
    endDate: '2026-03-22',
    courseType: 'Höhenkurs',
    flightSchool: 'Flugschule Bergwind',
    students: [],
    totalFlights: 0,
  });
  await page.reload();
  await waitUi();
  await pace(350);

  step('set flight school filter');
  const flightSchoolSelect = page.locator('.ant-select').first();
  await tap(flightSchoolSelect);
  const bergwindOption = page.locator('.ant-select-item-option').filter({ hasText: 'Flugschule Bergwind' }).first();
  await tap(bergwindOption);
  await pace(300);

  await tap(page.locator('button.ant-btn-primary').filter({ has: page.locator('svg[aria-label="circle-plus"], [data-icon="circle-plus"]') }).first());
  const createModal = page.locator('.ant-modal').filter({ hasText: 'Kurs erstellen' }).last();
  await createModal.waitFor({ state: 'visible' });

  step('fill course form');
  await fillTextInputByLabel('Flugschule', 'Flugschule Bergwind');
  await fillTextInputByLabel('Name', 'A-Schein Mai 2026');
  await fillTextInputByLabel('Startdatum', '2026-05-01');
  await fillTextInputByLabel('Enddatum', '2026-05-05');
  await pace(450);
  await shot('01-kurs-erstellen.png');

  step('save course and return to list');
  await tap(createModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await createModal.waitFor({ state: 'hidden' });
  await waitUi();
  await shot('02-kurs-waehlen.png');

  step('open course detail');
  await tap(page.locator('.ant-card').filter({ hasText: 'A-Schein Mai 2026' }).first());
  await page.waitForURL(/\/course\/\d+$/);
  const match = page.url().match(/\/course\/(\d+)$/);
  courseId = match ? match[1] : undefined;
  if (!courseId) throw new Error('courseId konnte nicht aus der URL ermittelt werden');

  step('open edit modal via long-press on course header');
  await waitUi();
  const headerTitle = page
    .locator('[style*="cursor: pointer"]')
    .filter({ hasText: 'A-Schein Mai 2026' })
    .first();
  await headerTitle.waitFor({ state: 'visible', timeout: 15000 });
  await headerTitle.dispatchEvent('mousedown');
  await page.waitForTimeout(600);
  await headerTitle.dispatchEvent('mouseup');
  const editCourseModal = page
    .locator('.ant-modal')
    .filter({ hasText: /Kurs bearbeiten|Kursinfos bearbeiten/ })
    .last();
  await editCourseModal.waitFor({ state: 'visible' });
  const hasKursname = await editCourseModal.getByText('Kursname', { exact: false }).first().isVisible().catch(() => false);
  await fillTextInputByLabel(hasKursname ? 'Kursname' : 'Name', 'A-Schein Mai 2026 (Update)');
  await shot('03-kursdaten-bearbeiten.png');
  step('save edited course');
  await tap(editCourseModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await editCourseModal.waitFor({ state: 'hidden' });

  step('force Höhenkurs and reload');
  await setCourseType(courseId, 'Höhenkurs');
  await page.reload();
  await waitUi();

  step('create new student via add-student modal');
  const addStudentBtn = page.locator('.ant-card').filter({ hasText: 'Schüler' }).first().locator('.ant-card-extra button.ant-btn-primary');
  await tap(addStudentBtn);
  const addStudentModal = page.locator('.ant-modal').filter({ hasText: 'Schüler hinzufügen' }).last();
  await addStudentModal.waitFor({ state: 'visible' });
  await tap(addStudentModal.getByRole('combobox').first());
  const newOption = page.locator('.ant-select-item-option').filter({ hasText: 'Neuer Schüler' }).last();
  await tap(newOption);
  await pace(300);
  await fillTextInputByLabel('Name', 'Max Muster');
  await fillTextInputByLabel('Schirm', 'Skywalk Mescal');
  await fillTextInputByLabel('Farbe', 'Blau');
  await pace(350);
  await shot('04-schueler-hinzufuegen-neu.png');
  await tap(addStudentModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await addStudentModal.waitFor({ state: 'hidden' });
  await waitUi();

  step('insert standalone student in db');
  await addStandaloneStudent({ name: 'Eva Extern', glider: 'Advance Alpha', color: 'Rot', totalFlights: 0 });
  await attachStudentToCourse(courseId, 'Eva Extern');
  await page.reload();
  await waitUi();
  await pace(350);
  await shot('04-schueler-hinzufuegen.png');

  const studentCard = page.locator('.ant-card').filter({ hasText: 'Schüler' }).first();

  step('add additional students without screenshots');
  const additionalStudents = [
    { name: 'Lisa Schmidt', glider: 'Advance Omega', color: 'Gelb' },
    { name: 'Tom Weber', glider: 'PHI Allegra', color: 'Grün' },
    { name: 'Sarah Müller', glider: 'Skywalk Mescal', color: 'Orange' },
  ];

  for (const student of additionalStudents) {
    await addStandaloneStudent({
      name: student.name,
      glider: student.glider,
      color: student.color,
      totalFlights: 0,
    });
    await attachStudentToCourse(courseId, student.name);
    await pace(200);
  }

  await page.reload();
  await waitUi();

  step('edit student');
  const maxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await tap(maxRow.locator('button').filter({ has: page.locator('[data-icon="edit"]') }).first());
  const editModal = page.locator('.ant-modal').filter({ hasText: 'Schüler bearbeiten' }).last();
  await editModal.waitFor({ state: 'visible' });
  const editColorInput = editModal.locator('input').nth(2);
  await tap(editColorInput);
  await editColorInput.fill('Türkis');
  await pace(350);
  await shot('05-schueler-bearbeiten-loeschen.png');
  await tap(editModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await editModal.waitFor({ state: 'hidden' });

  step('delete existing student from course');
  await tap(studentCard.locator('.ant-card-extra button').first());
  const evaRowDelete = page.locator('.ant-list-item').filter({ hasText: 'Eva Extern' }).first();
  await setChecked(evaRowDelete.locator('input[type="checkbox"]'), true);
  await tap(studentCard.locator('.ant-card-extra button.ant-btn-dangerous'));
  const removeConfirm = page.locator('.ant-popover').filter({ hasText: 'Markierte Schüler entfernen?' }).last();
  await tap(removeConfirm.getByRole('button', { name: 'Entfernen' }));
  await waitUi();

  step('start flight with maneuvers');
  const maxIdleRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await tap(maxIdleRow.locator('button').nth(1));
  const startModal = page.locator('.ant-modal').filter({ hasText: 'Flug starten:' }).last();
  await startModal.waitFor({ state: 'visible', timeout: 5000 });

  await pace(500);
  // Direkt Inputs finden durch Position im Modal
  const inputs = startModal.locator('input[type="text"]');
  const inputCount = await inputs.count();
  if (inputCount >= 4) {
    const input0 = inputs.nth(0);
    await tap(input0);
    await input0.fill('Wasserkuppe');
    await pace(300);

    const input1 = inputs.nth(1);
    await tap(input1);
    await input1.fill('Peter Pilot');
    await pace(300);

    const input2 = inputs.nth(2);
    await tap(input2);
    await input2.fill('Flugplatz Nord');
    await pace(300);

    const input3 = inputs.nth(3);
    await tap(input3);
    await input3.fill('Lisa Lande');
    await pace(300);
  } else {
    throw new Error(`Erwartet 4 Text-Inputs im Start-Modal, gefunden: ${inputCount}`);
  }

  const maneuverGroup = startModal.locator('.ant-form-item').filter({ hasText: 'Manöver' }).first();
  await setChecked(maneuverGroup.locator('input[type="checkbox"]').nth(0), true);
  await setChecked(maneuverGroup.locator('input[type="checkbox"]').nth(1), true);
  await pace(450);
  await shot('06-start-manoever.png');

  await tap(startModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await startModal.waitFor({ state: 'hidden' });
  await waitUi();

  step('capture active in-flight status (green)');
  const activeMaxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await activeMaxRow.waitFor({ state: 'visible', timeout: 15000 });
  await shot('07-schueler-im-flug-gruen.png');

  step('open remarks modal and adjust maneuvers during active flight');
  await tap(activeMaxRow, { double: true });
  const remarksModal = page.locator('.ant-modal').filter({ hasText: 'Bemerkung:' }).last();
  await remarksModal.waitFor({ state: 'visible' });
  const remarksManeuverGroup = remarksModal.locator('.ant-form-item').filter({ hasText: 'Manöver' }).first();
  await setChecked(remarksManeuverGroup.locator('input[type="checkbox"]').nth(2), true);
  const remarksInput = remarksModal.locator('textarea');
  await tap(remarksInput);
  await remarksInput.fill('Sehr sauberer Start, beim nächsten Flug auf Armhaltung achten.');
  await pace(500);
  await shot('08-bemerkung-manoever-im-flug.png');
  await tap(remarksModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await remarksModal.waitFor({ state: 'hidden' });

  await timelapseAdvance({
    totalMs: 10 * 60 * 1000,
    durationMs: 10 * 1000,
    steps: 10,
    label: 'timelapse: 10 Minuten Flugzeit in 10 Sekunden',
  });

  step('mark landing pending');
  await tap(activeMaxRow.locator('button').nth(1));
  await waitUi();
  await shot('09-landung-cooldown.png');

  step('resume flight');
  try {
    const pendingMaxRow = page.locator('.ant-list-item').filter({ hasText: 'Final in:' }).first();
    await tap(pendingMaxRow.locator('button').nth(0));
    await waitUi();

    const activeAgainMaxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
    await tap(activeAgainMaxRow.locator('button').nth(1));
    await waitUi();

    await timelapseAdvance({
      totalMs: 5 * 60 * 1000,
      durationMs: 5 * 1000,
      steps: 5,
      label: 'timelapse: 5 Minuten Finalize in 5 Sekunden',
    });
  } catch {
    console.log('Skipping resume flight step due to timing issues');
  }

  await page.reload();
  await waitUi();

  const pendingAfterReload = page.locator('.ant-list-item').filter({ hasText: 'Final in:' }).first();
  if (await pendingAfterReload.count()) {
    await pendingAfterReload.waitFor({ state: 'hidden', timeout: 7000 }).catch(() => {});
  }

  await forceFinalizeLatestFlight('Max Muster');
  await ensureRemarkOnLatestFlight('Max Muster', 'Sehr sauberer Start, beim nächsten Flug auf Armhaltung achten.');
  await page.reload();
  await waitUi();

  const idleMaxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await idleMaxRow.locator('button').filter({ has: page.locator('[data-icon="edit"]') }).first().waitFor({ state: 'visible', timeout: 15000 });
  const remarksIndicator = idleMaxRow.locator('svg[data-icon="circle-exclamation"]');
  await remarksIndicator.waitFor({ state: 'visible', timeout: 15000 });
  await shot('10-bemerkung-vorhanden.png');

  step('open last-flight remarks');
  await tap(idleMaxRow, { double: true });
  const remarksReadOnly = page.locator('.ant-modal').filter({ hasText: 'Letzter Flug:' }).last();
  await pace(350);
  await shot('11-bemerkung-ansehen.png');
  await page.keyboard.press('Escape');
  await remarksReadOnly.waitFor({ state: 'hidden' });

  step('share course via qr-code');
  const shareBtn = page.locator('button').filter({ has: page.locator('[data-icon="link"], .anticon-link') }).first();
  await tap(shareBtn);
  const shareQrModal = page.locator('.ant-modal').filter({ hasText: 'Share-QR-Code' }).last();
  const qrModalVisible = await shareQrModal.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (qrModalVisible) {
    await pace(350);
    await shot('12-kurs-qr-freigeben.png');
    await page.keyboard.press('Escape');
    await shareQrModal.waitFor({ state: 'hidden' });
  } else {
    console.log('Skipping QR share screenshot: share modal did not open (relay unavailable?)');
  }

  step('open qr-code import dialog');
  await page.goto(`${baseUrl}/`);
  await waitUi();
  await closeOfflineBannerIfVisible();
  await tap(page.locator('button.ant-btn-primary').filter({ has: page.locator('svg[aria-label="circle-plus"], [data-icon="circle-plus"]') }).first());
  await createModal.waitFor({ state: 'visible' });
  const scanCourseBtn = createModal.getByRole('button', { name: 'Kurs scannen' });
  await tap(scanCourseBtn);
  const scanModal = page.locator('.ant-modal').filter({ hasText: 'Kurs scannen' }).last();
  await scanModal.waitFor({ state: 'visible' });
  await pace(350);
  await shot('13-kurs-qr-import.png');
  await page.keyboard.press('Escape');
  await scanModal.waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await createModal.waitFor({ state: 'hidden' });

  step('open online-mode settings');
  const settingsBtn = page.getByRole('button', { name: 'Einstellungen öffnen' });
  await tap(settingsBtn);
  const settingsModal = page.locator('.ant-modal').filter({ hasText: 'Einstellungen' }).last();
  await settingsModal.waitFor({ state: 'visible' });
  const usernameInput = settingsModal.locator('input').nth(0);
  await tap(usernameInput);
  await usernameInput.fill('Pilot Capture');
  const relayUrlInput = settingsModal.locator('input').nth(1);
  await tap(relayUrlInput);
  await relayUrlInput.fill('https://digikladde.aircursion.de');
  await pace(350);
  await shot('14-einstellungen-online-mode.png');
  await tap(settingsModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await settingsModal.waitFor({ state: 'hidden' });

  step('open evaluation and trigger pdf');
  await page.goto(`${baseUrl}/course/${courseId}/evaluation`);
  await waitUi();
  await pace(350);
  await shot('15-kursbericht-pdf.png');

  const evalCard = page.locator('.ant-card').filter({ hasText: 'Kursauswertung' }).first();
  await tap(evalCard.locator('.ant-card-extra button.ant-btn-primary'));

  captureSucceeded = true;
  console.log('Screenshots erstellt in docs/screenshots');
} finally {
  const video = page.video();
  await context.close();
  await browser.close();

  if (video && captureSucceeded) {
    const videoPath = await video.path();
    console.log(`Video erstellt: ${videoPath}`);

    // Convert WebM to GIF
    const gifPath = join(mediaDir, 'demo.gif');
    try {
      console.log('Konvertiere Video zu GIF...');
      execSync(
        `ffmpeg -y -i "${videoPath}" -vf "fps=10,scale=390:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gifPath}"`,
        { stdio: 'inherit' }
      );
      console.log(`GIF erstellt: ${gifPath}`);
    } catch (error) {
      console.error(`Fehler bei GIF-Konvertierung: ${error.message}`);
    }
  } else if (!captureSucceeded) {
    console.log('Capture abgebrochen: GIF-Konvertierung übersprungen.');
  }
}
