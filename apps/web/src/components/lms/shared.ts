export interface MyClass {
  sectionId: string;
  classId: string;
  label: string;
  subjects: { id: string; name: string }[];
  classTeacher: boolean;
  manager: boolean;
}

export const KIND_LABEL: Record<string, string> = { NOTES: 'Notes', WORKSHEET: 'Worksheet', BOOK: 'Book / chapter', VIDEO: 'Video', LINK: 'Web link', SYLLABUS: 'Syllabus', OTHER: 'Other' };
export const KIND_ICON: Record<string, string> = { NOTES: '📝', WORKSHEET: '📄', BOOK: '📚', VIDEO: '🎬', LINK: '🔗', SYLLABUS: '🗂', OTHER: '📎' };

/** Today's date (YYYY-MM-DD) in the browser's time zone. */
export const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const shiftDay = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
