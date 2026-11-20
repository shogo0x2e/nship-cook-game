import { customAlphabet } from 'nanoid';

// Uppercase, six characters, with 0/O and 1/I/L excluded for manual entry.
export const newExperienceId = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 6);
