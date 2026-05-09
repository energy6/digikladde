
export const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: undefined,
});

export const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: undefined,
  timeStyle: 'short',
});

const pad2 = (value: number) => String(value).padStart(2, '0');

export const durationFormatter = (startTs: number, endTs?: number) => {
  if (!endTs) return '-';

  const diffMs = endTs - startTs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return '-';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${pad2(minutes)}`;
};
