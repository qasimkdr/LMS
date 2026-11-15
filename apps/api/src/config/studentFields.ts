/** Enrollment-form fields a principal can make required (name, gender and class are always required). */
export const OPTIONAL_STUDENT_FIELDS = {
  dob: 'Date of birth',
  bForm: 'B-Form / CRC number',
  bloodGroup: 'Blood group',
  religion: 'Religion',
  currentAddress: 'Current address',
  city: 'City',
  photo: 'Profile photo',
  rollNo: 'Roll number',
  section: 'Section',
  fatherName: "Father's name",
  fatherCnic: "Father's CNIC",
  fatherPhone: "Father's mobile",
  motherName: "Mother's name",
  motherPhone: "Mother's mobile",
  emergencyContact: 'Emergency contact',
  previousSchool: 'Previous school',
} as const;

export type OptionalStudentField = keyof typeof OPTIONAL_STUDENT_FIELDS;
export const DEFAULT_REQUIRED_FIELDS: OptionalStudentField[] = ['dob', 'fatherName', 'fatherPhone'];

/** Document checklist on the enrollment form. */
export const STUDENT_DOCUMENT_TYPES = {
  B_FORM: 'B-Form copy',
  FATHER_CNIC_FRONT: "Father's CNIC (front)",
  FATHER_CNIC_BACK: "Father's CNIC (back)",
  MOTHER_CNIC: "Mother's CNIC",
  PREVIOUS_RESULT: 'Previous result card',
  LEAVING_CERTIFICATE: 'School leaving certificate',
  BIRTH_CERTIFICATE: 'Birth certificate',
  MEDICAL_CERTIFICATE: 'Medical certificate',
  OTHER: 'Other',
} as const;

export const CHECKLIST_DOCUMENTS = ['B_FORM', 'FATHER_CNIC_FRONT', 'FATHER_CNIC_BACK', 'PREVIOUS_RESULT'] as const;
