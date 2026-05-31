export const isIncomingNewer = (incomingTs?: string, currentTs?: string): boolean => {
  if (!incomingTs) return false;
  if (!currentTs) return true;
  return Date.parse(incomingTs) >= Date.parse(currentTs);
};
