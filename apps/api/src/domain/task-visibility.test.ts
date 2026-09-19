import { expect, it } from 'vitest';
import { taskVisible, taskLocked } from './task-visibility.js';
const now = new Date('2026-09-08T10:00:00Z');
const task = { id: 'task1', dayNumber: 1, startsAt: new Date('2099-01-01'), endsAt: new Date('2000-01-01') };
const day = { number: 1, opensAt: new Date('2026-09-08T08:30:00Z'), deadline: new Date('2026-09-09T08:30:00Z'), requiredTaskIds: ['task1'] };
it('personal day tasks ignore calendar dates and require the day snapshot', () => {
  expect(taskVisible(task, day, now)).toBe(true);
  expect(taskLocked(task, day, now)).toBe(false);
  expect(taskVisible(task, null, now)).toBe(false);
  expect(taskVisible(task, { ...day, number: 2 }, now)).toBe(false);
  expect(taskVisible(task, { ...day, requiredTaskIds: [] }, now)).toBe(false);
});
it('personal day deadlines lock claims and old calendar tasks respect expiry', () => {
  expect(taskLocked(task, day, day.deadline)).toBe(true);
  expect(taskLocked(task, day, new Date('2026-09-08T08:29:00Z'))).toBe(true);
  expect(taskVisible({ ...task, dayNumber: null }, day, now)).toBe(false);
  expect(taskLocked({ ...task, dayNumber: null, endsAt: null }, day, now)).toBe(true);
});
