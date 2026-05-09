import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:4173';
const screenshotsDir = join(process.cwd(), 'docs', 'screenshots');
const mediaDir = join(process.cwd(), 'docs', 'media');

mkdirSync(screenshotsDir, { recursive: true });
mkdirSync(mediaDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: false,
  recordVideo: {
    dir: mediaDir,
    size: { width: 390, height: 844 },
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
  const offlineBanner = page.locator('text=Offline bereit').first();
  const updateBanner = page.locator('text=Update verfügbar').first();

  const hasOfflineBanner = await offlineBanner.isVisible().catch(() => false);
  const hasUpdateBanner = await updateBanner.isVisible().catch(() => false);
  if (!hasOfflineBanner && !hasUpdateBanner) return;

  const markerText = hasOfflineBanner ? 'Offline bereit' : 'Update verfügbar';
  const closeButton = page
    .locator('div')
    .filter({ hasText: markerText })
    .last()
    .getByRole('button', { name: 'Schließen' });

  if (await closeButton.isVisible().catch(() => false)) {
    await tap(closeButton);
    await page.waitForTimeout(250);
  }
};

const fillTextInputByLabel = async (labelText, value) => {
  const item = page.locator('.ant-form-item').filter({ has: page.locator(`label:has-text("${labelText}")`) }).first();
  const input = item.locator('input').first();
  await tap(input);
  await input.fill(value);
  await pace(300);
};

const openSelectByFormLabel = async (labelText) => {
  const item = page.locator('.ant-form-item').filter({ hasText: labelText }).first();
  const combobox = item.getByRole('combobox').first();

  if (await combobox.count()) {
    await tap(combobox);
    return;
  }

  await tap(item.locator('.ant-select-selector').first());
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

let courseId = '1';

try {
  step('open course create form');
  await page.goto(`${baseUrl}/course/new`);
  await installInteractionOverlay();
  await waitUi();
  await closeOfflineBannerIfVisible();

  step('fill course form');
  await fillTextInputByLabel('Name', 'A-Schein Mai 2026');
  await fillTextInputByLabel('Startdatum', '2026-05-01');
  await fillTextInputByLabel('Enddatum', '2026-05-05');
  await pace(450);
  await shot('01-kurs-erstellen.png');

  step('save course and return to list');
  await tap(page.locator('form button.ant-btn-primary').first());
  await page.waitForURL(`${baseUrl}/`);
  await waitUi();
  await closeOfflineBannerIfVisible();
  await shot('02-kurs-waehlen.png');

  step('open course detail');
  await tap(page.locator('.ant-card').filter({ hasText: 'A-Schein Mai 2026' }).first());
  await page.waitForURL(/\/course\/\d+$/);
  courseId = page.url().match(/\/course\/(\d+)$/)?.[1] ?? '1';

  step('open edit form');
  await page.goto(`${baseUrl}/course/${courseId}/edit`);
  await waitUi();
  await closeOfflineBannerIfVisible();
  await fillTextInputByLabel('Name', 'A-Schein Mai 2026 (Update)');
  await shot('03-kursdaten-bearbeiten.png');
  step('save edited course');
  await tap(page.locator('form button.ant-btn-primary').first());
  await page.waitForURL(`${baseUrl}/`);

  step('reopen course detail and force Windenkurs');
  await tap(page.locator('.ant-card').filter({ hasText: 'A-Schein Mai 2026 (Update)' }).first());
  await page.waitForURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/course/\\d+$`));
  await waitUi();
  await closeOfflineBannerIfVisible();

  courseId = page.url().match(/\/course\/(\d+)$/)?.[1] ?? courseId;
  await setCourseType(courseId, 'Windenkurs');
  await page.reload();
  await waitUi();
  await closeOfflineBannerIfVisible();

  step('create new student via student form');
  await page.goto(`${baseUrl}/course/${courseId}/add-student`);
  await waitUi();
  await closeOfflineBannerIfVisible();
  const newNameInput = page.locator('label:has-text("Name:")').locator('xpath=following-sibling::input[1]');
  await tap(newNameInput);
  await newNameInput.fill('Max Muster');
  await pace(300);
  const newGliderInput = page.locator('label:has-text("Schirm:")').locator('xpath=following-sibling::input[1]');
  await tap(newGliderInput);
  await newGliderInput.fill('Skywalk Mescal');
  await pace(300);
  const newColorInput = page.locator('label:has-text("Farbe:")').locator('xpath=following-sibling::input[1]');
  await tap(newColorInput);
  await newColorInput.fill('Blau');
  await pace(350);
  await shot('04-schueler-hinzufuegen-neu.png');
  await tap(page.getByRole('button', { name: 'Hinzufügen' }));
  await page.waitForURL(new RegExp(`${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/course/\\d+$`));
  await waitUi();
  await closeOfflineBannerIfVisible();

  step('insert standalone student in db');
  await addStandaloneStudent({ name: 'Eva Extern', glider: 'Advance Alpha', color: 'Rot', totalFlights: 0 });
  await attachStudentToCourse(courseId, 'Eva Extern');
  await page.reload();
  await waitUi();
  await closeOfflineBannerIfVisible();
  await pace(350);
  await shot('04-schueler-hinzufuegen.png');

  const studentCard = page.locator('.ant-card').filter({ hasText: 'Schüler' }).first();

  step('edit student');
  const maxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await tap(maxRow.locator('button').first());
  const editModal = page.locator('.ant-modal').filter({ hasText: 'Schüler bearbeiten:' }).last();
  const editForm = editModal.locator('.ant-form').first();
  const editColorInput = editForm.locator('.ant-form-item').filter({ hasText: 'Farbe' }).locator('input').first();
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

  const terrainItem = startModal.locator('.ant-form-item').filter({ hasText: 'Gelände' }).first();
  const terrainInput = terrainItem.locator('input').first();
  await tap(terrainInput);
  await terrainInput.fill('Bergwiese');
  await pace(300);
  const teacherItem = startModal.locator('.ant-form-item').filter({ hasText: 'Lehrer' }).first();
  const teacherInput = teacherItem.locator('input').first();
  await tap(teacherInput);
  await teacherInput.fill('Peter Pilot');
  await pace(300);

  const maneuverGroup = startModal.locator('.ant-form-item').filter({ hasText: 'Manöver' }).first();
  await setChecked(maneuverGroup.locator('input[type="checkbox"]').nth(0), true);
  await setChecked(maneuverGroup.locator('input[type="checkbox"]').nth(1), true);
  await pace(450);
  await shot('06-start-manoever.png');

  await tap(startModal.locator('.ant-modal-footer button.ant-btn-primary'));
  await startModal.waitFor({ state: 'hidden' });
  await waitUi();

  step('save remarks during active flight');
  const activeMaxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await tap(activeMaxRow, { double: true });
  const remarksModal = page.locator('.ant-modal').filter({ hasText: 'Bemerkung:' }).last();
  const remarksInput = remarksModal.locator('textarea');
  await tap(remarksInput);
  await remarksInput.fill('Sehr sauberer Start, beim nächsten Flug auf Armhaltung achten.');
  await pace(500);
  await shot('08-bemerkungen.png');
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
  await shot('07-landung-cooldown.png');

  step('resume flight');
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

  await page.reload();
  await waitUi();
  await closeOfflineBannerIfVisible();

  const pendingAfterReload = page.locator('.ant-list-item').filter({ hasText: 'Final in:' }).first();
  if (await pendingAfterReload.count()) {
    await pendingAfterReload.waitFor({ state: 'hidden', timeout: 7000 }).catch(() => {});
  }

  step('open last-flight remarks');
  const idleMaxRow = page.locator('.ant-list-item').filter({ hasText: 'Max Muster' }).first();
  await tap(idleMaxRow, { double: true });
  const remarksReadOnly = page.locator('.ant-modal').filter({ hasText: 'Letzter Flug:' }).last();
  await pace(350);
  await shot('08-bemerkungen-vor-naechstem-flug.png');
  await page.keyboard.press('Escape');
  await remarksReadOnly.waitFor({ state: 'hidden' });

  step('open evaluation and trigger pdf');
  await page.goto(`${baseUrl}/course/${courseId}/evaluation`);
  await waitUi();
  await closeOfflineBannerIfVisible();
  await pace(350);
  await shot('09-kursbericht-pdf.png');

  const evalCard = page.locator('.ant-card').filter({ hasText: 'Kursauswertung' }).first();
  await tap(evalCard.locator('.ant-card-extra button.ant-btn-primary'));

  console.log('Screenshots erstellt in docs/screenshots');
} finally {
  const video = page.video();
  await context.close();
  await browser.close();

  if (video) {
    const videoPath = await video.path();
    console.log(`Video erstellt: ${videoPath}`);
  }
}
