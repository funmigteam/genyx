type TaskWindow = { id: string; dayNumber: number | null; startsAt: Date; endsAt: Date | null };
type DayWindow = { number: number; opensAt: Date; deadline: Date; requiredTaskIds: unknown };

export function taskVisible(task: TaskWindow, day: DayWindow | null | undefined, now: Date) {
  if (task.dayNumber !== null) {
    return Boolean(day && day.number === task.dayNumber && Array.isArray(day.requiredTaskIds) && day.requiredTaskIds.includes(task.id));
  }
  return !task.endsAt || task.endsAt > now;
}

export function taskLocked(task: TaskWindow, day: DayWindow | null | undefined, now: Date) {
  if (task.dayNumber !== null) return !taskVisible(task, day, now) || !day || now < day.opensAt || now >= day.deadline;
  return task.startsAt > now || Boolean(task.endsAt && task.endsAt <= now);
}
