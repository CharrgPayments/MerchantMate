import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a phone number to (XXX) XXX-XXXX format
 * @param value - Raw phone number input
 * @returns Formatted phone number string
 */
export function formatPhoneNumber(value: string): string {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');
  
  // Limit to 10 digits
  const limited = digits.slice(0, 10);
  
  // Format based on length
  if (limited.length <= 3) {
    return limited;
  } else if (limited.length <= 6) {
    return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
  } else {
    return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
  }
}

/**
 * Strips formatting from phone number to get raw digits
 * @param value - Formatted phone number
 * @returns Raw digits only
 */
export function unformatPhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Formats an EIN/Tax ID to XX-XXXXXXX format
 * @param value - Raw EIN input
 * @returns Formatted EIN string
 */
export function formatEIN(value: string): string {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');
  
  // Limit to 9 digits
  const limited = digits.slice(0, 9);
  
  // Format based on length: XX-XXXXXXX
  if (limited.length <= 2) {
    return limited;
  } else {
    return `${limited.slice(0, 2)}-${limited.slice(2)}`;
  }
}

/**
 * Strips formatting from EIN to get raw digits
 * @param value - Formatted EIN
 * @returns Raw digits only
 */
export function unformatEIN(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Generates a cryptographically secure random integer
 * @param max - The upper bound (exclusive)
 * @returns A random integer between 0 and max-1
 */
function getSecureRandomInt(max: number): number {
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  return randomBuffer[0] % max;
}

/**
 * Generates a strong random password that meets security requirements
 * Uses Web Crypto API for cryptographically secure randomness
 * - 16 characters long
 * - Contains uppercase, lowercase, numbers, and special characters
 * @returns A randomly generated strong password
 */
export function generatePassword(): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Removed I, O for clarity
  const lowercase = 'abcdefghjkmnpqrstuvwxyz'; // Removed i, l, o for clarity
  const numbers = '23456789'; // Removed 0, 1 for clarity
  const special = '!@#$%^&*-_+=';
  
  // Guarantee at least one of each type using cryptographically secure random
  const password = [
    uppercase[getSecureRandomInt(uppercase.length)],
    uppercase[getSecureRandomInt(uppercase.length)],
    lowercase[getSecureRandomInt(lowercase.length)],
    lowercase[getSecureRandomInt(lowercase.length)],
    numbers[getSecureRandomInt(numbers.length)],
    numbers[getSecureRandomInt(numbers.length)],
    special[getSecureRandomInt(special.length)],
    special[getSecureRandomInt(special.length)],
  ];
  
  // Fill the rest with random characters from all sets
  const allChars = uppercase + lowercase + numbers + special;
  for (let i = password.length; i < 16; i++) {
    password.push(allChars[getSecureRandomInt(allChars.length)]);
  }
  
  // Shuffle the password to avoid predictable patterns
  for (let i = password.length - 1; i > 0; i--) {
    const j = getSecureRandomInt(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }
  
  return password.join('');
}
