/* eslint-env node */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CourseBackupEnvelope, CourseType } from '../src/models/types';
import {
  buildDemoCourseSnapshot,
  defaultDemoCourseOptions,
  parseDemoCourseType,
} from '../src/utils/demoCourseData';

type DemoBackupCliOptions = {
  seed: number;
  output: string;
  days: number;
  students: number;
  courseType: CourseType;
};

const DEFAULTS: DemoBackupCliOptions = {
  ...defaultDemoCourseOptions,
  output: 'output/demo-course.digikladde.json',
};

const parseCliOptions = (): DemoBackupCliOptions => {
  const args = process.argv.slice(2);
  const options: DemoBackupCliOptions = { ...DEFAULTS };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--seed') {
      options.seed = Number.parseInt(args[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg === '--output') {
      options.output = args[index + 1] ?? DEFAULTS.output;
      index += 1;
      continue;
    }

    if (arg === '--days') {
      options.days = Number.parseInt(args[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg === '--students') {
      options.students = Number.parseInt(args[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg === '--course-type') {
      options.courseType = parseDemoCourseType(args[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run demo:course-backup -- [--seed 42] [--output output/demo-course.digikladde.json] [--days 4] [--students 6] [--course-type Windenkurs]');
      process.exit(0);
    }

    throw new Error(`Unbekanntes Argument: ${arg}`);
  }

  if (!Number.isInteger(options.seed)) throw new Error('seed muss eine Ganzzahl sein');
  if (!Number.isInteger(options.days) || options.days < 1) throw new Error('days muss >= 1 sein');
  if (!Number.isInteger(options.students) || options.students < 1) throw new Error('students muss >= 1 sein');

  return options;
};

const main = async () => {
  const options = parseCliOptions();
  const snapshot = buildDemoCourseSnapshot(options);
  const backup: CourseBackupEnvelope = {
    kind: 'digikladde.course-backup',
    formatVersion: 1,
    exportedAt: snapshot.exportedAt,
    appVersion: `demo-seed-${options.seed}`,
    snapshot,
  };

  const outputPath = resolve(process.cwd(), options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf-8');

  console.log(`Kursbackup Demo erstellt: ${outputPath}`);
  console.log(`Seed: ${options.seed}`);
  console.log(`Kurstyp: ${options.courseType}`);
  console.log(`Tage: ${options.days}`);
  console.log(`Schueler: ${snapshot.course.students.length}`);
  console.log(`Fluege gesamt: ${snapshot.flights.length}`);
};

void main();
